import { spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { matchesStateTag } from '../pos/state-tag.js';

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

const LINUX_ENVELOPE_PREFIX = 'felix-enc-v1:';
const LINUX_SECRET_SERVICE = 'com.repuestosfelix.pos';
const SECRET_TOOL_TIMEOUT_MS = 1500;

function credentialError(message, code = 'LINUX_CREDENTIAL_ERROR') {
  return Object.assign(new Error(message), {
    status: 401,
    code,
    localCredentialError: true,
  });
}

function keyFingerprint(keyBuffer) {
  return createHash('sha256').update(keyBuffer).digest('hex').slice(0, 16);
}

function envelopeAad(origin, installationId, backend, keyId) {
  return Buffer.from(`felix-cookie-v1|${origin}|${installationId}|${backend}|${keyId}`, 'utf8');
}

function decodeKeyMaterial(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) return null;
  // Reject non-canonical base64 garbage.
  if (buf.toString('base64') !== trimmed) return null;
  return buf;
}

function runSecretTool(args, stdinText = null, timeoutMs = SECRET_TOOL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      child = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ ok: false, unavailable: true, code: err?.code || 'SPAWN_ERROR', stdout: '', stderr: '' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ ok: false, unavailable: true, timedOut: true, code: 'ETIMEDOUT', stdout: '', stderr: 'timeout' });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (stderr.length < 1024) stderr += chunk; });
    child.once('error', (err) => {
      finish({ ok: false, unavailable: err?.code === 'ENOENT', code: err?.code || 'ERROR', stdout: '', stderr: '' });
    });
    child.once('close', (exitCode) => {
      const lower = stderr.toLowerCase();
      const noService = /cannot autolaunch|no such interface|serviceunknown|not provided by any \.service|dbus|failed to connect|cannot open display/i.test(lower);
      const locked = /locked|dismiss|cancel|denied|prompt/i.test(lower);
      finish({
        ok: exitCode === 0,
        unavailable: exitCode !== 0 && noService,
        locked: exitCode !== 0 && locked,
        exitCode,
        stdout,
        stderr,
      });
    });
    if (stdinText !== null) child.stdin.end(stdinText);
    else child.stdin.end();
  });
}

export function createSecretToolKeyring({ timeoutMs = SECRET_TOOL_TIMEOUT_MS } = {}) {
  return {
    async lookup(installationId, keyId) {
      const res = await runSecretTool(
        ['lookup', 'service', LINUX_SECRET_SERVICE, 'installation', installationId, 'key_id', keyId],
        null,
        timeoutMs,
      );
      if (res.ok) {
        const key = decodeKeyMaterial(res.stdout);
        return key ? { status: 'ok', key } : { status: 'corrupt' };
      }
      if (res.unavailable || res.timedOut) return { status: 'unavailable' };
      if (res.locked) return { status: 'locked' };
      return { status: 'missing' };
    },
    async store(installationId, keyId, keyBuffer) {
      const res = await runSecretTool(
        [
          'store',
          '--label=Repuestos Felix POS',
          'service', LINUX_SECRET_SERVICE,
          'installation', installationId,
          'key_id', keyId,
        ],
        keyBuffer.toString('base64') + '\n',
        timeoutMs,
      );
      if (res.ok) return { status: 'ok' };
      if (res.unavailable || res.timedOut) return { status: 'unavailable' };
      if (res.locked) return { status: 'locked' };
      return { status: 'error' };
    },
  };
}

function assertSafeLocalPath(targetPath, { expectDir = false, enforcePosixPerms = process.platform !== 'win32' } = {}) {
  const info = lstatSync(targetPath);
  if (info.isSymbolicLink()) {
    throw credentialError('Se rechazó un enlace simbólico en el almacenamiento local de credenciales.', 'LINUX_SYMLINK_REJECTED');
  }
  if (expectDir ? !info.isDirectory() : !info.isFile()) {
    throw credentialError('El tipo de archivo del almacén local de credenciales no es válido.', 'LINUX_INVALID_PATH');
  }
  if (enforcePosixPerms) {
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw credentialError('El archivo local de credenciales pertenece a otro usuario del sistema.', 'LINUX_WRONG_OWNER');
    }
    const mode = info.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw credentialError('Los permisos del almacén local de credenciales son demasiado abiertos (se exige 0600/0700).', 'LINUX_BAD_PERMS');
    }
  }
}

export function hardenSqliteFiles(directory, { enforcePosixPerms = process.platform !== 'win32' } = {}) {
  if (!directory || !enforcePosixPerms) return;
  try {
    const dirInfo = lstatSync(directory);
    if (dirInfo.isSymbolicLink()) {
      throw credentialError('La carpeta de datos del POS no puede ser un enlace simbólico.', 'LINUX_SYMLINK_REJECTED');
    }
    chmodSync(directory, 0o700);
  } catch (err) {
    if (err?.localCredentialError) throw err;
  }
  for (const name of ['pos.sqlite', 'pos.sqlite-wal', 'pos.sqlite-shm']) {
    const file = join(directory, name);
    if (!existsSync(file)) continue;
    const info = lstatSync(file);
    if (info.isSymbolicLink()) {
      throw credentialError(`El archivo local ${name} no puede ser un enlace simbólico.`, 'LINUX_SYMLINK_REJECTED');
    }
    chmodSync(file, 0o600);
  }
}

/**
 * Almacén de sesión protegido para Linux/ChromeOS (Crostini).
 * - Cifra la cookie como sobre AES-256-GCM versionado guardado dentro de pos.sqlite.
 * - Usa clave aleatoria de 32 bytes custodiada en Secret Service (`secret-tool` vía stdin)
 *   cuando está disponible, con respaldo en `<dataDir>/credentials/master.key` (`0700`/`0600`).
 * - Límite documentado del fallback en archivo: protege contra otras cuentas ordinarias del
 *   sistema mediante permisos 0600/0700, pero quien acceda a la vez a `master.key` y a
 *   `pos.sqlite` bajo el mismo usuario o root podrá descifrar la cookie.
 */
export function createLinuxSecrets({
  dataDir,
  origin = 'https://repuestos-felix-pos.repuestosfelix1994.workers.dev',
  installationId = 'default',
  keyring = createSecretToolKeyring(),
  enforcePosixPerms = process.platform !== 'win32',
} = {}) {
  if (!dataDir) throw new Error('Falta la carpeta de datos para el almacén de credenciales Linux.');
  const normalizedOrigin = new URL(origin).origin;
  const installTag = String(installationId || 'default');
  const credsDir = join(dataDir, 'credentials');
  const keyFile = join(credsDir, 'master.key');
  let cachedActive = null; // { backend, keyId, key }

  function ensureCredsDir() {
    mkdirSync(credsDir, { recursive: true, mode: 0o700 });
    if (enforcePosixPerms) {
      const info = lstatSync(credsDir);
      if (info.isSymbolicLink()) {
        throw credentialError('La carpeta de credenciales no puede ser un enlace simbólico.', 'LINUX_SYMLINK_REJECTED');
      }
      chmodSync(credsDir, 0o700);
    }
    assertSafeLocalPath(credsDir, { expectDir: true, enforcePosixPerms });
  }

  function readFileKey({ allowMissing = false } = {}) {
    if (!existsSync(keyFile)) {
      if (allowMissing) return null;
      throw credentialError('Falta la clave local de sesión (credentials/master.key). Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEY_MISSING');
    }
    assertSafeLocalPath(credsDir, { expectDir: true, enforcePosixPerms });
    assertSafeLocalPath(keyFile, { expectDir: false, enforcePosixPerms });
    const raw = readFileSync(keyFile, 'utf8');
    const key = decodeKeyMaterial(raw);
    if (!key) {
      throw credentialError('La clave local de sesión está dañada o fue alterada. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEY_CORRUPT');
    }
    return { backend: 'file', keyId: keyFingerprint(key), key };
  }

  function writeFileKeyAtomic(keyBuffer) {
    ensureCredsDir();
    const tmpFile = join(credsDir, `.master.key.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      writeFileSync(tmpFile, keyBuffer.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
      if (enforcePosixPerms) chmodSync(tmpFile, 0o600);
      renameSync(tmpFile, keyFile);
      if (enforcePosixPerms) chmodSync(keyFile, 0o600);
    } catch (err) {
      try { rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
      throw err;
    }
    return { backend: 'file', keyId: keyFingerprint(keyBuffer), key: keyBuffer };
  }

  async function resolveKeyForProtect() {
    if (cachedActive) return cachedActive;

    // 1. Si ya existe una clave local sana en archivo, reutilizarla para evitar claves huérfanas.
    if (existsSync(keyFile)) {
      try {
        const existing = readFileKey({ allowMissing: false });
        cachedActive = existing;
        return existing;
      } catch (err) {
        // Si es symlink o permisos/propietario inseguros, rechazar siempre.
        if (['LINUX_SYMLINK_REJECTED', 'LINUX_WRONG_OWNER', 'LINUX_BAD_PERMS', 'LINUX_INVALID_PATH'].includes(err?.code)) {
          throw err;
        }
        // En un nuevo login explícito, si master.key estaba corrupta/truncada, rotamos clave nueva abajo.
      }
    }

    // 2. Generar nueva clave aleatoria de 32 bytes y custodiarla en secret-tool si está disponible.
    const freshKey = randomBytes(32);
    const freshId = keyFingerprint(freshKey);
    if (keyring) {
      const stored = await keyring.store(installTag, freshId, freshKey);
      if (stored?.status === 'ok') {
        cachedActive = { backend: 'secret-tool', keyId: freshId, key: freshKey };
        return cachedActive;
      }
      if (stored?.status === 'locked') {
        throw credentialError('El depósito de claves de Linux está bloqueado. Desbloquéalo e intenta iniciar sesión de nuevo.', 'LINUX_KEYRING_LOCKED');
      }
      // unavailable / timeout / error de D-Bus -> caer a fallback en archivo 0600.
    }

    const fileEntry = writeFileKeyAtomic(freshKey);
    cachedActive = fileEntry;
    return fileEntry;
  }

  async function resolveKeyForUnprotect(backend, keyId) {
    if (cachedActive && cachedActive.backend === backend && cachedActive.keyId === keyId) {
      return cachedActive.key;
    }
    if (backend === 'secret-tool') {
      if (!keyring) {
        throw credentialError('El depósito de claves de Linux (secret-tool) no está disponible. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEYRING_UNAVAILABLE');
      }
      const looked = await keyring.lookup(installTag, keyId);
      if (looked?.status === 'ok') {
        if (keyFingerprint(looked.key) !== keyId) {
          throw credentialError('La clave devuelta por el depósito de claves no coincide con el sobre guardado. Inicia sesión de nuevo.', 'LINUX_KEY_MISMATCH');
        }
        cachedActive = { backend: 'secret-tool', keyId, key: looked.key };
        return looked.key;
      }
      if (looked?.status === 'locked') {
        throw credentialError('El depósito de claves de Linux está bloqueado. Desbloquéalo o inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEYRING_LOCKED');
      }
      if (looked?.status === 'unavailable') {
        throw credentialError('No se pudo conectar con el depósito de claves de Linux. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEYRING_UNAVAILABLE');
      }
      throw credentialError('No se encontró la clave de sesión en el depósito de claves de Linux. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEY_MISSING');
    }
    if (backend === 'file') {
      const loaded = readFileKey({ allowMissing: false });
      if (loaded.keyId !== keyId) {
        throw credentialError('La clave local de sesión cambió y no coincide con la sesión guardada. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_KEY_MISMATCH');
      }
      cachedActive = loaded;
      return loaded.key;
    }
    throw credentialError('El formato del respaldo de credenciales no es compatible. Inicia sesión de nuevo.', 'LINUX_UNSUPPORTED_BACKEND');
  }

  return {
    async protect(plaintext) {
      if (typeof plaintext !== 'string' || !plaintext) {
        throw credentialError('No hay datos de sesión válidos para proteger.', 'LINUX_INVALID_PLAINTEXT');
      }
      const { backend, keyId, key } = await resolveKeyForProtect();
      const iv = randomBytes(12);
      const aad = envelopeAad(normalizedOrigin, installTag, backend, keyId);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const envelope = {
        v: 1,
        alg: 'aes-256-gcm',
        backend,
        keyId,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ct: ct.toString('base64'),
      };
      return LINUX_ENVELOPE_PREFIX + JSON.stringify(envelope);
    },
    async unprotect(stored) {
      if (typeof stored !== 'string' || !stored.startsWith(LINUX_ENVELOPE_PREFIX)) {
        throw credentialError('La sesión guardada en este equipo está dañada o en un formato inválido. Inicia sesión de nuevo.', 'LINUX_ENVELOPE_INVALID');
      }
      let env;
      try {
        env = JSON.parse(stored.slice(LINUX_ENVELOPE_PREFIX.length));
      } catch {
        throw credentialError('La sesión guardada en este equipo está dañada. Inicia sesión de nuevo.', 'LINUX_ENVELOPE_INVALID');
      }
      if (!env || env.v !== 1 || env.alg !== 'aes-256-gcm' || !['secret-tool', 'file'].includes(env.backend) ||
          typeof env.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(env.keyId) ||
          typeof env.iv !== 'string' || typeof env.tag !== 'string' || typeof env.ct !== 'string') {
        throw credentialError('El sobre cifrado de sesión no es válido. Inicia sesión de nuevo.', 'LINUX_ENVELOPE_INVALID');
      }
      const iv = Buffer.from(env.iv, 'base64');
      const tag = Buffer.from(env.tag, 'base64');
      const ct = Buffer.from(env.ct, 'base64');
      if (iv.length !== 12 || tag.length !== 16) {
        throw credentialError('Los metadatos criptográficos de la sesión están alterados. Inicia sesión de nuevo.', 'LINUX_ENVELOPE_INVALID');
      }
      const key = await resolveKeyForUnprotect(env.backend, env.keyId);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(envelopeAad(normalizedOrigin, installTag, env.backend, env.keyId));
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        if (!plain) throw new Error('empty');
        return plain;
      } catch {
        cachedActive = null;
        throw credentialError('No se pudo verificar la integridad de la sesión guardada. Inicia sesión de nuevo para reanudar la sincronización.', 'LINUX_ENVELOPE_TAMPERED');
      }
    },
    resetCache() {
      cachedActive = null;
    },
  };
}

export function defaultDesktopSecrets({ dataDir, origin, installationId, platform = process.platform } = {}) {
  if (platform === 'win32') return windowsSecrets;
  if (platform === 'linux') return createLinuxSecrets({ dataDir, origin, installationId });
  throw new Error('Esta aplicación de escritorio solo es compatible con Windows y Linux/ChromeOS.');
}
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
  }
  async request(path, { method = 'GET', body, key, authenticated = true, etag, receiptOnly = false } = {}) {
    if (!path.startsWith('/api/') && !['/login', '/logout', '/cuenta/clave'].includes(path)) throw new Error('Ruta remota no permitida.');
    const revision = this.revision;
    if (authenticated && this.cookie === null) {
      const stored = this.ledger.get('remoteCookie');
      const loaded = stored ? await this.secrets.unprotect(stored) : '';
      if (this.revision !== revision) throw Object.assign(new Error('La sesión cambió mientras se abrían las credenciales. Reintenta la solicitud.'), { status: 503 });
      if (this.cookie === null) this.cookie = loaded;
    }
    let response;
    try {
      response = await this.fetcher(this.origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', Origin: this.origin, ...(authenticated && this.cookie && { Cookie: this.cookie }), ...(key && { 'Idempotency-Key': key }), ...(etag && { 'If-None-Match': etag }),
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
