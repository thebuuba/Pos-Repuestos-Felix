import { openTestCash } from './fixtures/cash.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { historicalBackup } from './fixtures/relational-backup.js';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';

let database, pool, server, origin, productId;
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  await openTestCash(pool);
  server = await createApp(pool);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end(); await database?.stop();
});
const state = async () => (await fetch(origin + '/api/state')).json();
async function write(route, data, method = 'POST', key = randomUUID()) {
  if (route === 'ventas') data = { cajaId: await openTestCash(pool), metodoPago: data.condicion === 'Credito' ? 'credito' : 'efectivo', ...data };
  return fetch(origin + '/api/' + route, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ databaseId: (await state()).databaseId, ...data }) });
}
const basic = p => ({ codigo: p.codigo, nombre: p.nombre, stock: p.stock, costo: p.costo, precio1: p.precio1, precio2: p.precio2, precio3: p.precio3, version: p.version });
const attrs = { marca: 'Marca de prueba', categoria: 'Motor', ubicacion: 'A-02', stockMinimo: 7, gravado: false };
const product = async () => (await state()).state.productos.find(p => p.id === productId);

test('catalog stores every Polymet attribute and preserves omitted metadata during a legacy update', async () => {
  const response = await write('productos', { codigo: 'META', nombre: 'Artículo', stock: 5, costo: 10, precio1: 118, precio2: 100, precio3: 90, ...attrs });
  assert.equal(response.status, 200, await response.clone().text());
  productId = (await response.json()).result.id;
  const created = await product();
  for (const [key, value] of Object.entries(attrs)) assert.equal(created[key], value, key);
  const edit = await write(`productos/${productId}`, { ...basic(created), nombre: 'Nombre nuevo' }, 'PUT');
  assert.equal(edit.status, 200, await edit.clone().text());
  const updated = await product();
  assert.equal(updated.nombre, 'Nombre nuevo');
  for (const [key, value] of Object.entries(attrs)) assert.equal(updated[key], value, key);
});

test('invalid metadata cannot change catalog, inventory movements or revision', async () => {
  const before = await state();
  for (const bad of [{ gravado: 'false' }, { gravado: null }, { stockMinimo: -1 }, { stockMinimo: 1.501 }, { stockMinimo: 2147483648 }, { notificarMinimo: 'false' }, { marca: 2 }, { categoria: 'x'.repeat(2001) }, { ubicacion: null }]) {
    const response = await write(`productos/${productId}`, { ...basic(await product()), ...bad }, 'PUT');
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(await state(), before);
});

test('metadata edits share version checks and idempotent writes with inventory', async () => {
  const previous = await product();
  const body = { ...basic(previous), marca: 'Confirmada' };
  const key = randomUUID();
  const replay = await Promise.all([write(`productos/${productId}`, body, 'PUT', key), write(`productos/${productId}`, body, 'PUT', key)]);
  assert.deepEqual(replay.map(r => r.status), [200, 200]);
  assert.equal((await product()).version, previous.version + 1);
  assert.equal((await write(`productos/${productId}`, { ...body, marca: 'Obsoleta' }, 'PUT')).status, 409);
  assert.equal((await product()).marca, 'Confirmada');
});

test('tax exempt catalog prices retain the same gross amount and produce zero ITBIS', async () => {
  const current = await state();
  const response = await write('ventas', { clienteId: current.state.clientes[0].id, condicion: 'Contado', tipoComprobante: 'B02', items: [{ productoId: productId, cantidad: 1, nivelPrecio: 'precio1' }], total: 0, itbis: 999 });
  assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await response.json();
  const invoice = snapshot.state.facturas.find(v => v.id === snapshot.result.id);
  assert.equal(invoice.total, 118);
  assert.equal(invoice.base, 118);
  assert.equal(invoice.itbis, 0);
  assert.equal(invoice.ncf, null);
  assert.equal(invoice.items[0].itbis, 0);
});

test('v5 backups preserve metadata and older versions use the SQL defaults', async () => {
  const original = await state();
  const backup = await (await fetch(origin + '/api/backup')).json();
  assert.equal(backup.version, 7);
  const row = backup.tables.productos.find(p => Number(p.id) === productId);
  assert.equal(row.stock_minimo, '7.00');
  assert.equal(row.gravado, false);
  assert.equal(row.marca, 'Confirmada');
  const malformed = structuredClone(backup);
  malformed.tables.productos[0].gravado = 'false';
  assert.equal((await write('restore', { revision: original.revision, backup: malformed })).status, 400);
  assert.deepEqual(await state(), original);
  const restored = await write('restore', { revision: original.revision, backup });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.deepEqual((await restored.json()).state, original.state);
  for (const version of [2,3,4]) {
    const incompatible = historicalBackup(backup, version);
    incompatible.tables.productos[0].precio2 = '10.003';
    assert.equal((await write('restore', { revision: (await state()).revision, backup: incompatible })).status, 400);
  }
  const v4 = historicalBackup(backup, 4);
  const invalidV4 = structuredClone(v4);
  invalidV4.tables.productos[0].costo = '10.0000';
  assert.equal((await write('restore', { revision: (await state()).revision, backup: invalidV4 })).status, 400);
  const duplicatesV4 = structuredClone(v4);
  duplicatesV4.tables.productos.push({ ...duplicatesV4.tables.productos[0], id: '90001', codigo: 'meta', stock: 0 });
  const beforeDuplicate = await state();
  assert.equal((await write('restore', { revision: beforeDuplicate.revision, backup: duplicatesV4 })).status, 409);
  assert.deepEqual(await state(), beforeDuplicate);
  const validV4 = await write('restore', { revision: beforeDuplicate.revision, backup: v4 });
  assert.equal(validV4.status, 200, await validV4.clone().text());
  assert.equal((await product()).notificarMinimo, true);
  const v2 = historicalBackup(backup, 2);
  assert.equal((await write('restore', { revision: (await state()).revision, backup: v2 })).status, 200);
  const imported = await product();
  assert.equal(imported.stockMinimo, 0);
  assert.equal(imported.gravado, true);
  assert.equal(imported.notificarMinimo, true);
  assert.equal(imported.marca, '');
  assert.equal(imported.categoria, '');
  assert.equal(imported.ubicacion, '');
  assert.equal(imported.precio1, 118);
});

test('additive catalog migration preserves populated prior schema and historical documents', async () => {
  const previousDatabase = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: previousDatabase.connectionString });
  try {
    await admin.query(await readFile(new URL('../supabase/migrations/20261121150000_inicializar_pos.sql', import.meta.url), 'utf8'));
    const priorState = { empresa: 'Prueba de actualización', itbisRate: 0.18,
      productos: [{ codigo: 'ANTERIOR', nombre: 'Artículo anterior', stock: 3, costo: 10, precio1: 118, precio2: 110, precio3: 100 }],
      clientes: [{ nombre: 'Cliente Contado', rnc: '', tel: '', deuda: 118 }], suplidores: [], compras: [],
      facturas: [{ id: 1, fecha: '20/11/2026', cliente: 'Cliente Contado', ncf: 'B02-00000001', condicion: 'Credito', total: 118,
        items: [{ codigo: 'ANTERIOR', nombre: 'Descripción histórica', cant: 1, precio: 118, subtotal: 118, itbis: 18 }] }] };
    await admin.query('UPDATE pos_privado.estado SET datos=$1', [priorState]);
    await admin.query(await readFile(new URL('../supabase/migrations/20261121190000_normalizar_pos.sql', import.meta.url), 'utf8'));
    await admin.query(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);
      INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20261121150000'), ('20261121190000')`);
    const oldProduct = (await admin.query('SELECT * FROM productos')).rows[0];
    const oldDocuments = (await admin.query('SELECT row_to_json(v) AS document FROM ventas v ORDER BY id')).rows;
    const oldMovements = (await admin.query('SELECT row_to_json(m) AS document FROM movimientos_inventario m ORDER BY id')).rows;
    assert.deepEqual(await migrateDatabase(admin), ['20261121220000', '20261122000000', '20261122010000', '20261122015000', '20261122020000', '20261122030000', '20261122210000']);
    assert.equal((await admin.query('SELECT es_contado FROM clientes')).rows[0].es_contado, false);
    const migrated = (await admin.query('SELECT * FROM productos')).rows[0];
    assert.deepEqual(Object.fromEntries(Object.keys(oldProduct).map(key => [key, migrated[key]])),
      { ...oldProduct, stock: oldProduct.stock.toFixed(2), ...Object.fromEntries(
        ['costo', 'precio1', 'precio2', 'precio3'].map(k => [k, Number(oldProduct[k]).toFixed(4)])) });
    assert.equal(migrated.gravado, true);
    assert.equal(migrated.stock_minimo, '0.00');
    assert.equal(migrated.notificar_minimo, true);
    assert.equal(migrated.categoria, '');
    assert.deepEqual((await admin.query('SELECT row_to_json(v) AS document FROM ventas v ORDER BY id')).rows,
      oldDocuments.map(row => ({ document: {
        ...row.document, caja_id: null, metodo_pago: null,
        descuento_porcentaje: 0, descuento: 0, estado: 'activa',
        anulada_en: null, anulada_por: null, motivo_anulacion: null, vencimiento: null, version: 1,
      } })));
    assert.deepEqual((await admin.query('SELECT row_to_json(m) AS document FROM movimientos_inventario m ORDER BY id')).rows, oldMovements);
    assert.deepEqual(await migrateDatabase(admin), []);
    await assert.rejects(admin.query('UPDATE productos SET stock_minimo=-1'), error => error.code === '23514');
    await assert.rejects(admin.query('UPDATE productos SET gravado=NULL'), error => error.code === '23502');
  } finally { await admin.end(); await previousDatabase.stop(); }
});

test('a legacy PUT preserves exact omitted text imported by a valid relational backup', async () => {
  const textWithSpaces = '  Marca de un respaldo  ';
  // A valid backup may preserve surrounding spaces. Updating an unrelated field
  // must not rewrite those persisted attributes when the client omits them.
  const backup = await (await fetch(origin + '/api/backup')).json();
  const imported = backup.tables.productos.find(p => Number(p.id) === productId);
  imported.marca = textWithSpaces;
  imported.ubicacion = '  A-03  ';
  const restore = await write('restore', { revision: (await state()).revision, backup });
  assert.equal(restore.status, 200, await restore.clone().text());
  const response = await write(`productos/${productId}`, { ...basic(await product()), nombre: 'Otra descripción' }, 'PUT');
  assert.equal(response.status, 200, await response.clone().text());
  const persisted = await product();
  assert.equal(persisted.marca, textWithSpaces);
  assert.equal(persisted.ubicacion, '  A-03  ');
});
