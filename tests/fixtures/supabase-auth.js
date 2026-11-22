import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

export async function testAuthService() {
  const user = { id: 'fixture-user', email: 'felix@usuarios.repuestosfelix.invalid', app_metadata: { acceso_pos: true } };
  let password = 'clave-navegador-sintetica-12345';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let result;
    if (req.url === '/auth/v1/token?grant_type=password' && data.email === user.email && data.password === password) {
      result = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user };
    } else if (req.headers.authorization === 'Bearer fixture-access') {
      if (req.url === '/auth/v1/user') {
        if (req.method === 'PUT') password = data.password;
        result = user;
      } else if (req.url === '/auth/v1/logout?scope=local') result = {};
    }
    res.writeHead(result ? 200 : 400, { 'Content-Type': 'application/json' });
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
