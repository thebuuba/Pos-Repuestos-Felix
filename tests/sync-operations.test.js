import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation, cashHeadFromBackup, operationEffect } from '../src/pos/sync-operations.js';
import { CURRENT_BACKUP_VERSION, backupLayout } from '../src/pos/relational-backup.js';
import { redactBootstrapForRole } from '../src/pos/roles.js';
import { createApp } from '../src/server.js';
import { handleRequest } from '../src/http/app.js';
import { hostingConfig } from '../src/hosting.js';

let database, cloud, local, server, base;
const actor = { id: randomUUID(), name: 'Cajero offline' };
const read = pool => readSnapshot(pool, 'Prueba');
async function write(pool, path, payload, method = 'POST', occurredAt) {
  return writeOperation(pool, method, path, { ...payload, databaseId: (await read(pool)).databaseId },
    randomUUID(), 'Prueba', actor, occurredAt ? { occurredAt } : undefined);
}
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin);
  await admin.query('CREATE DATABASE felix_sync_local');
  const url = new URL(database.connectionString); url.pathname = '/felix_sync_local';
  local = new pg.Pool({ connectionString: url.href });
  await migrateDatabase(local); await admin.end();
  cloud = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(cloud);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await cloud?.end(); await local?.end(); await database?.stop();
});
async function checkpoint() {
  const boot = await readSyncBootstrap(cloud, 'Prueba');
  await write(local, '/api/restore', { backup: boot.backup, revision: (await read(local)).revision });
  return boot;
}
async function prepare(boot, path, payload, { method = 'POST', deviceId = randomUUID(), sequence = 1, occurredAt = new Date().toISOString() } = {}) {
  const before = await readSyncBootstrap(local, 'Prueba');
  const saved = await write(local, path, payload, method, occurredAt);
  const after = await readSyncBootstrap(local, 'Prueba');
  return { deviceId, sequence, operationId: randomUUID(), method, path,
    body: { ...payload, databaseId: boot.snapshot.databaseId }, occurredAt,
    expected: { effect: operationEffect(method, path, payload, saved.result, after.backup),
      cashHead: path === '/api/ventas' || path.startsWith('/api/caja/') ? before.cashHead : null } };
}

test('bootstrap is a coherent relational checkpoint with the latest closed cash head', async () => {
  const boot = await readSyncBootstrap(cloud, 'Prueba');
  assert.equal(boot.backup.version, 10);
  assert.deepEqual(boot.catalogo, boot.snapshot.state.catalogo);
  assert.deepEqual(boot.cashHead, cashHeadFromBackup(boot.backup));
  assert.deepEqual(boot.cashHead, { id: null, version: null, open: false, latestAt: null });
  const response = await fetch(base + '/api/sync/bootstrap');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).snapshot.databaseId, boot.snapshot.databaseId);
});

test('offline opening and sale preserve exact price and original date across duplicate delivery', async () => {
  await write(cloud, '/api/productos', { codigo: 'SYNC', nombre: 'Artículo sincronizado', costo: '1.0001', stock: '5.25', precio1: '118.1234', precio2: 100, precio3: 90 });
  const boot = await checkpoint();
  const openedAt = new Date(Date.now() - 86400000).toISOString();
  const opening = await prepare(boot, '/api/caja/abrir', { monto: '100' }, { occurredAt: openedAt });
  const opened = await writeSyncOperation(cloud, opening, 'Prueba', actor);
  assert.equal(opened.receipt.sequence, 1);
  assert.equal(opened.receipt.effect.abierto_en, openedAt);
  assert.deepEqual(opened.receipt.created.turnos_caja, [opened.receipt.result.id]);
  const localState = (await read(local)).state;
  const saleAt = new Date(Date.now() - 86300000).toISOString();
  const payload = { cajaId: localState.caja.session.id, clienteId: localState.clientes[0].id,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: localState.configuracionVersion,
    items: [{ productoId: localState.productos[0].id, versionProducto: localState.productos[0].version, cantidad: '0.25', nivelPrecio: 'precio1' }] };
  const sale = await prepare(boot, '/api/ventas', payload, { deviceId: opening.deviceId, sequence: 2, occurredAt: saleAt });
  const replies = await Promise.all([writeSyncOperation(cloud, sale, 'Prueba', actor), writeSyncOperation(cloud, sale, 'Prueba', actor)]);
  assert.deepEqual(replies.map(reply => reply.receipt.replayed).sort(), [false, true]);
  const response = replies[0];
  assert.equal(response.backup.tables.ventas.at(-1).creado_en.slice(0, 23) + 'Z', saleAt);
  assert.deepEqual(response.receipt.effect, sale.expected.effect);
  assert.equal(response.receipt.effect.metodo_pago, 'efectivo');
  assert.equal(response.receipt.effect.ncf, null);
  assert.equal(response.receipt.effect.total, '30.00');
  assert.deepEqual(response.receipt.effect.items, [{ codigo: 'SYNC', nombre: 'Artículo sincronizado', cantidad: '0.25',
    nivel_precio: 'precio1', precio: '118.1234', base: '25.03', itbis: '4.50', total: '29.53' }]);
  assert.equal(response.receipt.created.venta_detalles.length, 1);
  assert.equal(response.receipt.created.movimientos_inventario.length, 1);
  assert.equal(response.snapshot.state.facturas.length, 1);
  assert.equal(response.snapshot.state.productos[0].stock, 5);
  await assert.rejects(writeSyncOperation(cloud, { ...sale, occurredAt: openedAt }, 'Prueba', actor), { status: 409 });
  await assert.rejects(writeSyncOperation(cloud, sale, 'Prueba', { ...actor, id: randomUUID() }), { status: 409 });
});

test('conflicting immutable receipt rolls back stock, request and device sequence', async () => {
  const boot = await checkpoint();
  const state = boot.snapshot.state;
  const envelope = await prepare(boot, '/api/ventas', { cajaId: state.caja.session.id, clienteId: state.clientes[0].id,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: state.configuracionVersion,
    items: [{ productoId: state.productos[0].id, versionProducto: state.productos[0].version, cantidad: 1, nivelPrecio: 'precio1' }] });
  const bad = structuredClone(envelope); bad.expected.effect.total = '0.00';
  await assert.rejects(writeSyncOperation(cloud, bad, 'Prueba', actor), { status: 409 });
  assert.equal((await read(cloud)).state.facturas.length, 1);
  assert.equal((await cloud.query('SELECT 1 FROM pos_privado.solicitudes WHERE clave=$1', [bad.operationId])).rowCount, 0);
  assert.equal((await writeSyncOperation(cloud, envelope, 'Prueba', actor)).receipt.sequence, 1);
});

test('remote cash changes and out of order device delivery remain explicit conflicts', async () => {
  const boot = await checkpoint();
  const turn = boot.snapshot.state.caja.session;
  const envelope = await prepare(boot, '/api/caja/movimiento', { cajaId: turn.id, version: turn.version, tipo: 'entrada', monto: 1, concepto: 'Local' });
  await assert.rejects(writeSyncOperation(cloud, { ...envelope, sequence: 2 }, 'Prueba', actor), { status: 409 });
  await write(cloud, '/api/caja/movimiento', { cajaId: turn.id, version: turn.version, tipo: 'entrada', monto: 2, concepto: 'Web' });
  await assert.rejects(writeSyncOperation(cloud, envelope, 'Prueba', actor), { status: 409 });
  assert.equal((await read(cloud)).state.caja.movements.filter(row => row.description === 'Local').length, 0);
});

test('normal operation HTTP cannot supply an offline timestamp or bypass synchronization checks', async () => {
  const snapshot = await read(cloud);
  const response = await fetch(base + '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: snapshot.databaseId, nombre: 'Fecha no autorizada', occurredAt: '2000-01-01T00:00:00.000Z' }) });
  assert.equal(response.status, 400);
  const unauthorized = await fetch(base + '/api/sync/operations', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://otro.invalid' }, body: '{}' });
  assert.equal(unauthorized.status, 403);
  assert.equal((await fetch(base + '/api/sync/bootstrap', { headers: { Origin: 'https://otro.invalid' } })).status, 403);
});

test('offline purchase returns identities for every newly created relational row and preserves exact amounts', async () => {
  const supplier = await write(cloud, '/api/suplidores', { nombre: 'Proveedor sincronizado' });
  const boot = await checkpoint();
  const envelope = await prepare(boot, '/api/compras', { suplidorId: supplier.result.id, numero: 'SYNC-C-1', items: [
    { productoId: null, versionProducto: null, codigo: 'SYNC-NEW', nombre: 'Producto nuevo', cantidad: '1.25', costo: '2.3456', precio1: '3.0001', precio2: '2.9', precio3: 0 },
  ] }, { occurredAt: '2026-11-01T03:30:00.000Z' });
  const reply = await writeSyncOperation(cloud, envelope, 'Prueba', actor);
  assert.equal(reply.receipt.effect.fecha, '2026-10-31');
  assert.equal(reply.receipt.effect.items[0].costo, '2.3456');
  for (const table of ['compras', 'compra_detalles', 'productos', 'movimientos_inventario']) assert.equal(reply.receipt.created[table].length, 1, table);
  const changedKey = { ...envelope, operationId: randomUUID() };
  await assert.rejects(writeSyncOperation(cloud, changedKey, 'Prueba', actor), { status: 409 });
  assert.equal((await read(cloud)).state.compras.length, 1);
});

test('price and configuration changes cannot alter a sale already confirmed locally', async () => {
  const boot = await checkpoint();
  const state = boot.snapshot.state, product = state.productos[0];
  const sale = await prepare(boot, '/api/ventas', { cajaId: state.caja.session.id, clienteId: state.clientes[0].id,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: state.configuracionVersion,
    items: [{ productoId: product.id, versionProducto: product.version, cantidad: 1, nivelPrecio: 'precio1' }] });
  const count = state.facturas.length;
  await write(cloud, '/api/productos/' + product.id, { ...product, version: product.version, precio1: '200.0001' }, 'PUT');
  await assert.rejects(writeSyncOperation(cloud, sale, 'Prueba', actor), { status: 409 });
  assert.equal((await read(cloud)).state.facturas.length, count);
  assert.equal((await read(local)).state.facturas.at(-1).total, 118);
  const missingVersion = structuredClone(sale); delete missingVersion.body.versionConfiguracion;
  await assert.rejects(writeSyncOperation(cloud, missingVersion, 'Prueba', actor), { status: 400 });
});

test('closed cash heads detect an entire intervening web turn and prevent overlapping offline histories', async () => {
  let state = (await read(cloud)).state;
  await write(cloud, '/api/caja/cerrar', { cajaId: state.caja.session.id, version: state.caja.session.version, conteo: state.caja.summary.expected });
  const boot = await checkpoint();
  assert.equal(boot.cashHead.open, false);
  const envelope = await prepare(boot, '/api/caja/abrir', { monto: 0 });
  await write(cloud, '/api/caja/abrir', { monto: 0 });
  state = (await read(cloud)).state;
  await write(cloud, '/api/caja/cerrar', { cajaId: state.caja.session.id, version: state.caja.session.version, conteo: 0 });
  assert.equal((await read(cloud)).state.caja.session.open, false);
  await assert.rejects(writeSyncOperation(cloud, envelope, 'Prueba', actor), { status: 409 });
  assert.equal((await read(cloud)).state.caja.session.open, false);
  assert.equal((await read(local)).state.caja.session.open, true);
});

test('opening then closing offline keeps original times and records one closed turn after replay', async () => {
  const boot = await checkpoint();
  const openAt = new Date().toISOString();
  const opening = await prepare(boot, '/api/caja/abrir', { monto: '1' }, { occurredAt: openAt });
  await writeSyncOperation(cloud, opening, 'Prueba', actor);
  const turn = (await read(local)).state.caja.session;
  const closeAt = new Date().toISOString();
  const closing = await prepare(boot, '/api/caja/cerrar', { cajaId: turn.id, version: turn.version, conteo: '1' },
    { deviceId: opening.deviceId, sequence: 2, occurredAt: closeAt });
  const reply = await writeSyncOperation(cloud, closing, 'Prueba', actor);
  assert.equal(reply.receipt.effect.abierto_en, openAt);
  assert.equal(reply.receipt.effect.cerrado_en, closeAt);
  assert.equal(reply.cashHead.open, false);
  assert.equal((await writeSyncOperation(cloud, closing, 'Prueba', actor)).receipt.replayed, true);
});

test('HTTP synchronization binds the idempotency header and retains authenticated actor attribution', async () => {
  const boot = await checkpoint();
  const envelope = await prepare(boot, '/api/clientes', { nombre: 'Cliente desde Windows', rnc: '001' });
  const send = key => fetch(base + '/api/sync/operations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(envelope) });
  assert.equal((await send(randomUUID())).status, 400);
  const response = await send(envelope.operationId);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).receipt.effect.nombre, 'Cliente desde Windows');
  assert.equal((await (await send(envelope.operationId)).json()).receipt.replayed, true);
  const metadata = (await cloud.query('SELECT resultado->\'metadata\' AS metadata FROM pos_privado.solicitudes WHERE clave=$1', [envelope.operationId])).rows[0].metadata;
  assert.equal(metadata.actorId, 'local');
});

test('restoration changes generation and refuses both queued commands and old receipts', async () => {
  const boot = await checkpoint();
  const envelope = await prepare(boot, '/api/clientes', { nombre: 'Previo a restaurar' });
  await writeSyncOperation(cloud, envelope, 'Prueba', actor);
  const current = await readSyncBootstrap(cloud, 'Prueba');
  await write(cloud, '/api/restore', { backup: current.backup, revision: current.snapshot.revision });
  await assert.rejects(writeSyncOperation(cloud, envelope, 'Prueba', actor), { status: 409 });
  await assert.rejects(writeSyncOperation(cloud, { ...envelope, operationId: randomUUID(), sequence: 2 }, 'Prueba', actor), { status: 409 });
});

test('cash head follows chronological history rather than assuming restored identifiers imply time order', () => {
  const backup = { tables: { turnos_caja: [
    { id: '99', version: '4', abierto_en: '2026-01-01T09:00:00.000000Z', cerrado_en: '2026-01-01T10:00:00.000000Z' },
    { id: '2', version: '3', abierto_en: '2026-01-02T09:00:00.000000Z', cerrado_en: null },
  ], ventas: [{ caja_id: '2', creado_en: '2026-01-02T10:00:00.123456Z' }], movimientos_caja: [] } };
  assert.deepEqual(cashHeadFromBackup(backup), { id: 2, version: 3, open: true, latestAt: '2026-01-02T10:00:00.123Z' });
});

test('both synchronization routes require a session before opening a business database', async () => {
  const origin = 'https://pos.example';
  const hosting = hostingConfig({ PUBLIC_ORIGIN: origin, APP_USERNAME: 'prueba', APP_PASSWORD: 'solo-prueba-desechable' });
  for (const [method, path] of [['GET', '/api/sync/bootstrap'], ['POST', '/api/sync/operations']]) {
    const response = await handleRequest(new Request(origin + path, { method, headers: { 'X-Forwarded-Proto': 'https' } }),
      { hosting, pool: { connect() { assert.fail('Una sesión ausente no debe consultar datos.'); } } });
    assert.equal(response.status, 401);
  }
});

test('legacy v1.2.19 desktop clients negotiate v9 backups, keep referencia intact on edits, and auto-upgrade ETag on v1.2.20', async () => {
  await write(cloud, '/api/productos', {
    codigo: 'LEG-REF-1',
    referencia: 'OEM-PRESERVAR-99',
    nombre: 'Filtro compatible con v1.2.19',
    costo: '50.0000',
    stock: '8',
    precio1: '100.0000',
    precio2: '90.0000',
    precio3: '90.0000',
  });

  // 1. Cliente v1.2.19 (sin cabecera X-Felix-Backup-Version) recibe respaldo v9 sin columna referencia.
  const legacyRes = await fetch(base + '/api/sync/bootstrap');
  assert.equal(legacyRes.status, 200);
  const legacyEtag = legacyRes.headers.get('etag');
  const legacyBoot = await legacyRes.json();
  assert.equal(legacyBoot.backup.version, 9);
  const legacyProduct = legacyBoot.backup.tables.productos.find(p => p.codigo === 'LEG-REF-1');
  assert.ok(legacyProduct, 'producto debe existir en respaldo v9');
  assert.equal(Object.hasOwn(legacyProduct, 'referencia'), false, 'v9 no debe incluir columna referencia');
  assert.doesNotThrow(() => backupLayout(legacyBoot.backup));
  assert.doesNotThrow(() => backupLayout(redactBootstrapForRole(legacyBoot, 'cajero').backup));

  // ETag de v1.2.19 responde 304 mientras sigue en v9.
  const legacyNotMod = await fetch(base + '/api/sync/bootstrap', { headers: { 'If-None-Match': legacyEtag } });
  assert.equal(legacyNotMod.status, 304);

  // 2. Al actualizar a v1.2.20 (X-Felix-Backup-Version: 10), el ETag v9 NO devuelve 304; baja v10 con referencia.
  const modernRes = await fetch(base + '/api/sync/bootstrap', {
    headers: { 'X-Felix-Backup-Version': String(CURRENT_BACKUP_VERSION), 'If-None-Match': legacyEtag },
  });
  assert.equal(modernRes.status, 200);
  const modernEtag = modernRes.headers.get('etag');
  assert.notEqual(modernEtag, legacyEtag);
  const modernBoot = await modernRes.json();
  assert.equal(modernBoot.backup.version, CURRENT_BACKUP_VERSION);
  const modernProduct = modernBoot.backup.tables.productos.find(p => p.codigo === 'LEG-REF-1');
  assert.equal(modernProduct.referencia, 'OEM-PRESERVAR-99');

  const modernNotMod = await fetch(base + '/api/sync/bootstrap', {
    headers: { 'X-Felix-Backup-Version': String(CURRENT_BACKUP_VERSION), 'If-None-Match': modernEtag },
  });
  assert.equal(modernNotMod.status, 304);

  // 3. Cliente v1.2.19 sube una edición offline de producto (sin campo referencia ni en body ni en expected.effect).
  const currentState = await read(cloud);
  const prod = currentState.state.productos.find(p => p.codigo === 'LEG-REF-1');
  const legacyEditBody = {
    databaseId: currentState.databaseId,
    version: prod.version,
    codigo: prod.codigo,
    nombre: 'Filtro editado desde v1.2.19',
    marca: prod.marca,
    categoria: prod.categoria,
    ubicacion: prod.ubicacion,
    gravado: prod.gravado,
    stock: '12.00',
    stockMinimo: prod.stockMinimo,
    notificarMinimo: prod.notificarMinimo,
    costo: '50.0000',
    precio1: '105.0000',
    precio2: '90.0000',
    precio3: '90.0000',
    codigosAlternativos: [],
  };
  const expectedLegacyEffect = {
    codigo: 'LEG-REF-1',
    nombre: 'Filtro editado desde v1.2.19',
    costo: '50.0000',
    precio1: '105.0000',
    precio2: '90.0000',
    precio3: '90.0000',
    stock: '12.00',
    activo: true,
    marca: prod.marca,
    categoria: prod.categoria,
    ubicacion: prod.ubicacion,
    stock_minimo: '0.00',
    gravado: true,
    notificar_minimo: true,
    altCodes: [],
  };
  const legacyOpId = randomUUID();
  const legacyEnvelope = {
    deviceId: randomUUID(),
    sequence: 1,
    operationId: legacyOpId,
    method: 'PUT',
    path: `/api/productos/${prod.id}`,
    body: legacyEditBody,
    occurredAt: new Date().toISOString(),
    expected: { effect: expectedLegacyEffect, cashHead: null },
  };
  const opRes = await fetch(base + '/api/sync/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': legacyOpId },
    body: JSON.stringify(legacyEnvelope),
  });
  assert.equal(opRes.status, 200, await opRes.clone().text());
  const opData = await opRes.json();
  assert.equal(opData.backup.version, 9);
  assert.equal(opData.receipt.effect.nombre, 'Filtro editado desde v1.2.19');

  // Verificar que PostgreSQL conservó la referencia OEM-PRESERVAR-99 intacta.
  const afterState = await read(cloud);
  const updatedProd = afterState.state.productos.find(p => p.codigo === 'LEG-REF-1');
  assert.equal(updatedProd.nombre, 'Filtro editado desde v1.2.19');
  assert.equal(updatedProd.stock, 12);
  assert.equal(updatedProd.referencia, 'OEM-PRESERVAR-99');

  // 4. Si algún día llega un respaldo superior a la versión soportada, responde 426 claro en vez de "Formato inválido".
  assert.throws(
    () => backupLayout({ version: CURRENT_BACKUP_VERSION + 1, format: 'repuestos-felix-relacional', tables: {} }),
    error => error.status === 426 && /Actualiza la aplicación de escritorio/i.test(error.message),
  );
});
