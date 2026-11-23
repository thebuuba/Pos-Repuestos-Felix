import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function testAuthService({ role } = {}) {
  const initialUser = {
    id: 'fixture-user',
    email: 'felix@usuarios.repuestosfelix.invalid',
    created_at: '2026-01-15T12:00:00.000Z',
    last_sign_in_at: '2026-11-23T15:00:00.000Z',
    banned_until: null,
    user_metadata: { nombre_usuario: 'felix', nombre_visible: 'Félix Dueño' },
    app_metadata: { acceso_pos: true, ...(role ? { rol: role } : {}) },
  };
  const users = new Map([[initialUser.id, { user: initialUser, password: 'clave-navegador-sintetica-12345' }]]);
  const tokens = new Map();
  const isBanned = u => Date.parse(u.banned_until) > Date.now();
  const issueTokens = (entry) => {
    const access = entry.user.id === 'fixture-user' ? 'fixture-access' : 'access-' + randomUUID();
    const refresh = entry.user.id === 'fixture-user' ? 'fixture-refresh' : 'refresh-' + randomUUID();
    tokens.set(access, entry.user.id);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, user: entry.user };
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const url = new URL(req.url, 'http://127.0.0.1');
    const isAdmin = req.headers.apikey === 'sb_secret_fixture' && !req.headers.authorization;
    let result;
    let status = 200;
    if (req.url === '/auth/v1/token?grant_type=password') {
      const entry = [...users.values()].find(item => item.user.email === data.email && item.password === data.password && !isBanned(item.user));
      if (entry) {
        entry.user.last_sign_in_at = new Date().toISOString();
        result = issueTokens(entry);
      }
    } else if (url.pathname === '/auth/v1/admin/users' && req.method === 'GET' && isAdmin) {
      result = { users: [...users.values()].map(item => item.user) };
    } else if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST' && isAdmin) {
      const exists = data.email === 'ocupado@usuarios.repuestosfelix.invalid' ||
        [...users.values()].some(item => item.user.email === data.email);
      if (exists) {
        status = 422;
        result = { code: 'email_exists' };
      } else {
        const id = 'user-' + randomUUID().slice(0, 8);
        const created = {
          id,
          email: data.email,
          created_at: new Date().toISOString(),
          last_sign_in_at: null,
          banned_until: null,
          user_metadata: data.user_metadata || {},
          app_metadata: data.app_metadata || {},
        };
        users.set(id, { user: created, password: data.password });
        result = created;
      }
    } else if (url.pathname.startsWith('/auth/v1/admin/users/') && req.method === 'PUT' && isAdmin) {
      const targetId = decodeURIComponent(url.pathname.slice('/auth/v1/admin/users/'.length));
      const entry = users.get(targetId);
      if (entry) {
        if (data.email && (data.email === 'ocupado@usuarios.repuestosfelix.invalid' ||
            [...users.values()].some(item => item.user.id !== targetId && item.user.email === data.email))) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'email_exists' }));
          return;
        }
        if (data.email) entry.user.email = data.email;
        if (data.password) entry.password = data.password;
        if (data.user_metadata) entry.user.user_metadata = { ...entry.user.user_metadata, ...data.user_metadata };
        if (data.app_metadata) entry.user.app_metadata = { ...entry.user.app_metadata, ...data.app_metadata };
        if (data.ban_duration === 'none') entry.user.banned_until = null;
        else if (typeof data.ban_duration === 'string' && data.ban_duration) {
          entry.user.banned_until = '2126-01-01T00:00:00.000Z';
        }
        result = entry.user;
      } else {
        status = 404;
      }
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      const token = req.headers.authorization.slice(7);
      const userId = tokens.get(token) || (token === 'fixture-access' ? 'fixture-user' : null);
      const entry = userId ? users.get(userId) : null;
      if (entry && !isBanned(entry.user)) {
        if (req.url === '/auth/v1/user') {
          if (req.method === 'PUT' && data.password) entry.password = data.password;
          result = entry.user;
        } else if (req.url === '/auth/v1/logout?scope=local') {
          tokens.delete(token);
          result = {};
        }
      }
    }
    res.writeHead(result ? status : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result || { error: 'invalid_credentials' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    env: { SUPABASE_URL: 'http://127.0.0.1:' + server.address().port, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      POS_SESSION_SECRET: 'clave-sintetica-para-firmar-sesiones-de-prueba' },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

export async function loginCookie(call) {
  const response = await call('/login', { method: 'POST', headers: { Origin: 'https://pos.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'felix', password: 'clave-navegador-sintetica-12345' }) });
  if (response.status !== 200) assert.fail('No se pudo iniciar la sesión de prueba: ' + await response.text());
  return response.headers.get('set-cookie').split(';')[0];
}
