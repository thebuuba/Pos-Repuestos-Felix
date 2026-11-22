import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { calculateFormula } from '../src/domain/pricing.js';
import * as fields from '../src/pos/operation-fields.js';
import { backupLayout } from '../src/pos/relational-backup.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { temporaryPostgres } from './postgres.js';

let database, pool;
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); }
  finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
});
after(async () => {
  await pool?.end();
  await database?.stop();
});

const snapshot = (backup = false) => readSnapshot(pool, 'Pruebas', backup);
const write = async (path, payload, { key = randomUUID(), method = 'POST', databaseId } = {}) =>
  writeOperation(pool, method, '/api/' + path, { databaseId: databaseId ?? (await snapshot()).databaseId, ...payload }, key, 'Pruebas');
const item = { codigo: 'caso', nombre: 'Repuesto', stock: '1.25', stockMinimo: '0.50',
  costo: '12.3456', precio1: '23.45', precio2: '0.00', precio3: '0.00', notificarMinimo: false };

test('decimal fields use bounded, signed and exact scaled units', () => {
  const { quantityUnits, costUnits, decimalUnits } = fields;
  assert.equal(quantityUnits(1.25, 'cantidad'), 125n);
  assert.equal(quantityUnits('2147483647.00', 'cantidad'), 214748364700n);
  assert.equal(quantityUnits(0, 'cantidad'), 0n);
  assert.equal(quantityUnits('0.01', 'cantidad', 0.01), 1n);
  assert.throws(() => quantityUnits(0, 'cantidad', 0.01), { status: 400 });
  assert.throws(() => quantityUnits('1.001', 'cantidad'), { status: 400 });
  assert.throws(() => quantityUnits('2147483647.01', 'cantidad'), { status: 400 });
  assert.equal(costUnits('999999999999.9900', 'costo'), 9999999999999900n);
  assert.equal(costUnits('12.3456', 'costo'), 123456n);
  assert.throws(() => costUnits('999999999999.9901', 'costo'), { status: 400 });
  assert.throws(() => costUnits('1.00001', 'costo'), { status: 400 });
  assert.equal(decimalUnits(-25n, 2), '-0.25');
  assert.equal(decimalUnits(123456n, 4), '12.3456');
});

test('catalog creation and editing preserve exact cost and case-sensitive codes', async () => {
  const lower = await write('productos', item);
  const upper = await write('productos', { ...item, codigo: 'CASO', stock: '0.01', costo: '999999999999.9898' });
  const padded = await write('productos', { ...item, codigo: 'caso ', stock: 0 });
  assert.notEqual(lower.result.id, upper.result.id);
  assert.equal(padded.state.productos.find(p => p.id === padded.result.id).codigo, 'caso ');
  const upperProduct = upper.state.productos.find(p => p.id === upper.result.id);
  assert.equal(upperProduct.costoExacto, '999999999999.9898');
  assert.notEqual(String(upperProduct.costo), upperProduct.costoExacto);
  await assert.rejects(write('productos', item), { status: 409 });
  const path = 'productos/' + lower.result.id;
  await assert.rejects(write(path, { ...item, codigo: 'CASO', version: 1 }, { method: 'PUT' }), { status: 409 });
  const edited = await write(path, { ...item, stock: 1.35, version: 1 }, { method: 'PUT' });
  const lowerProduct = edited.state.productos.find(p => p.id === lower.result.id);
  assert.deepEqual([lowerProduct.codigo, lowerProduct.costo, lowerProduct.costoExacto, lowerProduct.stock,
    lowerProduct.stockMinimo, lowerProduct.notificarMinimo, lowerProduct.version], ['caso', 12.3456, '12.3456', 1.35, 0.5, false, 2]);
});

test('fractional sales and purchases round each line and preserve stock and retry proofs', async () => {
  const original = await snapshot();
  const product = original.state.productos.find(p => p.codigo === 'caso');
  const upper = original.state.productos.find(p => p.codigo === 'CASO');
  const { result: supplier } = await write('suplidores', { nombre: 'Suplidor sintético' });
  const line = { productoId: product.id, cantidad: '0.25', nivelPrecio: 'precio1' };
  const sale = { clienteId: original.state.clientes[0].id, condicion: 'Contado', tipoComprobante: 'B02', items: [line, line] };
  const key = randomUUID();
  const sold = await write('ventas', sale, { key });
  const replay = await write('ventas', sale, { key });
  assert.equal(replay.result.id, sold.result.id);
  assert.equal(sold.confirmation.replayed, false);
  assert.deepEqual(replay.confirmation, { operationId: key, databaseId: original.databaseId,
    method: 'POST', path: '/api/ventas', replayed: true });
  assert.equal(replay.revision, sold.revision);
  const document = sold.state.facturas.find(f => f.id === sold.result.id);
  assert.deepEqual(document.items.map(i => [i.cant, i.precio, i.base, i.itbis, i.subtotal]),
    [[0.25, 23.45, 4.97, 0.89, 5.86], [0.25, 23.45, 4.97, 0.89, 5.86]]);
  assert.equal(document.total, 11.72);
  const { stock, stockMinimo, notificarMinimo, ...purchaseFields } = item;
  const purchaseLine = { ...purchaseFields, cantidad: 0.10 };
  const purchase = { suplidorId: supplier.id, numero: 'PRUEBA-01', items: [purchaseLine, purchaseLine] };
  const purchaseKey = randomUUID();
  const bought = await write('compras', purchase, { key: purchaseKey });
  const purchaseReplay = await write('compras', purchase, { key: purchaseKey });
  assert.equal(purchaseReplay.confirmation.replayed, true);
  assert.equal(purchaseReplay.result.id, bought.result.id);
  assert.equal(purchaseReplay.revision, bought.revision);
  const invoice = bought.state.compras.find(c => c.id === bought.result.id);
  assert.deepEqual(invoice.items.map(i => [i.cant, i.costo, i.costoExacto, i.subtotal]),
    [[0.1, 12.3456, '12.3456', 1.23], [0.1, 12.3456, '12.3456', 1.23]]);
  assert.equal(invoice.total, 2.46);
  const updated = bought.state.productos.find(p => p.id === product.id);
  assert.deepEqual([updated.stock, updated.costoExacto, updated.notificarMinimo], [1.05, '12.3456', false]);
  assert.equal(bought.state.productos.find(p => p.id === upper.id).stock, 0.01);
  const ledger = (await pool.query('SELECT tipo,cantidad,existencia_posterior FROM movimientos_inventario WHERE producto_id=$1 ORDER BY id', [product.id])).rows;
  assert.deepEqual(ledger.map(m => [m.tipo, m.cantidad, m.existencia_posterior]), [
    ['apertura', '1.25', '1.25'], ['ajuste', '0.10', '1.35'],
    ['venta', '-0.25', '1.10'], ['venta', '-0.25', '0.85'],
    ['compra', '0.10', '0.95'], ['compra', '0.10', '1.05'],
  ]);
  await assert.rejects(pool.query('UPDATE venta_detalles SET total=total+0.01,base=base+0.01 WHERE id=$1', [document.items[0].id]),
    { code: '23514', constraint: 'venta_detalles_importes' });
  await assert.rejects(pool.query('UPDATE compra_detalles SET total=total+0.01 WHERE id=$1', [invoice.items[0].id]),
    { code: '23514', constraint: 'compra_detalles_importe' });
  const beforeFailure = await snapshot();
  const rejectedKey = randomUUID();
  await assert.rejects(write('ventas', { ...sale, items: Array(5).fill(line) }, { key: rejectedKey }),
    error => error.status === 409 && error.rejection?.operationId === rejectedKey);
  assert.deepEqual(await snapshot(), beforeFailure);
});

test('v5 backup round-trips fractional stock, costs and notices with unchanged legacy limits', async () => {
  const beforeRestore = await snapshot();
  const backup = JSON.parse(JSON.stringify(await snapshot(true)));
  assert.equal(backup.version, 5);
  const lower = backup.tables.productos.find(p => p.codigo === 'caso');
  assert.deepEqual([lower.stock, lower.stock_minimo, lower.costo, lower.notificar_minimo], ['1.05', '0.50', '12.3456', false]);
  assert.ok(backup.tables.productos.some(p => p.codigo === 'caso '));
  const restored = await write('restore', { revision: beforeRestore.revision, backup });
  assert.deepEqual(restored.state, beforeRestore.state);
  const v4 = structuredClone(backup);
  v4.version = 4;
  for (const p of v4.tables.productos) delete p.notificar_minimo;
  assert.throws(() => backupLayout(v4), { status: 400 });
});

test('pricing applies the factor to four decimals before rounding the adjusted cost', () => {
  const formula = { costFactor: '2.000', margins: { p1: 0, p2: 10, p3: 20 } };
  assert.deepEqual(calculateFormula('12.3456', formula, 0),
    { adjustedCost: '24.69', prices: { p1: '24.69', p2: '27.16', p3: '29.63' } });
  assert.throws(() => calculateFormula('1.00001', formula, 0), RangeError);
});
