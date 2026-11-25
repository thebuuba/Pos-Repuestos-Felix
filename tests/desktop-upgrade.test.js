import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { startDesktop } from '../src/desktop/main.js';

const v6Schema = {
  turnos_caja: ['id', 'usuario', 'cajero', 'fondo', 'abierto_en', 'cerrado_en', 'cerrado_por', 'esperado', 'contado', 'ventas', 'version'],
  configuracion: ['id', 'empresa', 'tasa_itbis', 'version', 'actualizado_en', 'rnc', 'tel', 'correo', 'direccion', 'redondeo', 'nivel_precio_predeterminado', 'formato_impresion', 'pie_ticket', 'permitir_stock_negativo'],
  clientes: ['id', 'nombre', 'rnc', 'tel', 'saldo_apertura', 'activo', 'version', 'creado_en', 'actualizado_en', 'correo', 'direccion', 'limite_credito', 'es_contado'],
  formulas_precios: ['id', 'nombre', 'factor_costo', 'recargo1', 'recargo2', 'recargo3', 'activo', 'version', 'creado_en', 'actualizado_en'],
  suplidores: ['id', 'nombre', 'rnc', 'tel', 'activo', 'version', 'creado_en', 'actualizado_en', 'correo', 'contacto', 'dias_credito', 'formula_id'],
  productos: ['id', 'codigo', 'nombre', 'costo', 'precio1', 'precio2', 'precio3', 'stock', 'activo', 'version', 'creado_en', 'actualizado_en', 'marca', 'categoria', 'ubicacion', 'stock_minimo', 'gravado', 'notificar_minimo'],
  ventas: ['id', 'cliente_id', 'cliente_nombre', 'cliente_rnc', 'fecha', 'creado_en', 'tipo_comprobante', 'ncf', 'condicion', 'base', 'itbis', 'total', 'caja_id', 'metodo_pago'],
  venta_detalles: ['id', 'venta_id', 'producto_id', 'codigo', 'nombre', 'cantidad', 'nivel_precio', 'precio', 'base', 'itbis', 'total'],
  compras: ['id', 'suplidor_id', 'suplidor_nombre', 'numero', 'fecha', 'creado_en', 'total'],
  compra_detalles: ['id', 'compra_id', 'producto_id', 'codigo', 'nombre', 'cantidad', 'costo', 'precio1', 'precio2', 'precio3', 'total'],
  movimientos_inventario: ['id', 'producto_id', 'venta_detalle_id', 'compra_detalle_id', 'tipo', 'cantidad', 'existencia_posterior', 'motivo', 'creado_en'],
  movimientos_caja: ['id', 'caja_id', 'tipo', 'monto', 'concepto', 'usuario', 'creado_en'],
};

function stripToV6Effect(effect, path) {
  const copy = structuredClone(effect);
  if (path === '/api/ventas') {
    for (const key of ['descuento_porcentaje', 'descuento', 'estado', 'anulada_en', 'anulada_por', 'motivo_anulacion', 'vencimiento']) {
      delete copy[key];
    }
  } else if (path === '/api/compras') {
    for (const key of ['condicion', 'vencimiento']) delete copy[key];
  } else if (path.startsWith('/api/productos')) {
    delete copy.altCodes;
    delete copy.referencia;
  } else if (path === '/api/configuracion') {
    delete copy.meta_diaria;
  }
  return copy;
}

function buildLegacyV6Sqlite(directory, sourceLedger) {
  const db = new DatabaseSync(join(directory, 'pos.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE operations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,
      fingerprint TEXT NOT NULL,record TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',wire TEXT,receipt TEXT,error TEXT) STRICT;
    CREATE TABLE identities(table_name TEXT NOT NULL,local_id INTEGER NOT NULL,remote_id INTEGER NOT NULL,
      PRIMARY KEY(table_name,local_id),UNIQUE(table_name,remote_id)) STRICT;
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL) STRICT;
    CREATE TABLE reconciliation_archives(id TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
    CREATE TABLE remembered_sessions(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE) STRICT;`);
  for (const [table, columns] of Object.entries(v6Schema)) {
    db.exec(`CREATE TABLE local_${table}(${columns.map(col => `${col} ANY${col === 'id' ? ' PRIMARY KEY' : ''}`).join(',')}) STRICT;`);
    const rows = sourceLedger.database.prepare(`SELECT ${columns.join(',')} FROM local_${table}`).all();
    const insert = db.prepare(`INSERT INTO local_${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...columns.map(col => row[col]));
  }
  for (const row of sourceLedger.database.prepare('SELECT key,value FROM metadata').all()) {
    db.prepare('INSERT INTO metadata VALUES(?,?)').run(row.key, row.value);
  }
  for (const row of sourceLedger.database.prepare('SELECT table_name,local_id,remote_id FROM identities').all()) {
    if (v6Schema[row.table_name]) db.prepare('INSERT INTO identities VALUES(?,?,?)').run(row.table_name, row.local_id, row.remote_id);
  }
  for (const row of sourceLedger.database.prepare('SELECT token_hash,user_id,expires FROM sessions').all()) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(row.token_hash, row.user_id, row.expires);
  }
  for (const row of sourceLedger.database.prepare('SELECT operation_id,fingerprint,record,status,wire,receipt,error FROM operations ORDER BY sequence').all()) {
    const record = JSON.parse(row.record);
    if (record.expected?.effect) record.expected.effect = stripToV6Effect(record.expected.effect, record.path);
    db.prepare('INSERT INTO operations(operation_id,fingerprint,record,status,wire,receipt,error) VALUES(?,?,?,?,?,?,?)')
      .run(row.operation_id, row.fingerprint, JSON.stringify(record), row.status, row.wire, row.receipt, row.error);
  }
  db.close();
}

function runDesktopCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/desktop/main.js', ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('actualización desde base local v6 (v1.0.0) completa campos nuevos, conserva ventas/compras y sincroniza pendientes', { timeout: 120000 }, async t => {
  const seedDir = await mkdtemp(join(tmpdir(), 'felix-v6-seed-'));
  const upgradeDir = await mkdtemp(join(tmpdir(), 'felix-v6-upgrade-'));
  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-v6-assets-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  let seedEngine, upgradedApp;
  t.after(async () => {
    await upgradedApp?.stop();
    await seedEngine?.close();
    await cloud.end();
    await database.stop();
    await rm(seedDir, { recursive: true, force: true });
    await rm(upgradeDir, { recursive: true, force: true });
    await rm(assetsDir, { recursive: true, force: true });
  });

  await writeFile(join(assetsDir, 'index.html'), '<!doctype html><title>POS</title>');
  await migrateDatabase(cloud);
  const actor = { id: randomUUID(), name: 'Dueño Repuestos' };
  const remote = (path, options) => path === '/api/sync/bootstrap'
    ? readSyncBootstrap(cloud, 'Nube')
    : writeSyncOperation(cloud, options.body, 'Nube', actor);

  // 1. Seed realistic v1.0.0 data in the cloud: supplier, credit customer, product, purchase, open turn, cash sale & credit sale.
  const initial = await readSnapshot(cloud, 'Nube');
  const dbId = initial.databaseId;
  const sup = await writeOperation(cloud, 'POST', '/api/suplidores', { databaseId: dbId, nombre: 'Importadora Norte', rnc: '130000001', tel: '809-555-0100' }, randomUUID(), 'Nube', actor);
  const cust = await writeOperation(cloud, 'POST', '/api/clientes', { databaseId: dbId, nombre: 'Taller Los Primos', rnc: '131222333', tel: '809-555-0200', limiteCredito: '5000' }, randomUUID(), 'Nube', actor);
  const prod = await writeOperation(cloud, 'POST', '/api/productos', { databaseId: dbId, codigo: 'FIL-100', nombre: 'Filtro de Aceite', costo: '120', precio1: '250', precio2: '220', precio3: '200', stock: '10' }, randomUUID(), 'Nube', actor);
  await writeOperation(cloud, 'POST', '/api/compras', {
    databaseId: dbId, suplidorId: sup.result.id, numero: 'FAC-COMP-01', fecha: '2026-11-20',
    items: [{ productoId: prod.result.id, versionProducto: 1, codigo: 'FIL-100', nombre: 'Filtro de Aceite', cantidad: '5', costo: '120', precio1: '250', precio2: '220', precio3: '200' }],
  }, randomUUID(), 'Nube', actor);
  const turn = await writeOperation(cloud, 'POST', '/api/caja/abrir', { databaseId: dbId, monto: '1000' }, randomUUID(), 'Nube', actor);
  const snap1 = await readSnapshot(cloud, 'Nube');
  const contadoCliente = snap1.state.clientes.find(c => c.esContado);
  const creditCliente = snap1.state.clientes.find(c => c.id === cust.result.id);
  const prodRow = snap1.state.productos.find(p => p.id === prod.result.id);

  // Synced cash sale (will exist in local_ventas)
  const cashSale = await writeOperation(cloud, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: contadoCliente.id, versionCliente: contadoCliente.version,
    versionConfiguracion: snap1.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: prodRow.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: prodRow.version }],
  }, randomUUID(), 'Nube', actor);

  // Synced credit sale (will exist in local_ventas)
  const snap2 = await readSnapshot(cloud, 'Nube');
  const prodRow2 = snap2.state.productos.find(p => p.id === prod.result.id);
  const creditSale = await writeOperation(cloud, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: creditCliente.id, versionCliente: creditCliente.version,
    versionConfiguracion: snap2.state.configuracionVersion, condicion: 'Credito', tipoComprobante: 'B01', metodoPago: 'credito',
    items: [{ productoId: prodRow2.id, cantidad: '3', nivelPrecio: 'precio1', versionProducto: prodRow2.version }],
  }, randomUUID(), 'Nube', actor);

  // Download to a temporary desktop ledger and record ONE pending offline sale (simulating unsynced v6 offline sale)
  seedEngine = new DesktopEngine(new DesktopLedger(seedDir));
  await seedEngine.adopt(await remote('/api/sync/bootstrap'));
  const localBeforeOffline = await seedEngine.snapshot();
  const localProd = localBeforeOffline.state.productos.find(p => p.codigo === 'FIL-100');
  const localContado = localBeforeOffline.state.clientes.find(c => c.esContado);
  const offlineSale = await seedEngine.write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: localBeforeOffline.state.caja.session.id,
    clienteId: localContado.id, versionCliente: localContado.version,
    versionConfiguracion: localBeforeOffline.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: localProd.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: localProd.version }],
  }, randomUUID(), actor);
  assert.equal(seedEngine.status().pending, 1);

  // 2. Materialize an exact v6 SQLite database (WITHOUT v7 columns or v7 tables!) in upgradeDir.
  buildLegacyV6Sqlite(upgradeDir, seedEngine.ledger);
  await seedEngine.close();
  seedEngine = null;

  // Verify the v6 SQLite file genuinely lacks v7 columns before upgrade!
  const verifyOld = new DatabaseSync(join(upgradeDir, 'pos.sqlite'));
  const oldSalesCols = new Set(verifyOld.prepare('PRAGMA table_info(local_ventas)').all().map(r => r.name));
  assert.equal(oldSalesCols.has('descuento'), false);
  assert.equal(oldSalesCols.has('estado'), false);
  assert.equal(oldSalesCols.has('version'), false);
  const oldPurchaseCols = new Set(verifyOld.prepare('PRAGMA table_info(local_compras)').all().map(r => r.name));
  assert.equal(oldPurchaseCols.has('condicion'), false);
  assert.equal(oldPurchaseCols.has('version'), false);
  verifyOld.close();

  // 3. Reinstall/start the new v7 Windows desktop directly on top of the existing v6 directory!
  upgradedApp = await startDesktop({ directory: upgradeDir, assetsDirectory: assetsDir });
  const upgradedSnap = await upgradedApp.engine.snapshot();

  // Verify ALL existing sales (2 synced + 1 pending offline = 3) and purchase (1) survived intact!
  assert.equal(upgradedSnap.state.facturas.length, 3);
  assert.equal(upgradedSnap.state.compras.length, 1);
  assert.equal(upgradedSnap.state.productos.find(p => p.codigo === 'FIL-100').stock, 9); // 10 + 5 - 2 - 3 - 1 = 9
  assert.equal(upgradedApp.engine.status().pending, 1);

  // Verify backfilled v7 columns on preserved rows
  for (const invoice of upgradedSnap.state.facturas) {
    assert.equal(invoice.estado, 'activa');
    assert.equal(invoice.descuento, 0);
    assert.equal(invoice.descuentoPorcentaje, 0);
    assert.equal(invoice.version, 1);
  }
  assert.equal(upgradedSnap.state.compras[0].condicion, 'Contado');
  assert.equal(upgradedSnap.state.compras[0].version, 1);

  // Verify preserved cash expected total (1000 fondo + 500 synced cash sale + 250 offline cash sale = 1750)
  assert.equal(upgradedSnap.state.caja.summary.expected, 1750);

  // 4. Synchronize the pending v6 offline sale to the v7 cloud PostgreSQL — must succeed with ZERO conflict!
  const syncStatus = await upgradedApp.engine.synchronize(remote, actor);
  assert.equal(syncStatus.pending, 0, JSON.stringify(syncStatus));
  assert.equal(syncStatus.conflict, null);
  assert.equal(syncStatus.connection, 'online');

  const cloudAfterSync = await readSnapshot(cloud, 'Nube');
  assert.equal(cloudAfterSync.state.facturas.length, 3);
  assert.equal(cloudAfterSync.state.productos.find(p => p.codigo === 'FIL-100').stock, 9);
  assert.ok(cloudAfterSync.state.facturas.some(f => f.id === cashSale.result.id));
  assert.ok(cloudAfterSync.state.facturas.some(f => f.id === creditSale.result.id));
  assert.equal(offlineSale.state.facturas.length, 3);

  // 5. Verify new v7 features work seamlessly on the upgraded old sales (credit payment + invoice void)!
  const currentLocal = await upgradedApp.engine.snapshot();
  const upgradedCredit = currentLocal.state.facturas.find(f => f.condicion === 'Credito');
  const payment = await upgradedApp.engine.write('POST', '/api/cuentas/cobros', {
    databaseId: dbId, ventaId: upgradedCredit.id, version: upgradedCredit.version,
    cajaId: currentLocal.state.caja.session.id,
    metodoPago: 'efectivo', monto: '200', referencia: 'AB-01', nota: 'Abono tras actualizar',
  }, randomUUID(), actor);
  assert.equal(payment.state.facturas.find(f => f.id === upgradedCredit.id).pagado, 200);
  const upgradedCash = payment.state.facturas.find(f => f.id === cashSale.result.id);
  const voided = await upgradedApp.engine.write('POST', `/api/ventas/${upgradedCash.id}/anular`, {
    databaseId: dbId, version: upgradedCash.version, motivo: 'Prueba anulación post-actualización',
  }, randomUUID(), actor);
  assert.equal(voided.state.facturas.find(f => f.id === upgradedCash.id).estado, 'anulada');
});

test('diagnóstico útil cuando falla el arranque de escritorio (puerto inválido, SQLite dañado y bloqueo)', { timeout: 60000 }, async t => {
  const badPortDir = await mkdtemp(join(tmpdir(), 'felix-diag-port-'));
  const corruptDir = await mkdtemp(join(tmpdir(), 'felix-diag-corrupt-'));
  const lockedDir = await mkdtemp(join(tmpdir(), 'felix-diag-lock-'));
  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-diag-assets-'));
  let runningApp;
  t.after(async () => {
    await runningApp?.stop();
    await rm(badPortDir, { recursive: true, force: true });
    await rm(corruptDir, { recursive: true, force: true });
    await rm(lockedDir, { recursive: true, force: true });
    await rm(assetsDir, { recursive: true, force: true });
  });
  await writeFile(join(assetsDir, 'index.html'), '<!doctype html><title>POS</title>');

  // Case 1: Invalid saved port in SQLite metadata
  const ledger = new DesktopLedger(badPortDir);
  ledger.set('port', 999999);
  ledger.close();
  const portFail = await runDesktopCli(['--data-dir', badPortDir, '--assets', assetsDir]);
  assert.equal(portFail.code, 1);
  assert.match(portFail.stdout, /FELIX_ERROR=Error en servidor local: El puerto guardado del POS necesita revisión\./);
  const portLog = await readFile(join(badPortDir, 'startup-error.log'), 'utf8');
  assert.match(portLog, /Etapa: server/);
  assert.match(portLog, /puerto guardado/);

  // Case 2: Corrupted SQLite file
  await writeFile(join(corruptDir, 'pos.sqlite'), 'archivo-corrupto-no-sqlite');
  const corruptFail = await runDesktopCli(['--data-dir', corruptDir, '--assets', assetsDir]);
  assert.equal(corruptFail.code, 1);
  assert.match(corruptFail.stdout, /FELIX_ERROR=Error en base de datos local \(SQLite\):/);
  const corruptLog = await readFile(join(corruptDir, 'startup-error.log'), 'utf8');
  assert.match(corruptLog, /Etapa: sqlite/);

  // Case 3: Another instance already holds the exclusive Windows named pipe lock
  runningApp = await startDesktop({ directory: lockedDir, assetsDirectory: assetsDir });
  const lockFail = await runDesktopCli(['--data-dir', lockedDir, '--assets', assetsDir]);
  assert.equal(lockFail.code, 1);
  assert.match(lockFail.stdout, /FELIX_ERROR=Error en acceso exclusivo: El POS ya está abierto/);
  const lockLog = await readFile(join(lockedDir, 'startup-error.log'), 'utf8');
  assert.match(lockLog, /Etapa: lock/);
});

test('ventas concurrentes entre web/otra PC y Windows no invierten movimientos_inventario y auto-reparan pos.sqlite dañado sin borrar pendientes', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-concurrent-mov-'));
  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-concurrent-assets-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  let app, app2, app3;
  t.after(async () => {
    await app3?.stop();
    await app2?.stop();
    await app?.stop();
    await cloud.end();
    await database.stop();
    await rm(dir, { recursive: true, force: true });
    await rm(assetsDir, { recursive: true, force: true });
  });

  await writeFile(join(assetsDir, 'index.html'), '<!doctype html><title>POS</title>');
  await migrateDatabase(cloud);
  const actor = { id: randomUUID(), name: 'Cajero Mostrador' };
  const remote = (path, options) => path === '/api/sync/bootstrap'
    ? readSyncBootstrap(cloud, 'Nube')
    : writeSyncOperation(cloud, options.body, 'Nube', actor);

  const initial = await readSnapshot(cloud, 'Nube');
  const dbId = initial.databaseId;
  const prod = await writeOperation(cloud, 'POST', '/api/productos', {
    databaseId: dbId, codigo: 'BUJ-CONC', nombre: 'Bujía Concurrente',
    costo: '50', precio1: '100', precio2: '90', precio3: '80', stock: '10',
  }, randomUUID(), 'Nube', actor);
  const turn = await writeOperation(cloud, 'POST', '/api/caja/abrir', { databaseId: dbId, monto: '500' }, randomUUID(), 'Nube', actor);
  const snap0 = await readSnapshot(cloud, 'Nube');
  const contado = snap0.state.clientes.find(c => c.esContado);
  const prod0 = snap0.state.productos.find(p => p.id === prod.result.id);

  // 1. Windows PC downloads initial state (stock = 10, movimiento id = 1).
  app = await startDesktop({ directory: dir, assetsDirectory: assetsDir });
  await app.engine.adopt(await remote('/api/sync/bootstrap'));

  // 2. While Windows is offline, Web/another PC sells 2 units of the SAME product (remote movimiento id = 2, stock = 8).
  await writeOperation(cloud, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: contado.id, versionCliente: contado.version,
    versionConfiguracion: snap0.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: prod0.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: prod0.version }],
  }, randomUUID(), 'Nube', actor);

  // 3. Windows PC sells 3 units of the SAME product locally (local movimiento id = 2, stock = 7).
  const localSnap = await app.engine.snapshot();
  const localProd = localSnap.state.productos.find(p => p.codigo === 'BUJ-CONC');
  const localContado = localSnap.state.clientes.find(c => c.esContado);
  await app.engine.write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: localSnap.state.caja.session.id, clienteId: localContado.id, versionCliente: localContado.version,
    versionConfiguracion: localSnap.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: localProd.id, cantidad: '3', nivelPrecio: 'precio1', versionProducto: localProd.version }],
  }, randomUUID(), actor);

  // 4. Windows syncs: Supabase assigns remote movimiento id = 3 (stock = 5).
  // Previously importRemote swapped local 2 <-> 3, breaking rebuild() permanently!
  const status = await app.engine.synchronize(remote, actor);
  assert.equal(status.pending, 0, JSON.stringify(status));
  assert.equal(status.connection, 'online', JSON.stringify(status));
  assert.equal((await app.engine.snapshot()).state.productos.find(p => p.codigo === 'BUJ-CONC').stock, 5);
  await app.stop();
  app = null;

  // 5. Reopening Windows cleanly loads pos.sqlite with zero consistency errors!
  app2 = await startDesktop({ directory: dir, assetsDirectory: assetsDir });
  assert.equal((await app2.engine.snapshot()).state.productos.find(p => p.codigo === 'BUJ-CONC').stock, 5);
  await app2.stop();
  app2 = null;

  // 6. Simulate an ALREADY-BROKEN pos.sqlite from v1.2.3/v1.2.4 where movimientos_inventario 2 and 3 were swapped in SQLite!
  const db = new DatabaseSync(join(dir, 'pos.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  const m2 = db.prepare("SELECT * FROM local_movimientos_inventario WHERE id='2'").get();
  const m3 = db.prepare("SELECT * FROM local_movimientos_inventario WHERE id='3'").get();
  assert.ok(m2 && m3);
  db.exec("DELETE FROM local_movimientos_inventario WHERE id IN ('2','3')");
  const cols = Object.keys(m2);
  const ins = db.prepare(`INSERT INTO local_movimientos_inventario(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
  ins.run(...cols.map(c => c === 'id' ? '2' : m3[c]));
  ins.run(...cols.map(c => c === 'id' ? '3' : m2[c]));
  db.exec("DELETE FROM identities WHERE table_name='movimientos_inventario' AND local_id IN (2,3)");
  db.prepare("INSERT INTO identities VALUES('movimientos_inventario',2,3),('movimientos_inventario',3,2)").run();
  db.close();

  // Reopening MUST auto-repair the swapped IDs losslessly (even completely offline!)
  app3 = await startDesktop({ directory: dir, assetsDirectory: assetsDir });
  assert.equal((await app3.engine.snapshot()).state.productos.find(p => p.codigo === 'BUJ-CONC').stock, 5);

  // 7. Safety guard: if there IS a pending offline operation, clearCachedProjection() must refuse to clear.
  const snap3 = await app3.engine.snapshot();
  const prod3 = snap3.state.productos.find(p => p.codigo === 'BUJ-CONC');
  const cont3 = snap3.state.clientes.find(c => c.esContado);
  await app3.engine.write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: snap3.state.caja.session.id, clienteId: cont3.id, versionCliente: cont3.version,
    versionConfiguracion: snap3.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: prod3.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: prod3.version }],
  }, randomUUID(), actor);
  assert.equal(app3.engine.ledger.clearCachedProjection(), false, 'Nunca limpia la proyección si hay pendientes');
  assert.equal(app3.engine.status().pending, 1);
});
