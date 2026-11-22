import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { RemoteClient, matchesPassword, tokenHash } from '../src/desktop/credentials.js';
import { desktopServer } from '../src/desktop/server.js';
import { startDesktop } from '../src/desktop/main.js';

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'felix-desktop-concurrency-'));
  return directory;
}
async function removeDirectory(directory) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(directory.includes('felix-desktop-concurrency-'));
  await rm(directory, { recursive: true, force: true });
}

test('dos autenticaciones simultáneas conservan la identidad y contraseña de cada cuenta', { timeout: 15_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const ledger = new DesktopLedger(directory);
  const protectingA = Promise.withResolvers();
  const releaseA = Promise.withResolvers();
  const reachedB = Promise.withResolvers();
  let nextProtection;
  const releases = [releaseA];
  const remote = new RemoteClient(ledger, {
    origin: 'https://autenticacion-sintetica.invalid',
    secrets: {
      async protect(value) {
        if (value === 'sid=A') { protectingA.resolve(); await releaseA.promise; }
        if (nextProtection) { const next = nextProtection; nextProtection = null; next.entered.resolve(); await next.release.promise; }
        return value;
      },
      async unprotect(value) { return value; },
    },
    async fetcher(url, options) {
      if (url.endsWith('/login')) {
        const { username, password } = JSON.parse(options.body);
        assert.equal(password, 'clave-sintetica-' + username);
        if (username === 'b') reachedB.resolve();
        return Response.json({ redirect: '/ventas' }, { headers: { 'Set-Cookie': `sid=${username.toUpperCase()}; Path=/` } });
      }
      assert.ok(url.endsWith('/api/account'));
      const username = options.headers.Cookie.split('=')[1].toLowerCase();
      return Response.json({ id: 'cuenta-' + username, username });
    },
  });
  // Only storage reconstruction and remote syncing are outside this login test.
  // Use the real serial implementation shared with writes and synchronization.
  const engine = { ledger, pool: {}, tail: Promise.resolve(), serial: DesktopEngine.prototype.serial,
    status: () => ({}), synchronize: async () => ({ connection: 'online' }) };
  const server = desktopServer(engine, remote, directory);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { releases.forEach(gate => gate.resolve()); server.closeAllConnections(); await new Promise(done => server.close(done)); ledger.close(); await removeDirectory(directory); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const login = username => fetch(origin + '/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'clave-sintetica-' + username }) });
  const first = login('a');
  await protectingA.promise;
  const second = login('b');
  // The second request must wait for the first authentication transaction.
  // Allow the old implementation to interleave at the delayed DPAPI boundary.
  await Promise.race([reachedB.promise.then(() => new Promise(done => setTimeout(done, 30))), new Promise(done => setTimeout(done, 100))]);
  releaseA.resolve();
  const responses = await Promise.all([first, second]);
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    const token = response.headers.get('set-cookie').split(';')[0].slice('felix-desktop='.length);
    const session = ledger.database.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(tokenHash(token));
    assert.equal(session.user_id, index === 0 ? 'cuenta-a' : 'cuenta-b');
  }
  const profile = ledger.get('profile');
  assert.equal(profile.username, 'b');
  assert.equal(matchesPassword('clave-sintetica-b', profile), true);
  assert.equal(matchesPassword('clave-sintetica-a', profile), false);
  assert.equal(ledger.get('remoteCookie'), 'sid=B');

  // A request from the previous session can pass the outer check while a new
  // login awaits DPAPI. Its later local 401 must not revoke the new account.
  const protection = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  nextProtection = protection; releases.push(protection.release);
  const switching = login('a');
  await protection.entered.promise;
  const admitted = once(server, 'request');
  const staleAccount = fetch(origin + '/api/account', { headers: { Cookie: responses[1].headers.get('set-cookie').split(';')[0] } });
  await admitted;
  protection.release.resolve();
  assert.equal((await switching).status, 200);
  assert.equal((await staleAccount).status, 401);
  assert.equal(ledger.get('profile').username, 'a');
  assert.equal(ledger.get('profile').allowOffline, true, 'Una sesión anterior no debe revocar la cuenta recién autenticada.');

  ledger.add({ operationId: randomUUID(), actor: { id: 'cuenta-a', name: 'a' }, occurredAt: new Date().toISOString(),
    method: 'POST', path: '/api/clientes', body: { databaseId: randomUUID(), nombre: 'Pendiente sintético' },
    result: { id: 1 }, created: {}, expected: { effect: { nombre: 'Pendiente sintético' }, cashHead: null } }, 'huella-sintetica');
  assert.equal((await login('b')).status, 409);
  assert.equal(ledger.get('profile').username, 'a');
  assert.equal(ledger.get('remoteCookie'), 'sid=A', 'Un cambio de cuenta rechazado debe conservar el acceso para sincronizar los pendientes actuales.');
});

test('Windows permite una sola instancia por carpeta y libera la exclusión al cerrar', { skip: process.platform !== 'win32', timeout: 20_000 }, async t => {
  const directory = await temporaryDirectory(t);
  let active;
  let ready = [];
  t.after(async () => { await active?.stop(); for (const result of ready.slice(1)) await result.value.stop(); await removeDirectory(directory); });
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => startDesktop({ directory, assetsDirectory: directory })));
  ready = attempts.filter(result => result.status === 'fulfilled');
  active = ready[0]?.value;
  assert.equal(ready.length, 1, 'Dos hosts no pueden mantener proyecciones distintas sobre el mismo SQLite.');
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 2);
  const origin = active.origin;
  await active.stop(); active = null;
  const occupied = createServer();
  await new Promise(done => occupied.listen(Number(new URL(origin).port), '127.0.0.1', done));
  try { await assert.rejects(startDesktop({ directory, assetsDirectory: directory }), { code: 'EADDRINUSE' }); }
  finally { await new Promise(done => occupied.close(done)); }
  active = await startDesktop({ directory, assetsDirectory: directory });
  assert.equal(active.origin, origin, 'El diario IndexedDB debe seguir accesible bajo el mismo origen tras reiniciar.');
  assert.match(active.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('Windows recupera la exclusión después de terminar el proceso abruptamente', { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const child = fork(new URL('./fixtures/desktop-start.js', import.meta.url), [], { stdio: ['pipe', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  let replacement;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await replacement?.stop();
    await removeDirectory(directory);
  });
  const ready = once(child, 'message', { signal: AbortSignal.timeout(15_000) });
  child.send({ directory });
  const original = (await ready)[0];
  assert.equal(original.ready, true);
  await assert.rejects(startDesktop({ directory, assetsDirectory: directory }));
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  replacement = await startDesktop({ directory, assetsDirectory: directory });
  assert.equal(replacement.origin, original.origin);
  assert.equal(replacement.engine.status().pending, 0);
});
