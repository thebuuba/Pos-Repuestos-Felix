import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import * as sync from '../src/pos/sync-operations.js';
import { handleRequest } from '../src/http/app.js';

let database, cloud, local, empty;
const actor = { id: randomUUID(), name: 'Auditoría desechable' };
const label = 'Prueba de sincronización';
const read = pool => readSnapshot(pool, label);
async function write(pool, path, payload, method = 'POST', occurredAt) {
  return writeOperation(pool, method, path, { ...payload, databaseId: (await read(pool)).databaseId }, randomUUID(), label, actor, occurredAt ? { occurredAt } : {});
}
before(async () => {
  database = await temporaryPostgres();
  cloud = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(cloud);
  await cloud.query('CREATE DATABASE felix_recovery_local');
  const url = new URL(database.connectionString); url.pathname = '/felix_recovery_local';
  local = new pg.Pool({ connectionString: url.href });
  await migrateDatabase(local);
  empty = (await sync.readSyncBootstrap(cloud, label)).backup;
});
after(async () => { await local?.end(); await cloud?.end(); await database?.stop(); });

async function scenario() {
  await write(cloud, '/api/restore', { revision: (await read(cloud)).revision, backup: empty });
  await write(cloud, '/api/productos', { codigo: 'TEST-SYNC', nombre: 'Repuesto', stock: '20', costo: '1.0001', precio1: '118.1234', precio2: 90, precio3: 0 });
  await write(cloud, '/api/caja/abrir', { monto: '100.00' });
  const boot = await sync.readSyncBootstrap(cloud, label);
  await write(local, '/api/restore', { revision: (await read(local)).revision, backup: boot.backup });
  const state = boot.snapshot.state;
  return { boot, payload: { cajaId: state.caja.session.id, clienteId: state.clientes[0].id,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: state.configuracionVersion,
    items: [{ productoId: state.productos[0].id, versionProducto: state.productos[0].version, cantidad: 1, nivelPrecio: 'precio1' }] } };
}
async function prepare(boot, payload, { deviceId = randomUUID(), sequence = 1, path = '/api/ventas' } = {}) {
  const before = await sync.readSyncBootstrap(local, label);
  const occurredAt = new Date().toISOString();
  const saved = await write(local, path, payload, 'POST', occurredAt);
  const backup = (await sync.readSyncBootstrap(local, label)).backup;
  return { operationId: randomUUID(), deviceId, sequence, method: 'POST', path, occurredAt,
    body: { ...payload, databaseId: boot.snapshot.databaseId }, expected: {
      effect: sync.operationEffect('POST', path, payload, saved.result, backup),
      cashHead: path === '/api/ventas' || path.startsWith('/api/caja/') ? before.cashHead : null,
    } };
}

test('bootstrap unchanged avoids table scans and writes return a usable state ETag', async () => {
  const first = await handleRequest(new Request('http://localhost/api/sync/bootstrap'), { pool: cloud, databaseLabel: label });
  const tag = first.headers.get('etag');
  assert.ok(tag, 'bootstrap debe entregar ETag');
  const sql = [];
  const observed = { async connect() { const client = await cloud.connect(); return {
    query(statement, ...args) { sql.push(statement); return client.query(statement, ...args); }, release: () => client.release(),
  }; } };
  const same = await handleRequest(new Request('http://localhost/api/sync/bootstrap', { headers: { 'If-None-Match': tag } }), { pool: observed, databaseLabel: label });
  assert.equal(same.status, 304);
  assert.equal(sql.filter(s => /FROM public\./.test(s)).length, 0);
  const response = await handleRequest(new Request('http://localhost/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: (await read(cloud)).databaseId, nombre: 'Cliente de prueba' }) }), { pool: cloud, databaseLabel: label });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('etag'));
  const refreshed = await handleRequest(new Request('http://localhost/api/state', { headers: { 'If-None-Match': response.headers.get('etag') } }), { pool: cloud, databaseLabel: label });
  assert.equal(refreshed.status, 304);
});

test('Windows and PWA sales of the same article reconcile exact receipts and current stock', async () => {
  const { boot, payload } = await scenario();
  const envelope = await prepare(boot, payload);
  await write(cloud, '/api/ventas', payload);
  const reply = await sync.writeSyncOperation(cloud, envelope, label, actor);
  assert.deepEqual(reply.receipt.effect, envelope.expected.effect);
  assert.equal(reply.snapshot.state.facturas.length, 2);
  assert.equal(reply.snapshot.state.productos[0].stock, 18);
  const replay = await sync.writeSyncOperation(cloud, envelope, label, actor);
  assert.equal(replay.receipt.replayed, true);
  assert.equal(replay.snapshot.state.facturas.length, 2);
});

test('concurrent sales still reject changed price, insufficient stock and closed cash', async () => {
  for (const cause of ['price', 'stock', 'closed']) {
    const { boot, payload } = await scenario();
    const envelope = await prepare(boot, payload);
    if (cause === 'price') {
      const product = boot.snapshot.state.productos[0];
      await write(cloud, '/api/productos/' + product.id, { ...product, version: product.version, precio1: '300.0000' }, 'PUT');
    } else if (cause === 'stock') await write(cloud, '/api/ventas', { ...payload, items: [{ ...payload.items[0], cantidad: 20 }] });
    else await write(cloud, '/api/caja/cerrar', { cajaId: payload.cajaId, version: boot.snapshot.state.caja.session.version, conteo: 100 });
    const before = await read(cloud);
    await assert.rejects(sync.writeSyncOperation(cloud, envelope, label, actor), { status: 409 }, cause);
    assert.deepEqual(await read(cloud), before, cause + ' debe revertir sin contabilizar');
  }
});

test('retirement is durable and idempotent, blocks late delivery and never retires an acknowledged sale', async () => {
  assert.equal(typeof sync.retireSyncStream, 'function');
  const { boot, payload } = await scenario();
  const envelope = await prepare(boot, payload);
  const body = { deviceId: envelope.deviceId, databaseId: envelope.body.databaseId, operationIds: [envelope.operationId] };
  const retired = await sync.retireSyncStream(cloud, body, label, actor);
  assert.deepEqual(retired.retirement.operationIds, body.operationIds);
  assert.equal(retired.retirement.actorId, actor.id);
  const repeat = await sync.retireSyncStream(cloud, body, label, actor);
  assert.deepEqual(repeat.retirement, retired.retirement);
  await assert.rejects(sync.writeSyncOperation(cloud, envelope, label, actor), { status: 409 });
  assert.equal((await read(cloud)).state.facturas.length, 0);
  const next = { ...envelope, deviceId: randomUUID(), operationId: randomUUID() };
  await sync.writeSyncOperation(cloud, next, label, actor);
  await assert.rejects(sync.retireSyncStream(cloud, { deviceId: next.deviceId, databaseId: next.body.databaseId, operationIds: [next.operationId] }, label, actor), { status: 409 });
  assert.equal((await read(cloud)).state.facturas.length, 1);
});

test('device sequence uses its durable primary-key cursor after the initial historical lookup', async () => {
  const { boot } = await scenario();
  const first = await prepare(boot, { nombre: 'Primero' }, { path: '/api/clientes' });
  await sync.writeSyncOperation(cloud, first, label, actor);
  const second = await prepare(boot, { nombre: 'Segundo' }, { path: '/api/clientes', deviceId: first.deviceId, sequence: 2 });
  const sql = [];
  const observed = { async connect() { const client = await cloud.connect(); return {
    query(statement, ...args) { sql.push(statement); return client.query(statement, ...args); }, release: () => client.release(),
  }; } };
  await sync.writeSyncOperation(observed, second, label, actor);
  assert.equal(sql.filter(statement => /WHERE resultado->'metadata'/.test(statement)).length, 0, 'no debe recorrer todo el historial');
});

test('compact synchronization returns its exact receipt without exporting the catalog', async () => {
  const { boot, payload } = await scenario();
  const envelope = await prepare(boot, payload);
  const sql = [];
  const observed = { async connect() { const client = await cloud.connect(); return {
    query(statement, ...args) { sql.push(statement); return client.query(statement, ...args); }, release: () => client.release(),
  }; } };
  const response = await sync.writeSyncOperation(observed, envelope, label, actor, { receiptOnly: true });
  assert.equal(response.snapshot.state, undefined);
  assert.equal(response.backup, undefined);
  assert.deepEqual(response.receipt.effect, envelope.expected.effect);
  assert.equal(sql.filter(statement => /FROM public\.productos ORDER BY id/.test(statement)).length, 0);
  assert.equal(sql.filter(statement => /FROM public\.ventas ORDER BY id/.test(statement)).length, 0);
});

test('restored generations can archive their old receipts and current confirmed receipts prove retirement rejection', async () => {
  const { boot, payload } = await scenario();
  const envelope = await prepare(boot, payload);
  await sync.writeSyncOperation(cloud, envelope, label, actor);
  const request = { deviceId: envelope.deviceId, databaseId: envelope.body.databaseId, operationIds: [envelope.operationId] };
  await assert.rejects(sync.retireSyncStream(cloud, request, label, actor), error => {
    assert.deepEqual(error.retirementRejection, { ...request, actorId: actor.id }); return error.status === 409;
  });
  await write(cloud, '/api/restore', { revision: (await read(cloud)).revision, backup: empty });
  const result = await sync.retireSyncStream(cloud, request, label, actor);
  assert.notEqual(result.snapshot.databaseId, request.databaseId);
  assert.equal(result.retirement.previouslyConfirmed[0].operationId, envelope.operationId);
});

test('a legacy delivery cannot reuse a sequence hidden by an older durable cursor', async () => {
  const { boot } = await scenario();
  const first = await prepare(boot, { nombre: 'Primero del flujo' }, { path: '/api/clientes' });
  await sync.writeSyncOperation(cloud, first, label, actor);
  const cursor = (await cloud.query("SELECT clave,resultado FROM pos_privado.solicitudes WHERE tipo='sync:cursor' AND resultado->>'databaseId'=$1", [boot.snapshot.databaseId])).rows[0];
  const legacy = await prepare(boot, { nombre: 'Escritor anterior' }, { path: '/api/clientes', deviceId: first.deviceId, sequence: 2 });
  await sync.writeSyncOperation(cloud, legacy, label, actor);
  // An older server stores the same receipt/revision but does not maintain the new cursor.
  await cloud.query('UPDATE pos_privado.solicitudes SET resultado=$2 WHERE clave=$1', [cursor.clave, cursor.resultado]);
  const duplicate = await prepare(boot, { nombre: 'No debe reutilizar secuencia' }, { path: '/api/clientes', deviceId: first.deviceId, sequence: 2 });
  await assert.rejects(sync.writeSyncOperation(cloud, duplicate, label, actor), { status: 409 });
  assert.equal((await read(cloud)).state.clientes.some(row => row.nombre === 'No debe reutilizar secuencia'), false);
});
