import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { RemoteClient, passwordRecord, tokenHash } from '../src/desktop/credentials.js';
import { desktopServer } from '../src/desktop/server.js';

async function setup(t, { validLogin = false, rejectOld = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'felix-auth-revocation-'));
  const ledger = new DesktopLedger(directory);
  const gates = Object.fromEntries(['oldEntered', 'oldRelease', 'loginEntered', 'loginRelease', 'protectEntered', 'protectRelease'].map(name => [name, Promise.withResolvers()]));
  const original = '__Host-felix-session=original';
  const renewed = '__Host-felix-session=renewed';
  ledger.set('remoteCookie', original);
  ledger.set('profile', { id: 'user-a', username: 'felix', name: 'felix', generation: 'original-generation', allowOffline: true,
    onlineAt: Date.now(), ...passwordRecord('synthetic-password') });
  ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash('synthetic-desktop-session'), 'user-a', Date.now() + 60000);
  const remote = new RemoteClient(ledger, {
    origin: 'https://synthetic.invalid',
    secrets: {
      unprotect: async value => value,
      protect: async value => {
        assert.equal(value, renewed);
        gates.protectEntered.resolve(); await gates.protectRelease.promise;
        return value;
      },
    },
    fetcher: async (url, options) => {
      if (url.endsWith('/login')) {
        gates.loginEntered.resolve(); await gates.loginRelease.promise;
        return validLogin ? Response.json({ redirect: '/ventas' }, { headers: { 'Set-Cookie': renewed + '; Path=/' } })
          : Response.json({ error: 'Credenciales incorrectas' }, { status: 401 });
      }
      assert.ok(url.endsWith('/api/account'));
      if (options.headers.Cookie === original) {
        gates.oldEntered.resolve(); await gates.oldRelease.promise;
        return rejectOld ? Response.json({ error: 'Acceso revocado' }, { status: 401 }) : Response.json({ id: 'user-a', username: 'felix' });
      }
      return options.headers.Cookie === renewed ? Response.json({ id: 'user-a', username: 'felix' })
        : Response.json({ error: 'Sin sesión' }, { status: 401 });
    },
  });
  const engine = { ledger, pool: {}, tail: Promise.resolve(), serial: DesktopEngine.prototype.serial,
    status: () => ({ connection: engine.connection }), synchronize: async () => engine.status() };
  const server = desktopServer(engine, remote, directory);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    Object.values(gates).forEach(gate => gate.resolve());
    server.closeAllConnections(); await new Promise(done => server.close(done));
    await engine.tail;
    ledger.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('felix-auth-revocation-'));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (path, body = {}) => fetch(origin + path, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: 'felix-desktop=synthetic-desktop-session' }, body: JSON.stringify(body) });
  return { ledger, remote, gates, call };
}

test('un login fallido no oculta la revocación del perfil anterior', { timeout: 10000 }, async t => {
  for (const rejectDuringLogin of [false, true]) {
    await t.test(`revocación durante login: ${rejectDuringLogin}`, async t => {
      const { ledger, gates, call } = await setup(t);
      const syncing = call('/api/desktop/sync');
      await gates.oldEntered.promise;
      const login = call('/login', { username: 'felix', password: 'incorrecta' });
      await gates.loginEntered.promise;
      if (rejectDuringLogin) { gates.oldRelease.resolve(); await syncing; }
      gates.loginRelease.resolve();
      assert.equal((await login).status, 401);
      if (!rejectDuringLogin) { gates.oldRelease.resolve(); await syncing; }
      assert.equal(ledger.get('profile').allowOffline, false, 'El intento fallido no autoriza seguir usando el perfil revocado.');
      assert.equal(ledger.get('remoteCookie'), null);
      assert.equal(ledger.database.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    });
  }
});

test('un 401 anterior durante DPAPI no cancela un login nuevo validado', { timeout: 10000 }, async t => {
  const { ledger, remote, gates, call } = await setup(t, { validLogin: true });
  const syncing = call('/api/desktop/sync');
  await gates.oldEntered.promise;
  const login = call('/login', { username: 'felix', password: 'synthetic-password' });
  gates.loginRelease.resolve();
  await gates.protectEntered.promise;
  gates.oldRelease.resolve();
  await syncing;
  gates.protectRelease.resolve();
  assert.equal((await login).status, 200);
  assert.equal(ledger.get('profile').allowOffline, true);
  assert.equal(ledger.get('remoteCookie'), '__Host-felix-session=renewed');
  assert.equal(remote.cookie, '__Host-felix-session=renewed');
});

test('un cambio de generación local durante login fallido no inventa revocación remota', { timeout: 10000 }, async t => {
  const { ledger, gates, call } = await setup(t, { rejectOld: false });
  const syncing = call('/api/desktop/sync');
  await gates.oldEntered.promise;
  const login = call('/login', { username: 'felix', password: 'incorrecta' });
  await gates.loginEntered.promise;
  gates.oldRelease.resolve();
  await syncing;
  gates.loginRelease.resolve();
  assert.equal((await login).status, 401);
  assert.equal(ledger.get('profile').allowOffline, true);
  assert.equal(ledger.get('remoteCookie'), '__Host-felix-session=original');
});
