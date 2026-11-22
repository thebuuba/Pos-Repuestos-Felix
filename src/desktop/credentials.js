import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

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

export class RemoteClient {
  constructor(ledger, { origin = 'https://repuestos-felix-pos.repuestosfelix1994.workers.dev', secrets = windowsSecrets, fetcher = fetch } = {}) {
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Dirección del servidor no permitida.');
    this.origin = url.origin; this.ledger = ledger; this.secrets = secrets; this.fetcher = fetcher; this.cookie = null;
  }
  async request(path, { method = 'GET', body, key, authenticated = true } = {}) {
    if (!path.startsWith('/api/') && !['/login', '/logout', '/cuenta/clave'].includes(path)) throw new Error('Ruta remota no permitida.');
    if (authenticated && this.cookie === null) {
      const stored = this.ledger.get('remoteCookie');
      this.cookie = stored ? await this.secrets.unprotect(stored) : '';
    }
    let response;
    try {
      response = await this.fetcher(this.origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', Origin: this.origin, ...(authenticated && this.cookie && { Cookie: this.cookie }), ...(key && { 'Idempotency-Key': key }) },
        body: body && JSON.stringify(body) });
    } catch { throw Object.assign(new Error('No se pudo conectar con el servidor.'), { status: 503 }); }
    const nextCookie = response.headers.get('set-cookie')?.split(';')[0];
    if (nextCookie) {
      this.cookie = nextCookie;
      this.ledger.set('remoteCookie', await this.secrets.protect(nextCookie));
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw Object.assign(new Error(result?.error || 'El servidor no confirmó la solicitud.'), { status: response.status >= 300 ? response.status : 503 });
    return result;
  }
  clear() { this.cookie = ''; this.ledger.set('remoteCookie', null); }
}
