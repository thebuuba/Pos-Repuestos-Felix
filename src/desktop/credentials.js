import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { matchesStateTag } from '../pos/state-tag.js';
import { CURRENT_BACKUP_VERSION } from '../pos/relational-backup.js';

// Windows protects cached server sessions for the current Windows user.
// Secrets travel over stdin/stdout pipes, never command arguments or logs.
function dpapi(value, decrypt) {
  if (process.platform !== 'win32') throw new Error('El almacén de acceso de esta aplicación requiere Windows.');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const command = `Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $result=[Security.Cryptography.ProtectedData]::${operation}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output += value; });
    child.once('error', () => reject(new Error('No se pudo abrir el almacén de acceso de Windows.')));
    child.once('close', code => code === 0 ? resolve(decrypt ? Buffer.from(output, 'base64').toString('utf8') : output) : reject(new Error('Windows no pudo proteger los datos de acceso.')));
    child.stdin.end(decrypt ? value : Buffer.from(value).toString('base64'));
  });
}
export const windowsSecrets = { protect: value => dpapi(value, false), unprotect: value => dpapi(value, true) };
export function passwordRecord(password) {
  const salt = randomBytes(32).toString('hex');
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}
export function matchesPassword(password, profile) {
  if (!profile?.salt || !profile?.hash || typeof password !== 'string' || password.length > 2000) return false;
  const digest = scryptSync(password, profile.salt, 32);
  const expected = Buffer.from(profile.hash, 'hex');
  return expected.length === digest.length && timingSafeEqual(digest, expected);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');

function sessionCookie(headers, name) {
  // Older fetch implementations combine Set-Cookie; Expires contains a comma.
  const values = headers.getSetCookie?.() ?? (headers.get('set-cookie') || '').split(/,(?=\s*[^;,\s]+=)/);
  let result;
  for (const value of values) {
    const [pair, ...attributes] = value.split(';').map(part => part.trim());
    if (!pair.startsWith(name + '=')) continue;
    const attrs = new Map(attributes.map(part => {
      const index = part.indexOf('=');
      return [part.slice(0, index < 0 ? undefined : index).toLowerCase(), index < 0 ? '' : part.slice(index + 1).trim()];
    }));
    const age = attrs.get('max-age');
    const expired = /^-?\d+$/.test(age ?? '') ? Number(age) <= 0 : Date.parse(attrs.get('expires')) <= Date.now();
    result = pair === name + '=' || expired ? '' : pair;
  }
  return result;
}

export class RemoteClient {
  constructor(ledger, { origin = 'https://repuestos-felix-pos.repuestosfelix1994.workers.dev', secrets = windowsSecrets, fetcher = fetch } = {}) {
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Dirección del servidor no permitida.');
    this.origin = url.origin; this.ledger = ledger; this.secrets = secrets; this.fetcher = fetcher; this.cookie = null; this.revision = 0;
    this.cookieName = url.protocol === 'https:' ? '__Host-felix-session' : 'felix-session';
    this.abortController = new AbortController();
  }
  abortAll() {
    this.abortController.abort();
    this.abortController = new AbortController();
  }
  async request(path, { method = 'GET', body, key, authenticated = true, etag, receiptOnly = false, backupVersion = CURRENT_BACKUP_VERSION, timeoutMs = 25000 } = {}) {
    if (!path.startsWith('/api/') && !['/login', '/logout', '/cuenta/clave'].includes(path)) throw new Error('Ruta remota no permitida.');
    const revision = this.revision;
    if (authenticated && this.cookie === null) {
      const stored = this.ledger.get('remoteCookie');
      const loaded = stored ? await this.secrets.unprotect(stored) : '';
      if (this.revision !== revision) throw Object.assign(new Error('La sesión cambió mientras se abrían las credenciales. Reintenta la solicitud.'), { status: 503 });
      if (this.cookie === null) this.cookie = loaded;
    }
    let response;
    const signal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), this.abortController.signal])
      : AbortSignal.timeout(timeoutMs);
    const minimalBootstrap = path === '/api/sync/bootstrap' || path === '/api/sync/retire';
    try {
      response = await this.fetcher(this.origin + path, { method, redirect: 'manual', signal,
        headers: { 'Content-Type': 'application/json', Origin: this.origin, ...(authenticated && this.cookie && { Cookie: this.cookie }), ...(key && { 'Idempotency-Key': key }), ...(etag && { 'If-None-Match': etag }),
          ...(path.startsWith('/api/sync/') && { 'X-Felix-Backup-Version': String(backupVersion) }),
          ...(minimalBootstrap && { 'X-Felix-Bootstrap': 'minimal' }),
          ...(receiptOnly === true && method === 'POST' && path === '/api/sync/operations' && { Prefer: 'return=receipt' }) },
        body: body && JSON.stringify(body) });
    } catch { throw Object.assign(new Error('No se pudo conectar con el servidor.'), { status: 503 }); }
    const notModified = response.status === 304 && path === '/api/sync/bootstrap' && method === 'GET' &&
      etag && response.headers.get('etag') && matchesStateTag(etag, response.headers.get('etag'));
    const result = notModified ? { notModified: true, etag: response.headers.get('etag') } : await response.json().catch(() => null);
    if (response.status === 401 && authenticated && this.revision === revision) this.clear();
    if ((!response.ok && !notModified) || !result) throw Object.assign(new Error(result?.error || 'El servidor no confirmó la solicitud.'), {
      status: response.status >= 300 && response.status !== 304 ? response.status : 503,
      ...(path === '/api/sync/retire' && response.status === 409 && result?.retirementRejection &&
        typeof result.retirementRejection === 'object' && !Array.isArray(result.retirementRejection) && { retirementRejection: result.retirementRejection }),
    });
    const bootstrapEtag = response.headers.get('x-felix-bootstrap-etag');
    if (bootstrapEtag && result && typeof result === 'object' && !Array.isArray(result)) {
      result.bootstrapEtag = bootstrapEtag;
    }
    const nextCookie = sessionCookie(response.headers, this.cookieName);
    if (nextCookie !== undefined && this.revision === revision) {
      if (!nextCookie) this.clear();
      else {
        const protectedCookie = await this.secrets.protect(nextCookie);
        // A late response or DPAPI completion must not undo a newer login/logout.
        if (this.revision === revision) {
          this.ledger.set('remoteCookie', protectedCookie);
          this.cookie = nextCookie;
          this.revision++;
        }
      }
    }
    return result;
  }
  invalidatePending() { this.revision++; }
  clear() { this.ledger.set('remoteCookie', null); this.cookie = ''; this.revision++; }
}
