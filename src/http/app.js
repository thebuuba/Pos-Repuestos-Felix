import { createHash } from 'node:crypto';
import { readSnapshot, writeOperation } from '../pos/store.js';
import { hostingConfig, authorized, validCredentials, sessionCookie, clearSessionCookie } from '../hosting.js';
import { accountSession } from '../supabase-auth.js';

const pageRoutes = new Set([
  '/', '/index.html', '/ventas', '/inventario', '/compras', '/caja', '/clientes', '/suplidores',
  '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/configuracion', '/ayuda',
]);
const pageAsset = ['index.html', 'text/html'];
const publicFiles = {
  '/app.js': ['app.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
  '/login.js': ['login.js', 'text/javascript'],
  '/assets/brand/repuestos-felix.jpg': ['assets/brand/repuestos-felix.jpg', 'image/jpeg'],
  '/assets/fonts/inter-latin-wght-normal.woff2': ['assets/fonts/inter-latin-wght-normal.woff2', 'font/woff2'],
  '/assets/Inter-OFL.txt': ['assets/Inter-OFL.txt', 'text/plain'],
};
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const maxBodyBytes = 10 * 1024 * 1024;
const snapshotRepresentationVersion = 3;

function stateTag({ databaseId, revision, databaseLabel }) {
  const version = JSON.stringify([snapshotRepresentationVersion, databaseId, revision, databaseLabel]);
  return `"${createHash('sha256').update(version).digest('hex')}"`;
}

function matchesStateTag(condition, tag) {
  if (condition === '*') return true;
  for (const [, candidate] of condition.matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")\s*(?=,|$)/g)) {
    if (candidate === tag) return true;
  }
  return false;
}

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
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
  if (account?.cookie) response.headers.set('Set-Cookie', account.cookie);
  return response;
}

async function route(request, { pool, hosting, databaseLabel = 'PostgreSQL', readAsset }, account) {
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
      const valid = account ? await account.signIn(body?.username, body?.password, body?.remember === true, change ? body.newPassword : undefined) :
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
      if (pathname === '/api/state' && request.method === 'PUT') {
        return json(410, { error: 'La escritura global fue retirada. Cierra y vuelve a abrir la aplicación para actualizarla.' });
      }
      if (request.method === 'GET' && pathname === '/api/backup') {
        return json(200, await readSnapshot(pool, databaseLabel, true));
      }
      const isStateRead = request.method === 'GET' && pathname === '/api/state';
      if (!isStateRead && !['POST', 'PUT', 'DELETE'].includes(request.method)) return json(405, { error: 'Método no permitido.' });
      const expectedOrigin = hosting.origin || url.origin;
      const origin = request.headers.get('origin');
      if ((origin && origin !== expectedOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json(403, { error: 'Origen no permitido.' });
      }
      if (isStateRead) {
        const condition = request.headers.get('if-none-match');
        const state = await readSnapshot(pool, databaseLabel, false, condition ? version => matchesStateTag(condition, stateTag(version)) : undefined);
        const headers = { ETag: stateTag(state.notModified ?? state) };
        if (state.notModified) return new Response(null, { status: 304, headers: { ...securityHeaders, ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
        return json(200, state, headers);
      }
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        return json(415, { error: 'Se requiere application/json.' });
      }
      const body = await readBody(request);
      return json(200, await writeOperation(pool, request.method, pathname, body, request.headers.get('idempotency-key'), databaseLabel));
    }
    const asset = isPage ? pageAsset : publicFiles[pathname];
    if (!asset || !['GET', 'HEAD'].includes(request.method)) return json(404, { error: 'No encontrado.' });
    const content = await readAsset(asset[0]);
    const headers = new Headers(content instanceof Response ? content.headers : undefined);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    const type = asset[1];
    headers.set('Content-Type', /^(text\/|application\/)/.test(type) ? `${type}; charset=utf-8` : type);
    if (!isPage && (!(content instanceof Response) || content.status === 200)) {
      const tag = content instanceof Response ? content.headers.get('etag') : `"${createHash('sha256').update(content).digest('hex')}"`;
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
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
    });
  }
}
