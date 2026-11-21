import { createHash } from 'node:crypto';
import { readSnapshot, writeOperation } from '../pos/store.js';
import { hostingConfig, authorized } from '../hosting.js';

const pageRoutes = new Set([
  '/', '/index.html', '/ventas', '/inventario', '/compras', '/caja', '/clientes', '/suplidores',
  '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/configuracion', '/ayuda',
]);
const pageAsset = ['index.html', 'text/html'];
const publicFiles = {
  '/app.js': ['app.js', 'text/javascript'],
  '/pwa.js': ['pwa.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
  '/sw.js': ['sw.js', 'text/javascript'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/icons/maskable-512.png': ['icons/maskable-512.png', 'image/png'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
  '/assets/brand/repuestos-felix.jpg': ['assets/brand/repuestos-felix.jpg', 'image/jpeg'],
  '/assets/fonts/inter-latin-wght-normal.woff2': ['assets/fonts/inter-latin-wght-normal.woff2', 'font/woff2'],
  '/assets/Inter-OFL.txt': ['assets/Inter-OFL.txt', 'text/plain'],
};
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const maxBodyBytes = 10 * 1024 * 1024;
const snapshotRepresentationVersion = 1;

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

async function readBody(request) {
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
        if (length > maxBodyBytes) fail('El respaldo supera el límite de 10 MB.', 413);
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
  } finally { reader?.releaseLock(); }
  try { return JSON.parse(chunks.join('')); }
  catch { fail('El contenido JSON no es válido.', 400); }
}

/** Shared HTTP boundary for Node and Workers. Assets come only from this allowlist. */
export async function handleRequest(request, { pool, hosting = hostingConfig({}), databaseLabel = 'PostgreSQL', readAsset } = {}) {
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
    if ((pathname.startsWith('/api/') || isPage || pathname === '/login') && !authorized(request, hosting)) {
      return json(401, { error: 'Inicia sesión para acceder al sistema.' }, { 'WWW-Authenticate': 'Basic realm="Repuestos Felix", charset="UTF-8"' });
    }
    if (pathname === '/login' && request.method === 'GET') {
      return new Response(null, { status: 303, headers: { ...securityHeaders, Location: '/' } });
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
        if (state.notModified) return new Response(null, { status: 304, headers: { ...securityHeaders, ...headers } });
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
