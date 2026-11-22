import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { createApp } from '../src/server.js';
import { writeOperation } from '../src/pos/store.js';

let database, pool, server, base;
before(async () => {
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  const { migrateDatabase } = await import('../src/db/migrations.js'); await migrateDatabase(pool);
  await pool.end();
  // Exercise the complete runtime with the restricted production role.
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end(); await database?.stop();
});
const get = async () => (await fetch(base + '/api/state')).json();
async function write(path, body, key = randomUUID(), method = 'POST') {
  const snapshot = await get();
  return fetch(base + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ databaseId: snapshot.databaseId, ...body }) });
}

test('sale is computed by server, transactional, and concurrent retry creates one document', async () => {
  let response = await write('productos', { codigo: 'LAST', nombre: 'Última unidad', costo: '0.10', stock: 1, precio1: '0.30', precio2: '0.20', precio3: '0.10' });
  assert.equal(response.status, 200, await response.text());
  let snapshot = await get(); const product = snapshot.state.productos.find(p => p.codigo === 'LAST');
  const sale = { clienteId: snapshot.state.clientes[0].id, condicion: 'Credito', tipoComprobante: 'B02', items: [{ productoId: product.id, cantidad: 1, nivelPrecio: 'precio1', precio: 0 }], total: 0 };
  const key = randomUUID();
  const results = await Promise.all([write('ventas', sale, key), write('ventas', sale, key)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const docs = await Promise.all(results.map(r => r.json()));
  assert.equal(docs[0].result.id, docs[1].result.id);
  assert.deepEqual(docs.map(d => d.confirmation?.replayed).sort(), [false, true]);
  for (const doc of docs) assert.deepEqual(doc.confirmation, {
    operationId: key, databaseId: snapshot.databaseId, method: 'POST', path: '/api/ventas', replayed: doc.confirmation.replayed,
  });
  snapshot = await get();
  assert.equal(snapshot.state.facturas.length, 1);
  assert.equal(snapshot.state.facturas[0].total, 0.3);
  assert.equal(snapshot.state.facturas[0].ncf, null);
  assert.equal(snapshot.state.clientes[0].deuda, 0.3);
  assert.equal(snapshot.state.productos.find(p => p.id === product.id).stock, 0);
  assert.equal((await write('ventas', sale)).status, 409);
  assert.equal((await write('ventas', { ...sale, condicion: 'Contado' }, key)).status, 409);
  assert.equal((await get()).state.facturas.length, 1);
});

test('competing sales cannot oversell and errors roll back every detail', async () => {
  await write('productos', { codigo: 'RACE', nombre: 'Unidad', costo: 1, stock: 1, precio1: 118, precio2: 118, precio3: 118 });
  const snapshot = await get(); const p = snapshot.state.productos.find(p => p.codigo === 'RACE');
  const sale = { clienteId: snapshot.state.clientes[0].id, condicion: 'Contado', tipoComprobante: 'B02', items: [{ productoId: p.id, cantidad: 1, nivelPrecio: 'precio1' }] };
  const results = await Promise.all([write('ventas', sale), write('ventas', sale)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const before = await get();
  const failed = await write('ventas', { ...sale, items: [{ productoId: p.id, cantidad: 1, nivelPrecio: 'precio1' }, { productoId: 999999, cantidad: 1, nivelPrecio: 'precio1' }] });
  assert.equal(failed.status, 409);
  assert.deepEqual((await get()).state, before.state);
});

test('purchase creates catalog and ledger atomically; duplicate supplier invoice is rejected', async () => {
  const supplierResponse = await write('suplidores', { nombre: 'Proveedor', rnc: '', tel: '' });
  assert.equal(supplierResponse.status, 200);
  const supplier = (await supplierResponse.json()).result.id;
  const purchase = { suplidorId: supplier, numero: 'F-1', items: [{ codigo: 'NEW', nombre: 'Nuevo', cantidad: 3, costo: '0.10', precio1: '0.30', precio2: '0.20', precio3: '0.10' }] };
  assert.equal((await write('compras', purchase)).status, 200);
  assert.equal((await write('compras', purchase)).status, 409);
  const state = (await get()).state;
  assert.equal(state.compras[0].total, 0.3);
  assert.equal(state.productos.find(p => p.codigo === 'NEW').stock, 3);
  const p = state.productos.find(p => p.codigo === 'NEW');
  assert.equal((await write(`productos/${p.id}`, { ...p, stock: 2 }, randomUUID(), 'PUT')).status, 200);
  assert.equal((await write(`productos/${p.id}`, { ...p, stock: 9 }, randomUUID(), 'PUT')).status, 409);
  assert.equal((await write(`productos/${p.id}`, { version: p.version + 1 }, randomUUID(), 'DELETE')).status, 200);
  assert.equal((await get()).state.productos.some(item => item.id === p.id), false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM compra_detalles WHERE producto_id=$1', [p.id])).rows[0].n, 1);
});

test('a purchase exceeding the stock limit leaves headers, products, details and inventory unchanged', async () => {
  const create = await write('productos', { codigo: 'FULL', nombre: 'Límite', costo: 1, stock: 2147483647, precio1: 2, precio2: 2, precio3: 2 });
  assert.equal(create.status, 200);
  const before = await get();
  const response = await write('compras', { suplidorId: before.state.suplidores[0].id, numero: 'ROLLBACK', items: [
    { codigo: 'NEW-ROLLBACK', nombre: 'Temporal', cantidad: 1, costo: 1, precio1: 2, precio2: 2, precio3: 2 },
    { codigo: 'FULL', nombre: 'Límite', cantidad: 1, costo: 1, precio1: 2, precio2: 2, precio3: 2 },
  ] });
  assert.equal(response.status, 400);
  assert.deepEqual((await get()).state, before.state);
});

test('a SQL failure on the second purchase detail rolls back the header, products, details and movements', async t => {
  const admin = new pg.Pool({ connectionString: database.connectionString });
  t.after(async () => {
    try {
      await admin.query(`DROP TRIGGER IF EXISTS prueba_segundo_detalle ON public.compra_detalles;
        DROP FUNCTION IF EXISTS public.prueba_segundo_detalle()`);
    } finally { await admin.end(); }
  });
  await admin.query(`
    CREATE FUNCTION public.prueba_segundo_detalle() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.compra_detalles d
        JOIN public.movimientos_inventario m ON m.compra_detalle_id = d.id
        WHERE d.compra_id = NEW.compra_id AND d.codigo = 'ROLLBACK-PRIMERA'
      ) THEN RAISE no_data_found; END IF;
      RAISE check_violation USING CONSTRAINT = 'prueba_segundo_detalle';
    END;
    $$;
    CREATE TRIGGER prueba_segundo_detalle BEFORE INSERT ON public.compra_detalles
      FOR EACH ROW WHEN (NEW.codigo = 'ROLLBACK-SEGUNDA')
      EXECUTE FUNCTION public.prueba_segundo_detalle()`);

  const supplier = await write('suplidores', { nombre: 'Proveedor de prueba de rollback' });
  assert.equal(supplier.status, 200);
  const { result } = await supplier.json();
  const before = await get();
  const backupTables = async () => (await (await fetch(base + '/api/backup')).json()).tables;
  const beforeTables = await backupTables();
  const operationId = randomUUID();
  const line = { nombre: 'Repuesto de prueba', cantidad: '0.25', costo: '12.3456', precio1: 20, precio2: 20, precio3: 20 };
  const body = { databaseId: before.databaseId, suplidorId: result.id, numero: 'ROLLBACK-SEGUNDO-DETALLE',
    items: [{ ...line, codigo: 'ROLLBACK-PRIMERA' }, { ...line, codigo: 'ROLLBACK-SEGUNDA' }] };
  await assert.rejects(writeOperation(pool, 'POST', '/api/compras', body, operationId, 'Pruebas'),
    error => error.status === 400 && error.cause?.code === '23514' && error.cause.constraint === 'prueba_segundo_detalle' &&
      error.rejection?.operationId === operationId);
  assert.deepEqual(await get(), before);
  assert.deepEqual(await backupTables(), beforeTables);
});

test('backup restores complete relational data, rotates identity and preserves failed restore atomically', async () => {
  const original = await get();
  const backup = await (await fetch(base + '/api/backup')).json();
  assert.equal(backup.version, 5);
  assert.ok(backup.tables.productos.some(p => !p.activo));
  const invalid = structuredClone(backup); invalid.tables.venta_detalles[0].producto_id = 999999;
  assert.equal((await write('restore', { backup: invalid, revision: original.revision })).status, 400);
  assert.deepEqual((await get()).state, original.state);
  const key = randomUUID();
  const payload = { databaseId: original.databaseId, backup, revision: original.revision };
  const call = () => fetch(base + '/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  const restored = await call(); assert.equal(restored.status, 200, await restored.clone().text());
  const snapshot = await restored.json(); assert.notEqual(snapshot.databaseId, original.databaseId);
  assert.deepEqual(snapshot.state, original.state);
  assert.equal((await call()).status, 200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pos_privado.respaldos')).rows[0].n >= 1, true);
});

test('restore rejects a valid FK pointing to the wrong inventory document', async () => {
  const original = await get();
  const backup = await (await fetch(base + '/api/backup')).json();
  const moves = backup.tables.movimientos_inventario.filter(m => m.tipo === 'venta');
  assert.equal(moves.length, 2);
  [moves[0].venta_detalle_id, moves[1].venta_detalle_id] = [moves[1].venta_detalle_id, moves[0].venta_detalle_id];
  const response = await write('restore', { backup, revision: original.revision });
  assert.equal(response.status, 400);
  assert.deepEqual((await get()).state, original.state);
});

test('restore refuses to discard a concurrent completed write', async () => {
  const original = await get();
  const backup = await (await fetch(base + '/api/backup')).json();
  assert.equal((await write('clientes', { nombre: 'Conservado' })).status, 200);
  assert.equal((await write('restore', { backup, revision: original.revision })).status, 409);
  assert.ok((await get()).state.clientes.some(c => c.nombre === 'Conservado'));
});

test('restore rejects precision loss instead of silently rounding numeric columns', async () => {
  const original = await get();
  const backup = await (await fetch(base + '/api/backup')).json();
  backup.tables.productos[0].costo = '1.00001';
  const response = await write('restore', { backup, revision: original.revision });
  assert.equal(response.status, 400);
  assert.deepEqual((await get()).state, original.state);
});

test('legacy backup restore imports through relational constraints using restricted role', async () => {
  const original = await get();
  const backup = { empresa: 'Restaurada', itbisRate: 0.18, productos: [{ codigo: 'LEG', nombre: 'Histórico', costo: 1, stock: 3, precio1: 2, precio2: 2, precio3: 2 }], clientes: [{ nombre: 'Contado', rnc: '', tel: '', deuda: 0 }], suplidores: [], facturas: [], compras: [] };
  const response = await write('restore', { backup, revision: original.revision });
  assert.equal(response.status, 200, await response.clone().text());
  const current = await response.json();
  assert.equal(current.state.empresa, 'Restaurada');
  assert.equal(current.state.productos[0].stock, 3);
  assert.equal(current.state.movimientos[0].tipo, 'apertura');
  assert.notEqual(current.databaseId, original.databaseId);
});

test('idempotent replay is a coherent snapshot while another sale commits', async () => {
  const snapshot = await get(); const key = randomUUID();
  const body = { databaseId: snapshot.databaseId, codigo: 'REPLAY', nombre: 'Consistencia', costo: 1, stock: 2, precio1: 2, precio2: 2, precio3: 2 };
  const created = await writeOperation(pool, 'POST', '/api/productos', body, key, 'Pruebas');
  const writerPool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', application_name: 'felix-replay-writer' });
  let writer, writerPid, finished = false;
  writerPool.on('connect', client => { writerPid = client.processID; });
  const wrappedPool = { async connect() {
    const client = await pool.connect();
    return { release: () => client.release(), async query(sql, params) {
      const result = await client.query(sql, params);
      if (sql.includes('FROM public.productos ORDER BY id')) {
        writer = writeOperation(writerPool, 'POST', '/api/ventas', { databaseId: snapshot.databaseId, clienteId: snapshot.state.clientes[0].id, condicion: 'Contado', tipoComprobante: 'B02', items: [{ productoId: created.result.id, cantidad: 1, nivelPrecio: 'precio1' }] }, randomUUID(), 'Pruebas').finally(() => { finished = true; });
        const deadline = Date.now() + 10000;
        while (!finished) {
          const waiting = await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [writerPid || null]);
          if (waiting.rowCount) break;
          assert.ok(Date.now() < deadline, 'writer must commit or wait on the replay lock');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      return result;
    } };
  } };
  try {
    const replay = await writeOperation(wrappedPool, 'POST', '/api/productos', body, key, 'Pruebas');
    await writer;
    const stock = replay.state.productos.find(p => p.id === created.result.id).stock;
    const sold = replay.state.facturas.flatMap(f => f.items).filter(i => i.productoId === created.result.id).reduce((sum, i) => sum + i.cant, 0);
    assert.equal(stock + sold, 2);
    assert.equal(replay.revision, created.revision);
  } finally { await writerPool.end(); }
});
