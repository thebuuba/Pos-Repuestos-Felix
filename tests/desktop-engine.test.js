import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';

test('SQLite conserva ventas offline, reinicios, respuestas perdidas, IDs y conflictos sin duplicar', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'felix-desktop-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  let engine;
  t.after(async () => { await engine?.close(); await cloud.end(); await database.stop(); await rm(directory, { recursive: true, force: true }); });
  await migrateDatabase(cloud);
  await cloud.query("SELECT setval(pg_get_serial_sequence('productos','id'),100,false), setval(pg_get_serial_sequence('turnos_caja','id'),500,false), setval(pg_get_serial_sequence('ventas','id'),700,false)");
  const actor = { id: randomUUID(), name: 'Prueba Windows' };
  const remote = (path, options) => path === '/api/sync/bootstrap' ? readSyncBootstrap(cloud, 'Prueba') : writeSyncOperation(cloud, options.body, 'Prueba', actor);
  engine = new DesktopEngine(new DesktopLedger(directory));
  await engine.adopt(await remote('/api/sync/bootstrap'));
  const databaseId = engine.ledger.get('databaseId');
  const write = (path, body, key = randomUUID()) => engine.write('POST', path, { databaseId, ...body }, key, actor);
  const opened = await write('/api/caja/abrir', { monto: '100' });
  const product = await write('/api/productos', { codigo: '000DESKTOP', nombre: 'Prueba', costo: '0.1001', precio1: '0.3001', precio2: 0, precio3: 0, stock: '20' });
  const before = await engine.snapshot();
  const sale = { cajaId: opened.result.id, clienteId: before.state.clientes[0].id, versionCliente: before.state.clientes[0].version,
    versionConfiguracion: before.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: product.result.id, cantidad: '3', nivelPrecio: 'precio1', versionProducto: before.state.productos[0].version }] };
  const key = randomUUID();
  const sold = await write('/api/ventas', sale, key);
  assert.equal(sold.state.caja.summary.expected, 101);
  assert.equal(engine.status().pending, 3);
  await engine.close();
  engine = new DesktopEngine(new DesktopLedger(directory)); await engine.rebuild();
  const restored = await engine.snapshot();
  assert.equal(restored.state.facturas[0].total, 1);
  assert.equal(restored.state.productos[0].stock, 17);
  assert.equal((await write('/api/ventas', sale, key)).confirmation.replayed, true);
  assert.equal(engine.status().pending, 3);

  let loseResponse = true;
  await engine.synchronize(async (path, options) => {
    const result = await remote(path, options);
    if (path.endsWith('operations') && loseResponse) { loseResponse = false; throw new Error('Respuesta perdida'); }
    return result;
  }, actor);
  assert.equal(engine.status().pending, 3);
  await engine.close(); engine = new DesktopEngine(new DesktopLedger(directory)); await engine.rebuild();
  await writeOperation(cloud, 'POST', '/api/clientes', { databaseId, nombre: 'Cambio independiente en web', rnc: '', tel: '' }, randomUUID(), 'Prueba', actor);
  await engine.synchronize(async (path, options) => {
    if (path.endsWith('bootstrap')) throw new Error('Descarga perdida después de confirmar');
    return remote(path, options);
  }, actor);
  assert.equal(engine.status().pending, 0, JSON.stringify(engine.status()));
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Cambio independiente en web'), false);
  await engine.synchronize(remote, actor);
  assert.equal((await engine.snapshot()).state.clientes.some(row => row.nombre === 'Cambio independiente en web'), true);
  const saved = await readSnapshot(cloud, 'Prueba');
  assert.equal(saved.state.facturas.length, 1);
  assert.equal(saved.state.facturas[0].total, 1);
  assert.equal(saved.state.productos[0].stock, 17);
  assert.notEqual(saved.state.facturas[0].id, sold.result.id);
  assert.notEqual(saved.state.productos[0].id, product.result.id);
  assert.notEqual(saved.state.caja.session.id, opened.result.id);
  assert.equal((await engine.snapshot()).state.facturas[0].id, sold.result.id);

  const prior = await engine.snapshot();
  const originalTransaction = engine.ledger.transaction.bind(engine.ledger);
  engine.ledger.transaction = action => originalTransaction(() => { action(); throw new Error('Fallo de disco simulado'); });
  await assert.rejects(write('/api/caja/movimiento', { cajaId: prior.state.caja.session.id, version: prior.state.caja.session.version, tipo: 'entrada', monto: '5', concepto: 'No guardar' }));
  engine.ledger.transaction = originalTransaction;
  assert.equal((await engine.snapshot()).state.caja.summary.expected, 101);
  assert.equal(engine.status().pending, 0);

  const localHead = (await engine.snapshot()).state.caja.session;
  await write('/api/caja/movimiento', { cajaId: localHead.id, version: localHead.version, tipo: 'entrada', monto: '10', concepto: 'Entrada local' });
  const cloudState = await readSnapshot(cloud, 'Prueba');
  await writeOperation(cloud, 'POST', '/api/caja/movimiento', { databaseId, cajaId: cloudState.state.caja.session.id, version: cloudState.state.caja.session.version,
    tipo: 'entrada', monto: '2', concepto: 'Entrada web' }, randomUUID(), 'Prueba', actor);
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 1);
  assert.match(engine.status().conflict, /caja/i);
  assert.equal((await engine.snapshot()).state.caja.summary.expected, 111);
  assert.equal((await readSnapshot(cloud, 'Prueba')).state.caja.summary.expected, 103);

  await engine.close(); engine = null;
  const child = fork(new URL('./fixtures/desktop-crash.js', import.meta.url), [], { stdio: ['pipe', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  child.send({ directory, actor });
  const [confirmed] = await once(child, 'message', { signal: AbortSignal.timeout(30000) });
  assert.equal(confirmed.expected, 112);
  const closed = once(child, 'exit'); child.kill('SIGKILL'); await closed;
  engine = new DesktopEngine(new DesktopLedger(directory)); await engine.rebuild();
  assert.equal((await engine.snapshot()).state.caja.summary.expected, 112);
  assert.equal(engine.status().pending, 2);
});
