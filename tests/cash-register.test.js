import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';

let database, pool, databaseId;
const actor = { id: randomUUID(), name: 'Cajero de prueba' };
const read = () => readSnapshot(pool, 'Prueba');
const write = (path, payload, key = randomUUID()) => writeOperation(pool, 'POST', '/api/' + path,
  { databaseId, ...payload }, key, 'Prueba', actor);
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin); await admin.end();
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  databaseId = (await read()).databaseId;
});
after(async () => { await pool?.end(); await database?.stop(); });

test('caja persists, separates payment methods, rejects stale closes and restores audited closures', async () => {
  assert.equal((await read()).state.caja.session.open, false);
  const key = randomUUID();
  const openings = await Promise.all([write('caja/abrir', { monto: '100.01' }, key), write('caja/abrir', { monto: '100.01' }, key)]);
  assert.equal(openings[0].result.id, openings[1].result.id);
  const cajaId = openings[0].result.id;
  assert.equal((await read()).state.caja.session.cashier, actor.name);
  await assert.rejects(write('caja/abrir', { monto: 20 }), { status: 409 });
  const customer = (await read()).state.clientes[0];
  const product = (await write('productos', { codigo: 'CAJA', nombre: 'Prueba', costo: 0, precio1: '0.30', precio2: 0, precio3: 0, stock: 20 })).result.id;
  const sale = { cajaId, clienteId: customer.id, condicion: 'Contado', tipoComprobante: 'B02', items: [{ productoId: product, cantidad: 1, nivelPrecio: 'precio1' }] };
  await assert.rejects(write('ventas', sale), { status: 400 });
  await assert.rejects(write('ventas', { ...sale, cajaId: cajaId + 1, metodoPago: 'efectivo' }), { status: 409 });
  const oldVersion = (await read()).state.caja.session.version;
  for (const metodoPago of ['efectivo', 'tarjeta', 'transferencia']) await write('ventas', { ...sale, metodoPago });
  let caja = (await read()).state.caja;
  assert.equal(caja.summary.expected, 100.31);
  assert.equal(caja.summary.cardSales, 0.3);
  assert.equal(caja.summary.transferSales, 0.3);
  assert.equal(caja.summary.invoices, 3);
  await assert.rejects(write('caja/cerrar', { cajaId, version: oldVersion, conteo: 100 }), { status: 409 });
  await assert.rejects(write('caja/movimiento', { cajaId, version: caja.session.version, tipo: 'salida', monto: 200, concepto: 'Exceso' }), { status: 409 });
  const moveKey = randomUUID();
  const payload = { cajaId, version: caja.session.version, tipo: 'entrada', monto: '0.02', concepto: 'Cambio' };
  await write('caja/movimiento', payload, moveKey); await write('caja/movimiento', payload, moveKey);
  caja = (await read()).state.caja;
  assert.equal(caja.movements.length, 1); assert.equal(caja.summary.expected, 100.33);
  await write('caja/movimiento', { cajaId, version: caja.session.version, tipo: 'salida', monto: '0.03', concepto: 'Retiro' });
  caja = (await read()).state.caja;
  const closed = await write('caja/cerrar', { cajaId, version: caja.session.version, conteo: '100.29' });
  assert.equal(closed.state.caja.session.open, false);
  assert.equal(closed.result.expected, 100.3); assert.equal(closed.result.counted, 100.29);
  assert.equal(closed.result.sales, 0.9);
  await assert.rejects(write('ventas', { ...sale, metodoPago: 'efectivo' }), { status: 409 });
  await assert.rejects(write('caja/movimiento', { ...payload, version: caja.session.version }), { status: 409 });
  // Read with a new connection pool: persisted state survives server recreation.
  await pool.end(); pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  assert.equal((await read()).state.caja.closures.length, 1);
  const backup = JSON.parse(JSON.stringify(await readSnapshot(pool, 'Prueba', true)));
  assert.equal(backup.version, 9);
  const invalid = structuredClone(backup); invalid.tables.turnos_caja[0].esperado = '100.29';
  await assert.rejects(write('restore', { backup: invalid, revision: (await read()).revision }), { status: 400 });
  const restored = await write('restore', { backup, revision: (await read()).revision });
  databaseId = restored.databaseId;
  assert.equal(restored.state.caja.closures[0].expected, 100.3);
});

test('concurrent opening and close-versus-sale serialize without losing cash', async () => {
  const results = await Promise.allSettled([write('caja/abrir', { monto: 0 }), write('caja/abrir', { monto: 0 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const state = (await read()).state;
  const cajaId = state.caja.session.id;
  const sale = { cajaId, clienteId: state.clientes[0].id, condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    items: [{ productoId: state.productos[0].id, cantidad: 1, nivelPrecio: 'precio1' }] };
  const race = await Promise.allSettled([write('caja/cerrar', { cajaId, version: state.caja.session.version, conteo: 0 }), write('ventas', sale)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.status, 409);
  const after = (await read()).state.caja;
  if (after.session.open) assert.equal(after.summary.expected, 0.3);
  else assert.equal(after.closures[0].expected, 0);
});

const exportCashBackup = async () => JSON.parse(JSON.stringify(await readSnapshot(pool, 'Prueba', true)));
async function restoreCashBackup(backup) {
  const current = await read(); databaseId = current.databaseId;
  const restored = await write('restore', { backup, revision: current.revision });
  databaseId = restored.databaseId;
  return restored;
}
async function withCashHistory(run) {
  const original = await exportCashBackup();
  const backup = structuredClone(original);
  for (const sale of backup.tables.ventas) { sale.caja_id = null; sale.metodo_pago = null; }
  backup.tables.turnos_caja = [1, 2].map(id => ({ id: String(id), usuario: actor.id, cajero: actor.name,
    fondo: '0.00', abierto_en: `2100-01-01T${id === 1 ? '10' : '11'}:00:00.000Z`,
    cerrado_en: `2100-01-01T${id === 1 ? '11' : '12'}:00:00.000Z`, cerrado_por: actor.id,
    esperado: '0.00', contado: '0.00', ventas: '0.00', version: '1' }));
  backup.tables.movimientos_caja = [
    { id: '1', caja_id: '1', tipo: 'entrada', monto: '10.00', concepto: 'Cambio', usuario: actor.id, creado_en: '2100-01-01T10:00:01.001Z' },
    { id: '2', caja_id: '1', tipo: 'salida', monto: '10.00', concepto: 'Retiro', usuario: actor.id, creado_en: '2100-01-01T10:00:01.002Z' },
  ];
  try { await restoreCashBackup(backup); await run(backup); }
  finally { await restoreCashBackup(original); }
}

test('cash backups preserve microseconds through export and restore without changing snapshots', async () => withCashHistory(async () => {
  await pool.query("UPDATE movimientos_caja SET creado_en=CASE id WHEN 1 THEN '2100-01-01T10:00:01.123401Z'::timestamptz ELSE '2100-01-01T10:00:01.123402Z'::timestamptz END");
  const backup = await exportCashBackup();
  assert.deepEqual(backup.tables.movimientos_caja.map(row => row.creado_en), ['2100-01-01T10:00:01.123401Z', '2100-01-01T10:00:01.123402Z']);
  assert.match((await read()).state.caja.closures[0].closedAt, /\.000Z$/);
  await restoreCashBackup(backup);
  assert.deepEqual((await exportCashBackup()).tables.movimientos_caja, backup.tables.movimientos_caja);
}));

test('restore rejects an intermediate negative cash balance without changing the database', async () => withCashHistory(async backup => {
  [backup.tables.movimientos_caja[0].tipo, backup.tables.movimientos_caja[1].tipo] = ['salida', 'entrada'];
  backup.tables.movimientos_caja[0].creado_en = '2100-01-01T10:00:01.123401Z';
  backup.tables.movimientos_caja[1].creado_en = '2100-01-01T10:00:01.123402Z';
  const before = await read();
  await assert.rejects(restoreCashBackup(backup), error => error.status === 400 && /negativo/.test(error.message));
  assert.deepEqual(await read(), before);
}));

test('restore rejects overlapping closed turns without changing the database', async () => withCashHistory(async backup => {
  backup.tables.turnos_caja[1].abierto_en = '2100-01-01T10:30:00.000Z';
  const before = await read();
  await assert.rejects(restoreCashBackup(backup), error => error.status === 400 && /superpuest/.test(error.message));
  assert.deepEqual(await read(), before);
}));

test('restore includes cash sales and accepts older millisecond ties', async () => withCashHistory(async backup => {
  const sale = backup.tables.ventas[0];
  Object.assign(sale, { caja_id: '1', metodo_pago: 'efectivo', creado_en: '2100-01-01T10:00:01.001Z' });
  backup.tables.turnos_caja[0].ventas = sale.total;
  backup.tables.movimientos_caja = [{ ...backup.tables.movimientos_caja[1], monto: sale.total, creado_en: sale.creado_en }];
  const restored = await restoreCashBackup(backup);
  assert.equal(restored.state.caja.closures.find(turn => turn.id === 1).expected, 0);
}));

test('a v5 backup restores business records without creating cash turns or payment history', async () => withCashHistory(async () => {
  const backup = await exportCashBackup();
  const before = (await read()).state;
  backup.version = 5;
  delete backup.tables.turnos_caja;
  delete backup.tables.movimientos_caja;
  delete backup.tables.secuencias_ncf;
  delete backup.tables.productos_codigos;
  delete backup.tables.abonos_cuentas;
  delete backup.tables.cuentas_taller;
  delete backup.tables.cuentas_taller_items;
  for (const row of backup.tables.configuracion) delete row.meta_diaria;
  for (const sale of backup.tables.ventas) {
    for (const col of ['caja_id', 'metodo_pago', 'descuento_porcentaje', 'descuento', 'estado', 'anulada_en', 'anulada_por', 'motivo_anulacion', 'vencimiento', 'version']) delete sale[col];
  }
  for (const c of backup.tables.compras) { for (const col of ['condicion', 'vencimiento', 'version', 'estado', 'anulada_en', 'anulada_por', 'motivo_anulacion']) delete c[col]; }
  for (const rows of Object.values(backup.tables)) for (const row of rows) {
    for (const key of Object.keys(row)) if (key.endsWith('_en') && row[key] !== null) row[key] = new Date(row[key]).toISOString();
  }
  const restored = (await restoreCashBackup(backup)).state;
  assert.deepEqual(restored.facturas, before.facturas);
  assert.equal(restored.caja.session.open, false);
  assert.deepEqual(restored.caja.closures, []);
  assert.deepEqual(restored.caja.movements, []);
  const current = await exportCashBackup();
  assert.equal(current.version, 9);
  assert.deepEqual(current.tables.turnos_caja, []);
  assert.deepEqual(current.tables.movimientos_caja, []);
  assert.ok(current.tables.ventas.every(sale => sale.caja_id === null && sale.metodo_pago === null));
}));
