import { createHash } from 'node:crypto';
import { readProductMovements, readSnapshot, writeOperation } from '../pos/store.js';
import { CURRENT_BACKUP_VERSION, LEGACY_SYNC_BACKUP_VERSION } from '../pos/relational-backup.js';
import { readSyncBootstrap, writeSyncOperation, retireSyncStream } from '../pos/sync-operations.js';
import { stateTag, matchesStateTag, bootstrapTag } from '../pos/state-tag.js';
import { allowedOperation, redactBootstrapForRole, redactSnapshotForRole, userRole } from '../pos/roles.js';
import { hostingConfig, authorized, validCredentials, sessionCookie, clearSessionCookie } from '../hosting.js';
import { accountSession } from '../supabase-auth.js';

const pageRoutes = new Set([
  '/', '/index.html', '/ventas', '/inventario', '/compras', '/taller', '/caja', '/clientes', '/suplidores',
  '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/recordatorios', '/configuracion', '/ayuda',
]);
const pageAsset = ['index.html', 'text/html'];
const publicFiles = {
  '/pwa-shell.html': ['pwa-shell.html', 'text/html'],
  '/sw.js': ['sw.js', 'text/javascript'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/icons/maskable-512.png': ['icons/maskable-512.png', 'image/png'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
  '/app.js': ['app.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
  '/login.js': ['login.js', 'text/javascript'],
  '/theme.js': ['theme.js', 'text/javascript'],
  '/assets/brand/repuestos-felix.jpg': ['assets/brand/repuestos-felix.jpg', 'image/jpeg'],
  '/assets/fonts/inter-latin-wght-normal.woff2': ['assets/fonts/inter-latin-wght-normal.woff2', 'font/woff2'],
  '/assets/Inter-OFL.txt': ['assets/Inter-OFL.txt', 'text/plain'],
};
const baseSecurityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
};
const securityFor = hosting => hosting?.origin
  ? { ...baseSecurityHeaders, 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
  : baseSecurityHeaders;
const maxBodyBytes = 10 * 1024 * 1024;

function syncBackupVersion(request) {
  const raw = request.headers.get('x-felix-backup-version');
  if (raw === null || raw === '') return LEGACY_SYNC_BACKUP_VERSION;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return LEGACY_SYNC_BACKUP_VERSION;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < LEGACY_SYNC_BACKUP_VERSION) return LEGACY_SYNC_BACKUP_VERSION;
  return Math.min(parsed, CURRENT_BACKUP_VERSION);
}

function json(status, data, headers = {}, hosting = null) {
  return new Response(JSON.stringify(data), { status, headers: { ...securityFor(hosting), 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function fail(message, status) { const error = new Error(message); error.status = status; throw error; }

async function readBody(request, limit = maxBodyBytes) {
  let length = 0;
  const chunks = [];
  const decoder = new TextDecoder();
  const reader = request.body?.getReader();
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) fail(limit === maxBodyBytes ? 'El respaldo supera el límite de 10 MB.' : 'La solicitud supera el tamaño permitido.', 413);
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
  } finally { reader?.releaseLock(); }
  try { return JSON.parse(chunks.join('')); }
  catch { fail('El contenido JSON no es válido.', 400); }
}

/** Shared HTTP boundary for Node and Workers. Assets come only from this allowlist. */
export async function handleRequest(request, options = {}) {
  const hosting = options.hosting ?? hostingConfig({});
  const account = hosting.auth ? accountSession(hosting, request) : null;
  const response = await route(request, { ...options, hosting }, account);
  if (hosting.origin) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (account?.cookie) response.headers.set('Set-Cookie', account.cookie);
  return response;
}

async function route(request, { pool, hosting, databaseLabel = 'PostgreSQL', readAsset }, account) {
  const securityHeaders = securityFor(hosting);
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isPage = pageRoutes.has(pathname);
    if (pathname === '/health' && request.method === 'GET') return json(200, { ok: true });
    const hostHeader = request.headers.get('host');
    let headerHost;
    try { headerHost = hostHeader ? new URL(`${url.protocol}//${hostHeader}`).host : null; }
    catch { return json(403, { error: 'Nombre de servidor no permitido.' }); }
    const allowed = hosting.origin
      ? url.host === new URL(hosting.origin).host
      : ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!allowed || (headerHost && headerHost !== url.host)) return json(403, { error: 'Nombre de servidor no permitido.' });
    if (hosting.origin && request.headers.get('x-forwarded-proto')?.split(',')[0].trim() !== 'https') {
      return json(426, { error: 'Accede mediante HTTPS. El proxy debe configurar X-Forwarded-Proto.' });
    }
    if (['/login', '/logout', '/cuenta/clave'].includes(pathname) && request.method === 'POST') {
      if (request.headers.get('origin') !== (hosting.origin || url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json(403, { error: 'Origen no permitido.' });
      }
      if (pathname === '/logout') {
        const closed = !account || await account.signOut();
        return json(200, { redirect: closed ? '/login' : '/login?salida=local' }, account ? {} : { 'Set-Cookie': clearSessionCookie(hosting) });
      }
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, { error: 'Se requiere application/json.' });
      const body = await readBody(request, 8192);
      const change = pathname === '/cuenta/clave';
      if (change && (!account || typeof body?.newPassword !== 'string')) return json(400, { error: 'Indica una nueva contraseña para tu cuenta de Supabase.' });
      const valid = account ? await account.signIn(body?.username, body?.password, body?.remember !== false, change ? body.newPassword : undefined) :
        validCredentials(body?.username, body?.password, hosting);
      if (!valid) return json(401, { error: 'El usuario o la contraseña no son correctos.' });
      let next;
      try { next = new URL(body.next || '/inventario', url.origin); } catch { /* Fall back to inventory. */ }
      const redirect = next?.origin === url.origin && pageRoutes.has(next.pathname) ? next.pathname + next.search : '/inventario';
      return json(200, { redirect }, account ? {} : { 'Set-Cookie': sessionCookie(hosting, body.remember === true) });
    }
    const needsSession = isPage || pathname === '/login' || pathname.startsWith('/api/');
    const authenticated = needsSession && (account ? await account.authorized() : authorized(request, hosting));
    if (pathname === '/login' && request.method === 'GET') {
      if (authenticated && !(account && url.searchParams.get('cambiar') === '1')) return new Response(null, { status: 303, headers: { ...securityHeaders, Location: '/inventario' } });
      const asset = await readAsset('login.html');
      if (asset instanceof Response && !asset.ok) return json(503, { error: 'No se pudo cargar el formulario.' });
      const html = await new Response(asset instanceof Response ? asset.body : asset).text();
      return new Response(account ? html.replace('<html ', '<html data-accounts="true" ') : html,
        { headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if ((pathname.startsWith('/api/') || isPage) && !authenticated) {
      if (isPage) return new Response(null, { status: 303, headers: { ...securityHeaders, Location: '/login?next=' + encodeURIComponent(pathname + url.search) } });
      return json(401, { error: 'Inicia sesión para acceder al sistema.' });
    }
    if (pathname.startsWith('/api/')) {
      const role = account?.user ? userRole(account.user) : 'dueno';
      if (pathname === '/api/account') {
        if (request.method === 'GET') return json(200, {
          id: account?.user?.id || 'local', username: account?.user?.email.split('@')[0] || hosting.username || 'Usuario local',
          role, canChangeUsername: !!hosting.auth?.adminKey, canChangePassword: !!account,
        });
        if (request.method !== 'PUT') return json(405, { error: 'Método no permitido.' });
        if (request.headers.get('origin') !== (hosting.origin || url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
          return json(403, { error: 'Origen no permitido.' });
        }
        if (!account) return json(400, { error: 'Esta instalación no utiliza cuentas individuales. Configura Supabase Auth para cambiar tu cuenta.' });
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, { error: 'Se requiere application/json.' });
        await account.update(await readBody(request, 8192));
        return json(200, { redirect: '/login' });
      }
      const userAdminMatch = pathname === '/api/usuarios' ? null : /^\/api\/usuarios\/([^/]+)$/.exec(pathname);
      if (pathname === '/api/usuarios' || userAdminMatch) {
        if (role !== 'dueno') return json(403, { error: 'Tu cuenta de cajero no tiene permiso para esta operación.' });
        if (pathname === '/api/usuarios' && request.method === 'GET') {
          if (!account) return json(200, { available: false, reason: 'Esta instalación utiliza acceso local. Configura Supabase Auth para administrar usuarios.', users: [] });
          if (!hosting.auth?.adminKey) return json(200, { available: false, reason: 'La administración de usuarios requiere configurar SUPABASE_SECRET_KEY en el servidor.', users: [] });
          return json(200, { available: true, users: await account.listUsers() });
        }
        const allowedWrite = (pathname === '/api/usuarios' && request.method === 'POST') || (Boolean(userAdminMatch) && request.method === 'PUT');
        if (!allowedWrite) return json(405, { error: 'Método no permitido.' });
        if (request.headers.get('origin') !== (hosting.origin || url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
          return json(403, { error: 'Origen no permitido.' });
        }
        if (!account) return json(400, { error: 'Esta instalación utiliza acceso local. Configura Supabase Auth para administrar usuarios.' });
        if (!hosting.auth?.adminKey) return json(503, { error: 'La administración de usuarios requiere configurar SUPABASE_SECRET_KEY en el servidor.' });
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, { error: 'Se requiere application/json.' });
        const body = await readBody(request, 8192);
        if (pathname === '/api/usuarios') return json(201, { user: await account.createUser(body) });
        let targetId;
        try { targetId = decodeURIComponent(userAdminMatch[1]); }
        catch { return json(400, { error: 'Identificador de usuario inválido.' }); }
        return json(200, { user: await account.updateUser(targetId, body) });
      }
      if (pathname === '/api/state' && request.method === 'PUT') {
        return json(410, { error: 'La escritura global fue retirada. Cierra y vuelve a abrir la aplicación para actualizarla.' });
      }
      if (!allowedOperation(role, request.method, pathname)) {
        return json(403, { error: 'Tu cuenta de cajero no tiene permiso para esta operación.' });
      }
      if (request.method === 'GET' && pathname === '/api/backup') {
        return json(200, await readSnapshot(pool, databaseLabel, true));
      }
      const isStateRead = request.method === 'GET' && pathname === '/api/state';
      const isSyncBootstrap = request.method === 'GET' && pathname === '/api/sync/bootstrap';
      const productMovementsMatch = request.method === 'GET' ? /^\/api\/productos\/([1-9]\d*)\/movimientos$/.exec(pathname) : null;
      if (!isStateRead && !isSyncBootstrap && !productMovementsMatch && !['POST', 'PUT', 'DELETE'].includes(request.method)) return json(405, { error: 'Método no permitido.' });
      const expectedOrigin = hosting.origin || url.origin;
      const origin = request.headers.get('origin');
      if ((origin && origin !== expectedOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json(403, { error: 'Origen no permitido.' });
      }
      if (productMovementsMatch) {
        return json(200, await readProductMovements(pool, Number(productMovementsMatch[1]), { role }));
      }
      if (isSyncBootstrap) {
        const backupVersion = syncBackupVersion(request);
        const condition = request.headers.get('if-none-match');
        const download = await readSyncBootstrap(
          pool,
          databaseLabel,
          condition ? version => matchesStateTag(condition, bootstrapTag({ ...version, role, backupVersion })) : undefined,
          { backupVersion },
        );
        const headers = { ETag: bootstrapTag({ ...(download.notModified ?? download.snapshot), role, backupVersion }) };
        return download.notModified ? new Response(null, { status: 304, headers: { ...securityHeaders, ...headers } }) : json(200, redactBootstrapForRole(download, role), headers);
      }
      if (isStateRead) {
        const condition = request.headers.get('if-none-match');
        const compact = request.headers.get('x-felix-compact') === '1';
        const state = await readSnapshot(pool, databaseLabel, false, condition ? version => matchesStateTag(condition, stateTag({ ...version, role })) : undefined, { compact });
        const headers = { ETag: stateTag({ ...(state.notModified ?? state), role }) };
        if (state.notModified) return new Response(null, { status: 304, headers: { ...securityHeaders, ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
        return json(200, redactSnapshotForRole(state, role), headers);
      }
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        return json(415, { error: 'Se requiere application/json.' });
      }
      const body = await readBody(request);
      const actor = account?.user ? { id: account.user.id, name: account.user.email.split('@')[0], role } :
        { id: 'local', name: hosting.username || 'Usuario local', role };
      if (pathname === '/api/sync/retire') {
        if (request.method !== 'POST') return json(405, { error: 'Método no permitido.' });
        const backupVersion = syncBackupVersion(request);
        return json(200, redactBootstrapForRole(await retireSyncStream(pool, body, databaseLabel, actor, { backupVersion }), role));
      }
      if (pathname === '/api/sync/operations') {
        if (request.method !== 'POST') return json(405, { error: 'Método no permitido.' });
        if (request.headers.get('idempotency-key') !== body?.operationId) return json(400, { error: 'La clave de envío no coincide con la operación local.' });
        if (!allowedOperation(role, body?.method, body?.path)) return json(403, { error: 'Tu cuenta de cajero no tiene permiso para sincronizar esta operación.' });
        const backupVersion = syncBackupVersion(request);
        const result = await writeSyncOperation(pool, body, databaseLabel, actor, {
          receiptOnly: request.headers.get('prefer') === 'return=receipt',
          backupVersion,
        });
        return json(200, redactBootstrapForRole(result, role), { ETag: stateTag({ ...result.snapshot, role }) });
      }
      const rawDelta = request.headers.get('x-felix-delta');
      const deltaBaseRevision = rawDelta !== null && /^\d+$/.test(rawDelta) && Number.isSafeInteger(Number(rawDelta)) ? Number(rawDelta) : null;
      const compact = request.headers.get('x-felix-compact') === '1';
      const result = await writeOperation(pool, request.method, pathname, body, request.headers.get('idempotency-key'), databaseLabel, actor, {
        ...(deltaBaseRevision !== null ? { deltaBaseRevision } : {}),
        ...(compact ? { compact: true } : {}),
      });
      return json(200, redactSnapshotForRole(result, role), { ETag: stateTag({ ...result, role }) });
    }
    const immutableAsset = /^\/assets\/pwa\/(app-[a-f0-9]{16}\.js|styles-[a-f0-9]{16}\.css|chunk-[A-Z0-9]{8}\.js)$/.exec(pathname);
    const asset = isPage ? pageAsset : publicFiles[pathname] || (immutableAsset && [pathname.slice(1), pathname.endsWith('.js') ? 'text/javascript' : 'text/css']);
    if (!asset || !['GET', 'HEAD'].includes(request.method)) return json(404, { error: 'No encontrado.' });
    const content = await readAsset(asset[0]);
    const headers = new Headers(content instanceof Response ? content.headers : undefined);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    const type = asset[1];
    headers.set('Content-Type', /^(text\/|application\/)/.test(type) ? `${type}; charset=utf-8` : type);
    if (!isPage && (!(content instanceof Response) || content.status === 200)) {
      const tag = content instanceof Response ? content.headers.get('etag') : `"${createHash('sha256').update(content).digest('hex')}"`;
      headers.set('Cache-Control', immutableAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
      if (tag) {
        headers.set('ETag', tag);
        if (matchesStateTag(request.headers.get('if-none-match') || '', tag.replace(/^W\//, ''))) return new Response(null, { status: 304, headers });
      }
    }
    return new Response(request.method === 'HEAD' ? null : content instanceof Response ? content.body : content, {
      status: content instanceof Response ? content.status : 200, headers,
    });
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ event: 'http_request_error', code: error.code || error.name }));
    return json(error.status || 503, {
      error: error.status ? error.message : 'No se confirmó el guardado. Revisa la conexión y actualiza los datos antes de reintentar.',
      rejection: error.rejection,
      retirementRejection: error.retirementRejection,
    });
  }
}
