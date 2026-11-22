import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { matchesPassword, passwordRecord, tokenHash } from './credentials.js';

const pages = new Set(['/', '/index.html', '/ventas', '/inventario', '/compras', '/caja', '/clientes', '/suplidores', '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/configuracion', '/ayuda']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'" };
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const labels = { productos: 'Producto', clientes: 'Cliente', suplidores: 'Suplidor', formulas: 'Fórmula', configuracion: 'Configuración', ventas: 'Venta', compras: 'Compra', caja: 'Caja' };

export function desktopServer(engine, remote, assetsDirectory) {
  const ledger = engine.ledger;
  let syncing = false;
  function revokeAccess() {
    const profile = ledger.get('profile');
    if (profile) ledger.set('profile', { ...profile, allowOffline: false });
    ledger.database.exec('DELETE FROM sessions'); remote.clear();
    engine.connection = 'authentication';
  }
  async function synchronize() {
    const profile = ledger.get('profile');
    if (syncing || !profile || !profile.allowOffline || !ledger.get('remoteCookie')) return engine.status();
    syncing = true;
    try {
      const state = await engine.synchronize(async (path, options) => {
        try { return await remote.request(path, options); }
        catch (cause) { if (cause.status === 401) revokeAccess(); throw cause; }
      }, () => {
        const current = ledger.get('profile');
        if (!current?.allowOffline) throw error('Inicia sesión para sincronizar.', 401);
        return current;
      });
      return state;
    } finally { syncing = false; }
  }
  const timer = setInterval(() => { synchronize().catch(() => {}); }, 30000); timer.unref();
  const server = createServer(async (request, response) => {
    const send = (status, data, headers = {}) => { response.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', ...headers }); response.end(JSON.stringify(data)); };
    try {
      const host = request.headers.host;
      if (host !== '127.0.0.1:' + server.address().port) throw error('Nombre de servidor no permitido.', 403);
      const origin = 'http://' + host;
      const url = new URL(request.url, origin);
      if (url.origin !== origin) throw error('Origen no permitido.', 403);
      const path = url.pathname;
      if (!['GET', 'HEAD'].includes(request.method) && (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')) throw error('Origen no permitido.', 403);
      let body;
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw error('Se requiere application/json.', 415);
        const chunks = []; let length = 0;
        for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024) throw error('La solicitud es demasiado grande.', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw error('Solicitud inválida.'); }
      }
      const cookie = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('felix-desktop='))?.slice(14) || '';
      const access = () => {
        const session = cookie && ledger.database.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(cookie), Date.now());
        const profile = ledger.get('profile');
        return session && profile?.allowOffline && session.user_id === profile.id && Date.now() - profile.onlineAt < 30 * 86400000 ? profile : null;
      };
      const requireAccess = () => { const profile = access(); if (!profile) throw error('Inicia sesión para acceder al sistema.', 401); return profile; };
      const authenticated = Boolean(access());
      if (path === '/login' && request.method === 'POST' || path === '/cuenta/clave' && request.method === 'POST') {
        if (typeof body?.username !== 'string' || typeof body?.password !== 'string' || body.password.length > 2000) throw error('Indica tu usuario y contraseña.');
        const username = body.username.trim().toLowerCase();
        const { token, seconds } = await engine.serial(async () => {
          const profile = ledger.get('profile');
          const previousCookie = remote.cookie;
          const previousProtectedCookie = ledger.get('remoteCookie');
          let identity;
          try {
            await remote.request(path, { method: 'POST', body: { ...body, remember: true }, authenticated: false });
            identity = await remote.request('/api/account');
            if (ledger.pending().some(row => row.record.actor.id !== identity.id)) {
              remote.cookie = previousCookie;
              ledger.set('remoteCookie', previousProtectedCookie);
              throw error('Sincroniza primero con la cuenta que registró las operaciones pendientes.', 409);
            }
            if (!engine.pool) await engine.adopt(await remote.request('/api/sync/bootstrap'));
            ledger.set('profile', { id: identity.id, username: identity.username, name: identity.username,
              ...passwordRecord(path === '/cuenta/clave' ? body.newPassword : body.password), onlineAt: Date.now(), allowOffline: true });
            engine.connection = 'online';
          } catch (cause) {
            if (cause.status < 500 || path === '/cuenta/clave') throw cause;
            if (!engine.pool || !profile?.allowOffline || username !== profile.username || Date.now() - profile.onlineAt >= 30 * 86400000 || !matchesPassword(body.password, profile))
              throw error('Para este primer acceso o renovación necesitas conexión y una cuenta válida.', 401);
            identity = profile; engine.connection = 'offline';
          }
          const token = randomBytes(32).toString('base64url');
          const seconds = body.remember ? 30 * 86400 : 8 * 3600;
          ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), identity.id, Date.now() + seconds * 1000);
          return { token, seconds };
        });
        send(200, { redirect: '/ventas' }, { 'Set-Cookie': `felix-desktop=${token}; Path=/; HttpOnly; SameSite=Strict${body.remember ? '; Max-Age=' + seconds : ''}` });
        synchronize().catch(() => {}); return;
      }
      if (path === '/health') return send(200, { ok: true, desktop: true });
      if (path === '/logout' && request.method === 'POST') {
        ledger.database.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(cookie));
        return send(200, { redirect: '/login' }, { 'Set-Cookie': 'felix-desktop=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      }
      if ((pages.has(path) || path.startsWith('/api/')) && !authenticated) {
        if (pages.has(path)) { response.writeHead(303, { ...security, Location: '/login' }); response.end(); return; }
        throw error('Inicia sesión para acceder al sistema.', 401);
      }
      if (path === '/api/account') {
        return await engine.serial(async () => {
          requireAccess();
          try {
            if (request.method === 'GET') return send(200, await remote.request(path));
            if (request.method !== 'PUT') throw error('Método no permitido.', 405);
            if (ledger.pending().length) throw error('Sincroniza las operaciones pendientes antes de cambiar tu cuenta.', 409);
            const result = await remote.request(path, { method: 'PUT', body });
            revokeAccess();
            return send(200, result, { 'Set-Cookie': 'felix-desktop=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
          } catch (cause) { if (cause.status === 401) revokeAccess(); throw cause; }
        });
      }
      if (path === '/api/desktop/status' && request.method === 'GET') return send(200, engine.status());
      if (path === '/api/desktop/sync' && request.method === 'POST') return send(200, await synchronize());
      if (path === '/api/desktop/pending' && request.method === 'GET') return send(200, ledger.pending().map(row => ({
        reference: row.operation_id, date: row.record.occurredAt, operation: labels[row.record.path.split('/')[2]] || 'Operación',
        status: row.status, error: row.error, total: row.record.expected.effect?.total || null,
      })));
      if (path === '/api/desktop/export' && request.method === 'GET') return send(200,
        { format: 'repuestos-felix-pendientes', version: 1, exportedAt: new Date().toISOString(), databaseId: ledger.get('databaseId'), operations: ledger.pending().map(row => ({ ...row.record, error: row.error })) },
        { 'Content-Disposition': 'attachment; filename="operaciones-pendientes-felix.json"' });
      if (path === '/api/state' && request.method === 'GET') return send(200, await engine.serial(() => { requireAccess(); return engine.snapshot(); }));
      if (path === '/api/backup' && request.method === 'GET') return send(200, ledger.backup());
      if (path.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(request.method)) {
        const result = await engine.write(request.method, path, body, request.headers['idempotency-key'], () => {
          const profile = requireAccess(); return { id: profile.id, name: profile.username };
        });
        send(200, result); synchronize().catch(() => {}); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw error('Método no permitido.', 405);
      if (path === '/desktop.js') { response.writeHead(200, { ...security, 'Content-Type': mime['.js'] }); response.end('window.__FELIX_DESKTOP__ = true;'); return; }
      let name = pages.has(path) ? 'index.html' : path === '/login' ? 'login.html' : path.slice(1);
      if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || name.startsWith('.') || !Object.keys(mime).some(extension => name.endsWith(extension))) throw error('Recurso no encontrado.', 404);
      const filename = resolve(assetsDirectory, name);
      if (!filename.startsWith(resolve(assetsDirectory) + sep)) throw error('Recurso no encontrado.', 404);
      let data = await readFile(filename).catch(() => { throw error('Recurso no encontrado.', 404); });
      if (name.endsWith('.html')) {
        let html = data.toString().replace('<head>', '<head><script src="/desktop.js"></script>');
        if (name === 'login.html') html = html.replace('<html ', '<html data-accounts="true" ');
        data = Buffer.from(html);
      }
      response.writeHead(200, { ...security, 'Content-Type': mime[Object.keys(mime).find(extension => name.endsWith(extension))] });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (cause) { send(cause.status || 503, { error: cause.status ? cause.message : 'No se confirmó la operación. Los datos guardados permanecen en este equipo.', ...(cause.rejection && { rejection: cause.rejection }) }); }
  });
  server.on('close', () => clearInterval(timer));
  return server;
}
