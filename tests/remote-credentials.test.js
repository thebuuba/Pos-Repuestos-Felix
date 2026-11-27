import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { RemoteClient } from '../src/desktop/credentials.js';

const name = '__Host-felix-session';
const original = name + '=original';
const secrets = { protect: async value => value, unprotect: async value => value };

async function client(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'felix-credentials-'));
  const ledger = new DesktopLedger(directory);
  t.after(async () => {
    ledger.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('felix-credentials-'));
    await rm(directory, { recursive: true, force: true });
  });
  ledger.set('remoteCookie', original);
  const remote = new RemoteClient(ledger, { origin: 'https://synthetic.invalid', secrets, ...options });
  return { remote, ledger };
}

function response(cookies, status = 200) {
  const headers = new Headers();
  cookies.forEach(cookie => headers.append('Set-Cookie', cookie));
  return Response.json(status === 200 ? { ok: true } : { error: 'Respuesta sintética' }, { status, headers });
}

test('el cliente Windows conserva solo la cookie propia entre múltiples encabezados', async t => {
  for (const fallback of [false, true]) {
    for (const cookies of [
      ['cf_bm=foreign; Path=/', name + '=renewed; Path=/', 'analytics=foreign; Path=/'],
      [name + '=renewed; Path=/', 'analytics=foreign; Path=/'],
      ['analytics=foreign; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/', name + '=renewed; Path=/'],
    ]) {
      await t.test(`cookie ${cookies.indexOf(name + '=renewed; Path=/')} con fallback ${fallback}`, async t => {
        const { remote, ledger } = await client(t, { fetcher: async () => {
          const result = response(cookies);
          if (fallback) Object.defineProperty(result.headers, 'getSetCookie', { value: undefined });
          return result;
        } });
        await remote.request('/api/account');
        assert.equal(remote.cookie, name + '=renewed');
        assert.equal(ledger.get('remoteCookie'), name + '=renewed');
      });
    }
  }
});

test('las cookies ajenas y las respuestas transitorias no reemplazan credenciales válidas', async t => {
  for (const [cookies, status] of [
    [['analytics=foreign; Path=/'], 200],
    [['felix-session=wrong-scope; Path=/'], 200],
    [[name + '=unconfirmed; Path=/'], 503],
    [[name + '=; Max-Age=0; Path=/'], 429],
    [[name + '=redirect; Path=/'], 302],
  ]) {
    await t.test(`${cookies[0]} (${status})`, async t => {
      const { remote, ledger } = await client(t, { fetcher: async () => response(cookies, status) });
      if (status === 200) await remote.request('/api/account');
      else await assert.rejects(remote.request('/api/account'), { status });
      assert.equal(remote.cookie, original);
      assert.equal(ledger.get('remoteCookie'), original);
    });
  }
});

test('la eliminación o expiración propia borra memoria y SQLite, incluso tras reabrir', async t => {
  for (const cookie of [
    name + '=; Path=/; Max-Age=0',
    name + '=previous; Path=/; Max-Age=-1',
    name + '=previous; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]) {
    await t.test(cookie, async t => {
      const { remote, ledger } = await client(t, { fetcher: async () => response(['analytics=foreign; Path=/', cookie]) });
      await remote.request('/logout', { method: 'POST' });
      assert.equal(remote.cookie, '');
      assert.equal(ledger.get('remoteCookie'), null);
      const reopened = new RemoteClient(ledger, { origin: remote.origin, secrets, fetcher: async (_url, options) => {
        assert.equal(options.headers.Cookie, undefined);
        return Response.json({ ok: true });
      } });
      await reopened.request('/api/account');
    });
  }
});

test('Max-Age positivo tiene prioridad sobre Expires antiguo', async t => {
  const { remote, ledger } = await client(t, { fetcher: async () => response([name + '=renewed; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT']) });
  await remote.request('/api/account');
  assert.equal(remote.cookie, name + '=renewed');
  assert.equal(ledger.get('remoteCookie'), name + '=renewed');
});

test('un 401 autenticado limpia credenciales, un intento de ingreso incorrecto las conserva', async t => {
  const { remote, ledger } = await client(t, { fetcher: async () => response([name + '=unconfirmed; Path=/'], 401) });
  await assert.rejects(remote.request('/login', { method: 'POST', authenticated: false }), { status: 401 });
  assert.equal(ledger.get('remoteCookie'), original);
  await assert.rejects(remote.request('/api/account'), { status: 401 });
  assert.equal(remote.cookie, '');
  assert.equal(ledger.get('remoteCookie'), null);
});

test('un fallo de DPAPI no cambia la credencial en memoria antes de persistir', async t => {
  const { remote, ledger } = await client(t, {
    fetcher: async () => response([name + '=renewed; Path=/']),
    secrets: { ...secrets, protect: async () => { throw new Error('DPAPI sintético'); } },
  });
  await assert.rejects(remote.request('/api/account'), /DPAPI sintético/);
  assert.equal(remote.cookie, original);
  assert.equal(ledger.get('remoteCookie'), original);
});

test('un guardado DPAPI pendiente no restaura la sesión después de clear', async t => {
  const protecting = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { remote, ledger } = await client(t, {
    fetcher: async () => response([name + '=renewed; Path=/']),
    secrets: { ...secrets, protect: async value => { protecting.resolve(); await release.promise; return value; } },
  });
  const pending = remote.request('/api/account');
  await protecting.promise;
  remote.clear();
  release.resolve();
  await pending;
  assert.equal(remote.cookie, '');
  assert.equal(ledger.get('remoteCookie'), null);
});

test('una lectura DPAPI anterior al login aborta sin enviar ni revocar la credencial nueva', async t => {
  const unprotecting = Promise.withResolvers();
  const releaseUnprotect = Promise.withResolvers();
  const loggingIn = Promise.withResolvers();
  const releaseLogin = Promise.withResolvers();
  let accountRequests = 0;
  const { remote, ledger } = await client(t, {
    secrets: { ...secrets, unprotect: async value => { unprotecting.resolve(); await releaseUnprotect.promise; return value; } },
    fetcher: async url => {
      if (url.endsWith('/login')) {
        loggingIn.resolve(); await releaseLogin.promise;
        return response([name + '=new-account; Path=/']);
      }
      accountRequests++;
      return response([], 401);
    },
  });
  t.after(() => { releaseUnprotect.resolve(); releaseLogin.resolve(); });
  const oldResult = remote.request('/api/account').then(value => ({ value }), error => ({ error }));
  await unprotecting.promise;
  remote.invalidatePending();
  const login = remote.request('/login', { method: 'POST', authenticated: false });
  await loggingIn.promise;
  releaseUnprotect.resolve();
  const old = await oldResult;
  releaseLogin.resolve();
  assert.deepEqual(await login, { ok: true });
  assert.equal(remote.cookie, name + '=new-account');
  assert.equal(ledger.get('remoteCookie'), name + '=new-account');
  assert.equal(old.error?.status, 503, 'Una invalidación local no prueba revocación remota.');
  assert.equal(accountRequests, 0, 'La petición invalidada no puede usar las credenciales leídas antes del login.');
});

test('el rechazo tardío de una credencial anterior no elimina la cuenta recién ingresada', async t => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { remote, ledger } = await client(t, { fetcher: async url => {
    if (url.endsWith('/login')) return response([name + '=new-account; Path=/']);
    entered.resolve(); await release.promise;
    return response([name + '=; Max-Age=0; Path=/'], 401);
  } });
  const old = remote.request('/api/account');
  const rejection = assert.rejects(old, { status: 401 });
  await entered.promise;
  await remote.request('/login', { method: 'POST', authenticated: false });
  release.resolve();
  await rejection;
  assert.equal(remote.cookie, name + '=new-account');
  assert.equal(ledger.get('remoteCookie'), name + '=new-account');
});

test('bootstrap condicional 304 confirma la revisión conocida y conserva la cookie renovada', async t => {
  const { remote, ledger } = await client(t, { fetcher: async (_url, options) => {
    assert.equal(options.headers['If-None-Match'], '"snapshot-known"');
    return new Response(null, { status: 304, headers: { ETag: '"snapshot-known"', 'Set-Cookie': name + '=renewed; Path=/' } });
  } });
  assert.deepEqual(await remote.request('/api/sync/bootstrap', { etag: '"snapshot-known"' }), { notModified: true, etag: '"snapshot-known"' });
  assert.equal(remote.cookie, name + '=renewed');
  assert.equal(ledger.get('remoteCookie'), name + '=renewed');
});

test('un 304 no solicitado o con revisión distinta no confirma sincronización', async t => {
  for (const [path, etag, received] of [
    ['/api/sync/bootstrap', undefined, '"known"'],
    ['/api/sync/bootstrap', '"known"', '"different"'],
    ['/api/sync/bootstrap', '"known"', null],
    ['/api/account', '"known"', '"known"'],
  ]) {
    await t.test(`${path} ${etag} ${received}`, async t => {
      const { remote, ledger } = await client(t, { fetcher: async () => new Response(null, {
        status: 304, headers: { ...(received && { ETag: received }), 'Set-Cookie': name + '=unconfirmed; Path=/' },
      }) });
      await assert.rejects(remote.request(path, { etag }), { status: 503 });
      assert.equal(ledger.get('remoteCookie'), original);
    });
  }
});

test('el rechazo definitivo de retiro conserva su prueba y nunca inventa una en otros errores', async t => {
  const proof = { deviceId: 'synthetic-device', databaseId: 'synthetic-database', operationIds: ['synthetic-operation'], actorId: 'synthetic-user' };
  for (const [path, status, retirementRejection, expected] of [
    ['/api/sync/retire', 409, proof, proof],
    ['/api/sync/retire', 503, proof, undefined],
    ['/api/sync/operations', 409, proof, undefined],
    ['/api/sync/retire', 409, null, undefined],
    ['/api/sync/retire', 409, [], undefined],
    ['/api/sync/retire', 409, 'unconfirmed', undefined],
  ]) {
    await t.test(`${path} ${status} ${JSON.stringify(retirementRejection)}`, async t => {
      const { remote, ledger } = await client(t, { fetcher: async () => Response.json({ error: 'Retiro rechazado', retirementRejection }, { status }) });
      await assert.rejects(remote.request(path, { method: 'POST' }), error => {
        assert.equal(error.status, status);
        assert.equal(error.message, 'Retiro rechazado');
        assert.deepEqual(error.retirementRejection, expected);
        return true;
      });
      assert.equal(ledger.get('remoteCookie'), original);
    });
  }
});

test('receiptOnly solicita respuestas compactas únicamente al enviar operaciones de sincronización', async t => {
  const compact = { snapshot: { databaseId: 'synthetic-database', revision: 5, databaseLabel: 'Prueba' }, receipt: { operationId: 'synthetic-operation' } };
  for (const [path, method, receiptOnly, expected] of [
    ['/api/sync/operations', 'POST', true, 'return=receipt'],
    ['/api/sync/operations', 'POST', false, undefined],
    ['/api/sync/operations', 'POST', undefined, undefined],
    ['/api/sync/operations', 'GET', true, undefined],
    ['/api/sync/operations', 'PUT', true, undefined],
    ['/api/sync/retire', 'POST', true, undefined],
    ['/api/sync/bootstrap', 'GET', true, undefined],
  ]) {
    await t.test(`${method} ${path} ${receiptOnly}`, async t => {
      let sent;
      const { remote } = await client(t, { fetcher: async (_url, options) => { sent = options; return Response.json(compact); } });
      assert.deepEqual(await remote.request(path, { method, receiptOnly }), compact);
      assert.equal(sent.headers.Prefer, expected);
      assert.equal(sent.headers['X-Felix-Backup-Version'], '12');
    });
  }
  let accountHeaders;
  const { remote } = await client(t, { fetcher: async (_url, options) => { accountHeaders = options.headers; return Response.json({ id: 'u1' }); } });
  await remote.request('/api/account');
  assert.equal(accountHeaders['X-Felix-Backup-Version'], undefined);
});
