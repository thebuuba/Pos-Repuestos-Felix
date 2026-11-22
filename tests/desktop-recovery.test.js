import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation, retireSyncStream } from '../src/pos/sync-operations.js';
import { bootstrapTag } from '../src/pos/state-tag.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { tokenHash } from '../src/desktop/credentials.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'felix-desktop-recovery-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  const engine = new DesktopEngine(new DesktopLedger(directory));
  t.after(async () => {
    await engine.close(); await cloud.end(); await database.stop();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('felix-desktop-recovery-'));
    await rm(directory, { recursive: true, force: true });
  });
  await migrateDatabase(cloud);
  const actor = { id: randomUUID(), name: 'Prueba de recuperación', generation: 'inicial' };
  const remote = async (path, options) => {
    const result = await (path === '/api/sync/bootstrap'
    ? readSyncBootstrap(cloud, 'Prueba', options?.etag && (version => options.etag === bootstrapTag(version)))
    : path === '/api/sync/retire' ? retireSyncStream(cloud, options.body, 'Prueba', actor)
    : writeSyncOperation(cloud, options.body, 'Prueba', actor));
    return result.notModified ? { notModified: true, etag: bootstrapTag(result.notModified) } : result;
  };
  await engine.adopt(await remote('/api/sync/bootstrap'));
  const write = (name, key = randomUUID()) => engine.write('POST', '/api/clientes', {
    databaseId: engine.ledger.get('databaseId'), nombre: name, rnc: '', tel: '',
  }, key, actor);
  return { engine, cloud, actor, remote, write, directory };
}

async function assertDurableProjection(engine) {
  const durable = engine.ledger.backup().tables;
  // PostgreSQL's singleton configuration key is int4; SQLite stores IDs as text.
  durable.configuracion[0].id = 1;
  assert.deepEqual((await readSnapshot(engine.pool, 'Prueba', true)).tables, durable);
}

test('una descarga lenta no bloquea las escrituras y nunca reemplaza pendientes nuevos', { timeout: 60_000 }, async t => {
  const { engine, write, remote } = await fixture(t);
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  const syncing = engine.synchronize(async (path, options) => {
    const response = await remote(path, options); entered.resolve(); await release.promise; return response;
  }, { id: 'sin-pendientes' });
  await entered.promise;
  let saved;
  try {
    saved = await Promise.race([write('Cliente mientras descarga'), new Promise((_, reject) => setTimeout(() => reject(new Error('La red bloqueó el guardado local')), 1500))]);
    assert.equal(saved.state.clientes.some(row => row.nombre === 'Cliente mientras descarga'), true);
  } finally { release.resolve(); await syncing; }
  assert.equal(engine.status().pending, 1);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Cliente mientras descarga'), true);
});

test('la revisión explícita sobrevive a una respuesta perdida, conserva originales e impide reenvíos tardíos', { timeout: 90_000 }, async t => {
  const { engine, write, remote, actor, cloud, directory } = await fixture(t);
  const saved = await write('Cliente que se archivará');
  const localRevision = saved.revision;
  const localTag = engine.snapshotTag();
  const operation = engine.ledger.pending()[0];
  const envelope = engine.mappedEnvelope(operation);
  await engine.synchronize(async () => { throw Object.assign(new Error('Conflicto sintético'), { status: 409 }); }, actor);
  const target = { deviceId: engine.ledger.get('deviceId'), databaseId: engine.ledger.get('databaseId'), operationIds: [operation.operation_id], acknowledged: true };
  let lost = true;
  const unreliable = async (path, options) => {
    const response = await remote(path, options);
    if (path.endsWith('/retire') && lost) { lost = false; throw Object.assign(new Error('Respuesta perdida'), { status: 503 }); }
    return response;
  };
  await assert.rejects(engine.reconcile(unreliable, actor, target), /Respuesta perdida/);
  assert.equal(engine.status().reconciling, true);
  assert.equal(engine.status().pending, 1);
  await engine.pool.end(); engine.pool = null; engine.ledger.close();
  engine.ledger = new DesktopLedger(directory); await engine.rebuild();
  assert.equal(engine.status().reconciling, true, 'La intención pendiente sobrevive a reabrir SQLite');
  await assert.rejects(write('Mientras se desconoce el retiro'), /revisión/i);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Cliente que se archivará'), true);
  await assert.rejects(writeSyncOperation(cloud, envelope, 'Prueba', actor), /archivado/i);
  await engine.reconcile(remote, actor, target);
  assert.equal(engine.status().pending, 0);
  assert.equal(engine.status().archived, 1);
  assert.equal(engine.status().reconciling, false);
  assert.ok((await engine.snapshot()).revision > localRevision, 'El catálogo reconciliado debe superar la revisión local que reemplaza');
  assert.notEqual(engine.snapshotTag(), localTag);
  assert.notEqual(engine.ledger.get('deviceId'), target.deviceId);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Cliente que se archivará'), false);
  const archive = engine.ledger.archives()[0];
  assert.equal(archive.operations[0].record.operationId, operation.operation_id);
  assert.deepEqual(archive.operations[0].wire, envelope);
  assert.equal(archive.checkpoint.tables.clientes.some(row => row.nombre === 'Cliente que se archivará'), true);
  assert.deepEqual(archive.retirement.operationIds, target.operationIds);
  await assert.rejects(write('Cliente que se archivará', saved.localReceipt), /archivad/i);
  await write('Cliente del nuevo flujo');
  assert.equal(engine.mappedEnvelope(engine.ledger.pending()[0]).sequence, 1);
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 0);
  assert.equal((await readSnapshot(cloud, 'Prueba')).state.clientes.some(row => row.nombre === 'Cliente del nuevo flujo'), true);
});

test('una revocación durante la escritura evita el commit durable aunque memoria haya confirmado', { timeout: 60_000 }, async t => {
  const { engine, actor } = await fixture(t);
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  let active = actor;
  const connect = engine.pool.connect.bind(engine.pool);
  engine.pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    let operation = false;
    client.query = async (sql, values) => {
      const result = await query(sql, values);
      if (sql.startsWith('INSERT INTO pos_privado.solicitudes')) operation = true;
      if (operation && sql === 'COMMIT') { entered.resolve(); await release.promise; }
      return result;
    };
    return client;
  };
  const saving = engine.write('POST', '/api/clientes', { databaseId: engine.ledger.get('databaseId'), nombre: 'Revocado antes de SQLite', rnc: '', tel: '' }, randomUUID(), () => {
    if (!active) throw Object.assign(new Error('Acceso revocado'), { status: 401 });
    return active;
  });
  await entered.promise; active = null; release.resolve();
  await assert.rejects(saving, /revocado/i);
  assert.equal(engine.status().pending, 0);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Revocado antes de SQLite'), false);
});

test('el conflicto no se reenvía por sondeo y el reintento explícito conserva los bytes originales', { timeout: 60_000 }, async t => {
  const { engine, write, actor, remote } = await fixture(t);
  await write('Reintentar tras revisión');
  const packets = [];
  const rejecting = async (path, options) => {
    if (path.endsWith('/operations')) {
      packets.push(structuredClone(options.body));
      if (packets.length === 1) throw Object.assign(new Error('Conflicto comprobado'), { status: 409 });
    }
    return remote(path, options);
  };
  await engine.synchronize(rejecting, actor);
  await engine.synchronize(rejecting, actor);
  assert.equal(packets.length, 1);
  await engine.synchronize(rejecting, actor, { retryConflicts: true });
  assert.equal(engine.status().pending, 0);
  assert.deepEqual(packets[0], packets[1]);
  const executor = engine.pool;
  const tag = engine.snapshotTag();
  assert.equal((await engine.synchronize(remote, actor)).connection, 'online');
  assert.equal(engine.pool, executor, 'La descarga 304 no reconstruye tablas');
  assert.equal(engine.snapshotTag(), tag);
});

test('la revisión rechaza una lista desactualizada sin ocultar las nuevas operaciones', { timeout: 60_000 }, async t => {
  const { engine, write, remote, actor } = await fixture(t);
  await write('Primera');
  const target = { deviceId: engine.ledger.get('deviceId'), databaseId: engine.ledger.get('databaseId'), operationIds: engine.ledger.pending().map(row => row.operation_id), acknowledged: true };
  await write('Segunda');
  await assert.rejects(engine.reconcile(remote, actor, target), /cambi/i);
  assert.equal(engine.status().pending, 2);
  assert.equal(engine.status().archived, 0);
});

test('un retiro rechazado por recibo ya confirmado libera la revisión sin archivar la operación', { timeout: 60_000 }, async t => {
  const { engine, write, actor, remote } = await fixture(t);
  await write('Confirmación perdida');
  await engine.synchronize(async (path, options) => {
    const result = await remote(path, options);
    if (path.endsWith('/operations')) throw Object.assign(new Error('Se perdió el recibo'), { status: 503 });
    return result;
  }, actor);
  assert.equal(engine.status().pending, 1);
  const target = { deviceId: engine.ledger.get('deviceId'), databaseId: engine.ledger.get('databaseId'), operationIds: engine.ledger.pending().map(row => row.operation_id), acknowledged: true };
  await assert.rejects(engine.reconcile(remote, actor, target), error => error.status === 409 && error.retirementRejection?.actorId === actor.id);
  assert.equal(engine.status().reconciling, false);
  assert.equal(engine.status().archived, 0);
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 0);
  assert.equal((await engine.snapshot()).state.clientes.filter(row => row.nombre === 'Confirmación perdida').length, 1);
});

test('una respuesta lenta comparte un solo envío y deja leer la venta local', { timeout: 60_000 }, async t => {
  const { engine, write, actor, remote } = await fixture(t);
  await write('Cliente pendiente');
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  let calls = 0;
  const delayed = async (path, options) => {
    if (path.endsWith('/operations')) { calls++; entered.resolve(); await release.promise; }
    return remote(path, options);
  };
  const first = engine.synchronize(delayed, actor);
  await entered.promise;
  const second = engine.synchronize(delayed, actor);
  try {
    const state = await Promise.race([engine.serial(() => engine.snapshot()), new Promise((_, reject) => setTimeout(() => reject(new Error('La red bloqueó la lectura local')), 1500))]);
    assert.equal(state.state.clientes.some(row => row.nombre === 'Cliente pendiente'), true);
  } finally { release.resolve(); await Promise.all([first, second]); }
  assert.equal(calls, 1);
});

test('un rechazo validado conserva el ejecutor; un fallo del commit SQLite reconstruye lo durable', { timeout: 60_000 }, async t => {
  const { engine, write } = await fixture(t);
  const executor = engine.pool;
  await assert.rejects(write(''), error => error.status === 400);
  assert.equal(engine.pool, executor, 'Un ROLLBACK confirmado no requiere reconstruir el catálogo');
  const transaction = engine.ledger.transaction.bind(engine.ledger);
  engine.ledger.transaction = action => transaction(() => { action(); throw new Error('Disco lleno sintético'); });
  await assert.rejects(write('No debe persistir'), /Disco lleno/);
  engine.ledger.transaction = transaction;
  assert.notEqual(engine.pool, executor);
  assert.equal(engine.status().pending, 0);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'No debe persistir'), false);
});

test('un recibo tardío no se incorpora después de cambiar la generación de la cuenta', { timeout: 60_000 }, async t => {
  const { engine, write, actor, remote } = await fixture(t);
  await write('Recibo de otra sesión');
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  let current = actor;
  const syncing = engine.synchronize(async (path, options) => {
    const result = await remote(path, options); entered.resolve(); await release.promise; return result;
  }, () => current);
  await entered.promise;
  current = { ...actor, generation: 'renovada' };
  release.resolve(); await syncing;
  assert.equal(engine.status().pending, 1, 'El recibo queda recuperable con la misma clave al volver a autenticar');
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 0);
});

test('el gateway valida identidad para renovar acceso y sirve estado condicional sin recorrer el catálogo', { timeout: 60_000 }, async t => {
  const { engine, remote, actor, directory } = await fixture(t);
  const onlineAt = Date.now() - 29 * 86400000;
  engine.ledger.set('profile', { ...actor, username: 'sintetico', allowOffline: true, onlineAt });
  engine.ledger.set('remoteCookie', 'sesion-sintetica');
  const token = 'token-sintetico';
  engine.ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), actor.id, Date.now() + 86400000);
  let identity = actor;
  const server = desktopServer(engine, { request: (path, options) => path === '/api/account' ? Promise.resolve(identity) : remote(path, options), clear() {} }, directory);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (path, options = {}) => fetch(origin + path, { ...options, headers: { Cookie: 'felix-desktop=' + token, Origin: origin, 'Content-Type': 'application/json', ...options.headers } });
  const initial = await call('/api/state');
  assert.equal(initial.status, 200);
  const etag = initial.headers.get('etag');
  assert.ok(etag, 'Windows devuelve el mismo contrato ETag que web');
  const snapshot = engine.snapshot;
  engine.snapshot = () => { throw new Error('Una versión igual no debe recorrer las tablas'); };
  const unchanged = await call('/api/state', { headers: { 'If-None-Match': etag } });
  engine.snapshot = snapshot;
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  engine.ledger.database.prepare('INSERT INTO remembered_sessions VALUES(?)').run(tokenHash(token));
  engine.ledger.database.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(Date.now() + 60_000, tokenHash(token));
  const renewed = await call('/api/state', { headers: { 'If-None-Match': etag } });
  assert.match(renewed.headers.get('set-cookie') || '', /Max-Age=2592000/);
  assert.ok(engine.ledger.database.prepare('SELECT expires FROM sessions WHERE token_hash=?').get(tokenHash(token)).expires > Date.now() + 29 * 86400000);
  assert.equal(engine.ledger.get('profile').onlineAt, onlineAt, 'El uso offline no renueva la identidad del servidor');
  assert.equal((await call('/api/desktop/sync', { method: 'POST', body: '{}' })).status, 200);
  assert.ok(engine.ledger.get('profile').onlineAt > onlineAt);
  const local = await call('/api/clientes', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ databaseId: engine.ledger.get('databaseId'), nombre: 'Para revisar desde gateway', rnc: '', tel: '' }) });
  assert.equal(local.status, 200);
  assert.notEqual(local.headers.get('etag'), etag);
  // Wait for the automatic delivery before preparing a deliberately conflicting operation.
  await call('/api/desktop/sync', { method: 'POST', body: '{}' });
  const row = engine.ledger.pending()[0];
  assert.equal(row, undefined);
  await engine.write('POST', '/api/clientes', { databaseId: engine.ledger.get('databaseId'), nombre: 'Archivo desde gateway', rnc: '', tel: '' }, randomUUID(), actor);
  const review = await (await call('/api/desktop/reconciliation')).json();
  assert.equal(review.operations.length, 1);
  assert.equal(review.resuming, false);
  const selected = { deviceId: review.deviceId, databaseId: review.databaseId, operationIds: review.operationIds, acknowledged: false };
  assert.equal((await call('/api/desktop/reconcile', { method: 'POST', body: JSON.stringify(selected) })).status, 409);
  const archived = await call('/api/desktop/reconcile', { method: 'POST', body: JSON.stringify({ ...selected, acknowledged: true }) });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).archived, 1);
  const exported = await call('/api/desktop/archive');
  assert.match(exported.headers.get('content-disposition'), /historial-revision/);
  assert.equal((await exported.json()).archives[0].operations[0].record.body.nombre, 'Archivo desde gateway');
  const verifiedAt = engine.ledger.get('profile').onlineAt;
  identity = { id: randomUUID(), name: 'Otra cuenta' };
  await call('/api/desktop/sync', { method: 'POST', body: '{}' });
  assert.equal(engine.ledger.get('profile').onlineAt, verifiedAt);
  assert.equal(engine.ledger.get('profile').allowOffline, false);
});

test('cerrar el gateway durante la verificación remota impide accesos tardíos a SQLite', { timeout: 60_000 }, async t => {
  const { engine, actor, directory } = await fixture(t);
  engine.ledger.set('profile', { ...actor, username: 'cierre', allowOffline: true, onlineAt: Date.now() });
  engine.ledger.set('remoteCookie', 'sesion-sintetica');
  const token = 'token-cierre';
  engine.ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), actor.id, Date.now() + 86400000);
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  const server = desktopServer(engine, { async request() { entered.resolve(); await release.promise; return actor; }, clear() {} }, directory);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { release.resolve(); if (server.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const request = fetch(origin + '/api/desktop/sync', { method: 'POST', headers: { Cookie: 'felix-desktop=' + token, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  await entered.promise;
  server.closeAllConnections(); await new Promise(done => server.close(done));
  let reads = 0;
  const get = engine.ledger.get.bind(engine.ledger);
  engine.ledger.get = key => { reads++; return get(key); };
  release.resolve();
  await request; await new Promise(done => setImmediate(done));
  engine.ledger.get = get;
  assert.equal(reads, 0, 'Una respuesta remota posterior al cierre no debe tocar el diario que ya se puede cerrar');
});

test('la descarga reutiliza el ejecutor migrado y conserva la proyección autoritativa con sus identidades', { timeout: 60_000 }, async t => {
  const { engine, cloud, actor, remote, write } = await fixture(t);
  const executor = engine.pool;
  await cloud.query("SELECT setval(pg_get_serial_sequence('clientes','id'),100,false)");
  const local = await write('Cliente creado en Windows');
  await engine.synchronize(remote, actor);
  assert.equal(engine.pool, executor, 'Confirmar un envío propio no reinicia PGlite ni vuelve a migrarlo');
  assert.equal(engine.status().pending, 0);
  assert.equal(engine.ledger.remoteId('clientes', local.result.id), 100);
  await writeOperation(cloud, 'POST', '/api/clientes', { databaseId: engine.ledger.get('databaseId'), nombre: 'Cliente creado en web', rnc: '', tel: '' }, randomUUID(), 'Prueba', actor);
  await engine.synchronize(remote, actor);
  assert.equal(engine.pool, executor);
  const state = await engine.snapshot();
  assert.equal(state.state.clientes.find(row => row.nombre === 'Cliente creado en Windows').id, local.result.id);
  assert.ok(state.state.clientes.some(row => row.nombre === 'Cliente creado en web'));
  await assertDurableProjection(engine);
  const connection = await executor.connect();
  try { assert.equal(Number((await connection.query('SELECT count(*) AS n FROM pos_privado.solicitudes')).rows[0].n), 0); }
  finally { connection.release(); }
  const next = await write('Otro cliente local');
  assert.ok(next.result.id > Math.max(...state.state.clientes.map(row => row.id)), 'Las secuencias respetan las identidades locales ya reservadas');
});

test('un fallo de actualización en memoria deja SQLite íntegro y exige reconstruir antes de acceder', { timeout: 90_000 }, async t => {
  const { engine, cloud, actor, remote } = await fixture(t);
  for (const phase of ['restore', 'metadata', 'commit']) {
    const name = 'Conservar descarga: ' + phase;
    await writeOperation(cloud, 'POST', '/api/clientes', { databaseId: engine.ledger.get('databaseId'), nombre: name, rnc: '', tel: '' }, randomUUID(), 'Prueba', actor);
    const download = await remote('/api/sync/bootstrap');
    const executor = engine.pool;
    const connect = executor.connect.bind(executor);
    executor.connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      let restoring = false;
      client.query = async (sql, values) => {
        if (sql.startsWith('DELETE FROM public.')) restoring = true;
        if (phase === 'restore' && sql.startsWith('INSERT INTO public.clientes') ||
            phase === 'metadata' && sql.startsWith('UPDATE pos_privado.sistema SET database_id=$1,revision=$2'))
          throw new Error('Fallo sintético: ' + phase);
        const result = await query(sql, values);
        if (phase === 'commit' && restoring && sql === 'COMMIT') throw new Error('Fallo sintético: ' + phase);
        return result;
      };
      return client;
    };
    await assert.rejects(engine.adopt(download), new RegExp('Fallo sintético: ' + phase));
    assert.equal(engine.pool, null);
    assert.equal(engine.status().initialized, false);
    await assert.rejects(engine.snapshot(), error => error.status === 503);
    assert.ok(engine.ledger.backup().tables.clientes.some(row => row.nombre === name));
    await engine.rebuild();
    assert.notEqual(engine.pool, executor);
    const rebuilt = await engine.snapshot();
    assert.equal(rebuilt.databaseId, download.snapshot.databaseId);
    assert.equal(rebuilt.revision, engine.ledger.get('revision'));
    assert.ok(rebuilt.state.clientes.some(row => row.nombre === name));
    await assertDurableProjection(engine);
  }
});
