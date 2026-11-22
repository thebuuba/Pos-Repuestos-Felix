import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';
import { testAuthService } from './fixtures/supabase-auth.js';

const origin = 'https://pos.example';
const password = 'clave-navegador-sintetica-12345';

async function fixture(t, admin = true) {
  const auth = await testAuthService();
  t.after(auth.close);
  const hosting = hostingConfig({ ...auth.env, PUBLIC_ORIGIN: origin,
    ...(admin && { SUPABASE_SECRET_KEY: 'sb_secret_fixture' }) });
  const call = (path, { body, method = body ? 'POST' : 'GET', cookie = '', headers = {} } = {}) =>
    handleRequest(new Request(origin + path, {
      method, headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: body && JSON.stringify(body),
    }), { hosting, readAsset: () => 'asset', pool: { connect: () => assert.fail('La cuenta no debe tocar la base de operaciones.') } });
  const login = await call('/login', { body: { username: 'felix', password } });
  assert.equal(login.status, 200);
  return { hosting, call, cookie: login.headers.get('set-cookie').split(';')[0] };
}

test('mi cuenta expone identidad y capacidades sin tokens ni claves', async t => {
  const { call, cookie } = await fixture(t);
  assert.equal((await call('/api/account')).status, 401);
  const profile = await call('/api/account', { cookie });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), { id: 'fixture-user', username: 'felix', canChangeUsername: true, canChangePassword: true });
  assert.equal(profile.headers.get('cache-control'), 'no-store');
});

test('cambia nombre y contraseña conservando UUID y permiso administrativo', async t => {
  const { call, cookie } = await fixture(t);
  const result = await call('/api/account', { cookie, method: 'PUT',
    body: { currentPassword: password, newUsername: ' Felix.Nuevo ', newPassword: 'otra-frase-secreta-de-prueba' } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { redirect: '/login' });
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/login', { body: { username: 'felix', password } })).status, 401);
  assert.equal((await call('/login', { body: { username: 'felix.nuevo', password } })).status, 401);
  const login = await call('/login', { body: { username: 'felix.nuevo', password: 'otra-frase-secreta-de-prueba' } });
  assert.equal(login.status, 200);
  const profile = await call('/api/account', { cookie: login.headers.get('set-cookie').split(';')[0] });
  assert.deepEqual(await profile.json(), { id: 'fixture-user', username: 'felix.nuevo', canChangeUsername: true, canChangePassword: true });
});

test('rechaza clave actual incorrecta, usuario ocupado, CSRF y cambio de otra identidad', async t => {
  const { call, cookie } = await fixture(t);
  const update = (body, headers) => call('/api/account', { cookie, method: 'PUT', body, headers });
  assert.equal((await update({ currentPassword: 'incorrecta', newUsername: 'intruso' })).status, 403);
  assert.equal((await update({ currentPassword: password, newUsername: 'ocupado' })).status, 400);
  assert.equal((await update({ currentPassword: password, newUsername: 'nuevo' }, { Origin: 'https://ajeno.example' })).status, 403);
  assert.equal((await update({ currentPassword: password, newUsername: 'nuevo' }, { Origin: '' })).status, 403);
  assert.equal((await update({ currentPassword: password, newUsername: 'nuevo', id: 'otro' })).status, 400);
  assert.equal((await call('/login', { body: { username: 'felix', password } })).status, 200);
});

test('sin secreto administrativo permite cambiar clave y explica que el nombre no se puede cambiar', async t => {
  const { call, cookie } = await fixture(t, false);
  assert.equal((await (await call('/api/account', { cookie })).json()).canChangeUsername, false);
  assert.equal((await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, newUsername: 'nuevo' } })).status, 503);
  const result = await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, newPassword: 'una-clave-nueva-segura' } });
  assert.equal(result.status, 200);
  assert.equal((await call('/login', { body: { username: 'felix', password } })).status, 401);
  assert.equal((await call('/login', { body: { username: 'felix', password: 'una-clave-nueva-segura' } })).status, 200);
  assert.equal((await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, newPassword: 'otra-clave-distinta' } })).status, 403);
});

test('acepta claves de seis caracteres sin exigir combinaciones y conserva espacios', async t => {
  for (const newPassword of ['123456', 'abcdef', '!!!!!!', 'áéíóúñ', '🔧'.repeat(6), '  ab  ']) {
    for (const newUsername of [undefined, 'nuevo']) {
      const { call, cookie } = await fixture(t);
      const response = await call('/api/account', { cookie, method: 'PUT',
        body: { currentPassword: password, newPassword, ...(newUsername && { newUsername }) } });
      assert.equal(response.status, 200);
      assert.equal((await call('/login', { body: { username: newUsername || 'felix', password: newPassword } })).status, 200);
    }
  }
});

test('rechaza nombres y contraseñas inválidos sin cambios parciales', async t => {
  const { call, cookie } = await fixture(t);
  for (const changes of [
    { newUsername: 'no@valido' }, { newUsername: 'x..y' }, { newUsername: 'felix' },
    { newPassword: 'corta' }, { newPassword: '🔧'.repeat(5) }, { newPassword: password }, { newPassword: 'á'.repeat(37) },
    { newUsername: 'nuevo', newPassword: 'corta' },
  ]) assert.equal((await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, ...changes } })).status, 400);
  assert.equal((await call('/login', { body: { username: 'felix', password } })).status, 200);
});

test('rechaza reautenticación de otra UUID y permiso revocado antes de elevar privilegios', async t => {
  const { call, cookie, hosting } = await fixture(t);
  const request = hosting.auth.fetch;
  for (const user of [
    { id: 'otra-identidad', email: 'felix@usuarios.repuestosfelix.invalid', app_metadata: { acceso_pos: true } },
    { id: 'fixture-user', email: 'felix@usuarios.repuestosfelix.invalid', app_metadata: {} },
  ]) {
    hosting.auth.fetch = (url, init) => url.includes('grant_type=password') ?
      Promise.resolve(Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user })) : request(url, init);
    assert.equal((await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, newUsername: 'nuevo' } })).status, 403);
  }
});

test('una respuesta perdida después de cambiar el usuario pide comprobar el acceso sin afirmar guardado', async t => {
  const { call, cookie, hosting } = await fixture(t);
  const request = hosting.auth.fetch;
  hosting.auth.fetch = async (url, init) => {
    const response = await request(url, init);
    if (url.includes('/admin/users/')) throw new Error('fallo de red simulado');
    return response;
  };
  const response = await call('/api/account', { cookie, method: 'PUT', body: { currentPassword: password, newUsername: 'nuevo' } });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /No se confirmó el cambio.*comprueba tus datos/);
  assert.equal((await call('/login', { body: { username: 'nuevo', password } })).status, 200);
});
