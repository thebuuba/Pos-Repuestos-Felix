import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';

const origin = 'https://synthetic.invalid';
const user = { id: 'synthetic-user', email: 'felix@usuarios.repuestosfelix.invalid', app_metadata: { acceso_pos: true } };
function api(fetcher) {
  const hosting = hostingConfig({ PUBLIC_ORIGIN: origin, SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', POS_SESSION_SECRET: 'synthetic'.repeat(8) });
  hosting.auth.fetch = fetcher;
  return (path, cookie = '', body) => handleRequest(new Request(origin + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, 'X-Forwarded-Proto': 'https', Cookie: cookie, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }), { hosting, readAsset: async () => 'asset' });
}
const pair = response => response.headers.get('set-cookie')?.split(';')[0];
const login = call => call('/login', '', { username: 'felix', password: 'synthetic-password', remember: true });

test('un rechazo tardío de renovación no borra una sesión ingresada después', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let signedIn = 0;
  const call = api(async (url, options) => {
    if (url.includes('grant_type=password')) {
      signedIn++;
      return Response.json({ user, access_token: 'access-' + signedIn, refresh_token: 'refresh-' + signedIn, expires_in: signedIn === 1 ? 10 : 3600 });
    }
    if (url.includes('grant_type=refresh_token')) {
      assert.equal(JSON.parse(options.body).refresh_token, 'refresh-1');
      entered.resolve(); await release.promise;
      return Response.json({ code: 'refresh_token_not_found' }, { status: 400 });
    }
    assert.equal(options.headers.Authorization, 'Bearer access-2');
    return Response.json(user);
  });
  const old = pair(await login(call));
  const rejected = call('/api/account', old);
  await entered.promise;
  const renewed = pair(await login(call));
  release.resolve();
  const late = await rejected;
  assert.equal(late.status, 401, 'La operación con token rechazado sigue denegada.');
  assert.equal(late.headers.get('set-cookie'), null, 'Un Worker no puede borrar el ticket que reemplazó al enviado en esta petición.');
  assert.equal((await call('/api/account', renewed)).status, 200);
});

test('la reutilización tolerada y el token padre no causan cierres; la revocación real sí deniega', async t => {
  const start = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  let active = 0, revoked = false;
  const consumed = new Map();
  const tokens = () => ({ user, access_token: 'access-' + active, refresh_token: 'refresh-' + active, expires_in: 10 });
  // Supabase permits reuse for 10 seconds and always accepts the current token's
  // parent. Reusing an older ancestor after that window revokes its whole session.
  const call = api(async (url, options) => {
    if (url.includes('grant_type=password')) return Response.json(tokens());
    assert.ok(url.includes('grant_type=refresh_token'));
    const token = Number(JSON.parse(options.body).refresh_token.slice('refresh-'.length));
    if (!revoked && token === active) { consumed.set(token, Date.now()); active++; }
    else if (!revoked && (token === active - 1 || Date.now() - consumed.get(token) < 10000)) { /* reuse is allowed */ }
    else revoked = true;
    return revoked ? Response.json({ code: 'refresh_token_already_used' }, { status: 400 }) : Response.json(tokens());
  });
  const initial = pair(await login(call));
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => call('/api/account', initial)));
  for (const response of concurrent) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Max-Age=31536000/);
  }
  const parent = pair(concurrent[0]);
  const next = await call('/api/account', parent);
  assert.equal(next.status, 200);
  assert.equal((await call('/api/account', initial)).status, 200, 'Un ancestro dentro del intervalo todavía es reutilizable.');
  t.mock.timers.setTime(start + 11000);
  assert.equal((await call('/api/account', parent)).status, 200, 'El padre se acepta incluso fuera del intervalo.');
  const rejection = await call('/api/account', initial);
  assert.equal(rejection.status, 401);
  assert.equal(rejection.headers.get('set-cookie'), null);
  assert.equal((await call('/api/account', pair(next))).status, 401, 'La sesión realmente revocada no se autoriza con tokens cacheados.');
});

test('quitar el permiso deniega cada petición sin borrar otra sesión del navegador', async () => {
  const call = api(async url => url.includes('grant_type=password')
    ? Response.json({ user, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
    : Response.json({ ...user, app_metadata: { acceso_pos: false } }));
  const cookie = pair(await login(call));
  for (let attempt = 0; attempt < 2; attempt++) {
    const denied = await call('/api/account', cookie);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('set-cookie'), null);
  }
});
