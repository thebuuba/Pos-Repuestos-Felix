import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';

const origin = 'https://pos.example';
const env = { PUBLIC_ORIGIN: origin, SUPABASE_URL: 'https://negocio.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', POS_SESSION_SECRET: 's'.repeat(48) };

test('cuenta individual, permiso administrativo, renovación y salida en el POS', async () => {
  const user = { id: 'id-cajero', email: 'cajero@usuarios.repuestosfelix.invalid', app_metadata: { acceso_pos: true } };
  const calls = [];
  const hosting = hostingConfig(env);
  hosting.auth.fetch = async (url, init) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push(path);
    assert.equal(init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    if (path.includes('grant_type=password')) {
      assert.deepEqual(JSON.parse(init.body), { email: user.email, password: 'Mi clave privada' });
      return Response.json({ user, access_token: 'access', refresh_token: 'refresh', expires_in: 10 });
    }
    if (path.includes('grant_type=refresh_token')) {
      assert.deepEqual(JSON.parse(init.body), { refresh_token: 'refresh' });
      return Response.json({ user, access_token: 'renewed', refresh_token: 'next', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer renewed');
    if (path === '/auth/v1/user') return Response.json(user);
    assert.equal(path, '/auth/v1/logout?scope=local');
    return new Response(null, { status: 204 });
  };
  const call = (path, body, cookie = '') => handleRequest(new Request(origin + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, 'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body),
  }), { hosting, readAsset: () => 'asset' });
  const credentials = { username: ' Cajero ', password: 'Mi clave privada', remember: true };
  const login = await call('/login', credentials);
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=31536000/);
  assert.match(cookie, /SameSite=Lax/);
  const first = cookie.split(';')[0];
  const packed = Buffer.from(first.slice(first.indexOf('=') + 1), 'base64url');
  assert.equal(packed.includes(Buffer.from('"refresh"')), false);
  assert.equal((await call('/inventario', null, first + 'x')).status, 303);
  const refreshed = await call('/inventario', null, first);
  assert.equal(refreshed.status, 200);
  const renewed = refreshed.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/inventario', null, renewed)).status, 200);
  user.app_metadata = {};
  user.user_metadata = { acceso_pos: true };
  assert.equal((await call('/api/state', null, renewed)).status, 401);
  assert.equal((await call('/login', credentials)).status, 401);
  user.app_metadata.acceso_pos = true;
  assert.equal((await call('/login', { ...credentials, username: 'a@b.com' })).status, 401);
  const logout = await call('/logout', {}, renewed);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(calls.at(-1), '/auth/v1/logout?scope=local');
  hosting.auth.fetch = async () => new Response(null, { status: 503 });
  const offlineLogout = await call('/logout', {}, renewed);
  assert.equal(offlineLogout.status, 200);
  assert.equal((await offlineLogout.json()).redirect, '/login?salida=local');
  assert.match(offlineLogout.headers.get('set-cookie'), /Max-Age=0/);
});

test('un proyecto Supabase incompleto nunca acepta el acceso compartido', () => {
  assert.throws(() => hostingConfig({ SUPABASE_SECRET_KEY: 'sb_secret_fixture' }), /Supabase/);
  assert.throws(() => hostingConfig({ ...env, SUPABASE_SECRET_KEY: 'clave-invalida' }), /SUPABASE_SECRET_KEY/);
  assert.throws(() => hostingConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: '', APP_PASSWORD: 'x'.repeat(48) }), /Supabase/);
  assert.throws(() => hostingConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_solo_administrador' }), /Supabase/);
  for (const url of ['postgresql://pos_app.otro@aws-0-us-east-1.pooler.supabase.com/postgres', 'postgresql://pos_app@db.otro.supabase.co/postgres']) {
    assert.throws(() => hostingConfig({ ...env, DATABASE_URL: url }), /coincidir/);
    const previous = { DATABASE_URL: url, APP_USERNAME: 'admin', APP_PASSWORD: 'x'.repeat(32) };
    assert.ok(hostingConfig(previous).credentialsHash);
    assert.throws(() => hostingConfig({ ...previous, PUBLIC_ORIGIN: origin }), /Supabase/);
    assert.throws(() => hostingConfig({ DATABASE_URL: url }), /Supabase/);
  }
});

test('la sesión persistente renueva su plazo al usarse y conserva el cierre por revocación', async t => {
  const start = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const user = { id: 'persistente', email: 'felix@usuarios.repuestosfelix.invalid', app_metadata: { acceso_pos: true } };
  const hosting = hostingConfig(env);
  let accessRejected = false, unavailable = false, refreshes = 0;
  hosting.auth.fetch = async url => {
    if (unavailable) return new Response(null, { status: 503 });
    if (url.includes('grant_type=')) {
      if (url.includes('refresh_token')) refreshes++;
      return Response.json({ user, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    return accessRejected ? new Response(null, { status: 401 }) : Response.json(user);
  };
  const call = (path, cookie = '', body) => handleRequest(new Request(origin + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', Cookie: cookie },
    body: body && JSON.stringify(body),
  }), { hosting, readAsset: () => 'asset' });
  const login = await call('/login', '', { username: 'felix', password: 'sintética' });
  assert.match(login.headers.get('set-cookie'), /Max-Age=31536000/, 'Recordar es el comportamiento predeterminado');
  let cookie = login.headers.get('set-cookie').split(';')[0];
  // A server-rejected access token can still have a valid refresh token.
  accessRejected = true;
  const recovered = await call('/inventario', cookie);
  assert.equal(recovered.status, 200);
  assert.equal(refreshes, 1);
  cookie = recovered.headers.get('set-cookie').split(';')[0];
  accessRejected = false;
  for (const day of [29, 60, 350, 400]) {
    t.mock.timers.setTime(start + day * 86400000);
    const response = await call('/inventario', cookie);
    assert.equal(response.status, 200, `Día ${day}: no exige iniciar sesión otra vez`);
    assert.match(response.headers.get('set-cookie'), /Max-Age=31536000/);
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  unavailable = true;
  const outage = await call('/inventario', cookie);
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get('set-cookie'), null, 'Un fallo de red no borra la sesión');
  unavailable = false;
  user.app_metadata.acceso_pos = false;
  const revoked = await call('/api/account', cookie);
  assert.equal(revoked.status, 401);
  assert.equal(revoked.headers.get('set-cookie'), null, 'Revocar deniega la petición sin borrar un ticket posterior.');
});
