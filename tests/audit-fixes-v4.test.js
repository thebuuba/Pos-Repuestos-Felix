import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { redactBootstrapForRole, redactSnapshotForRole } from '../src/pos/roles.js';
import { handleRequest } from '../src/http/app.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { tokenHash } from '../src/desktop/credentials.js';

const ownerActor = { id: randomUUID(), name: 'felix', role: 'dueno' };
const cashierActor = { id: randomUUID(), name: 'cajero1', role: 'cajero' };

test('auditoría v4: redacción completa cajero (costos históricos, fórmulas, detalles compra), topes de descuento/crédito, taller abierto, gzip restore y reloj monótono', { timeout: 120000 }, async (t) => {
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const dir = await mkdtemp(join(tmpdir(), 'felix-audit-v4-'));
  let engine, srv;
  t.after(async () => {
    if (srv) await new Promise(done => srv.close(done));
    await engine?.close().catch(() => {});
    await pool.end();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  });
  await migrateDatabase(pool);
  const init = await readSnapshot(pool, 'Prueba');
  const dbId = init.databaseId;

  // 1. Seed fórmula, suplidor, producto, cliente, compra a crédito con pago en efectivo en caja, venta y cuenta de taller
  const formula = await writeOperation(pool, 'POST', '/api/formulas', {
    databaseId: dbId, nombre: 'Margen Secreto', factorCosto: 1.15, recargo1: 60, recargo2: 40, recargo3: 40,
  }, randomUUID(), 'Prueba', ownerActor);
  const supplier = await writeOperation(pool, 'POST', '/api/suplidores', {
    databaseId: dbId, nombre: 'Suplidor Privado', diasCredito: 30, formulaId: formula.result.id,
  }, randomUUID(), 'Prueba', ownerActor);
  const prod = await writeOperation(pool, 'POST', '/api/productos', {
    databaseId: dbId, codigo: 'SEC-001', nombre: 'Bujía Secreta', costo: '123.4567', precio1: '300', precio2: '250', precio3: '250', stock: '10',
  }, randomUUID(), 'Prueba', ownerActor);
  const customer = await writeOperation(pool, 'POST', '/api/clientes', {
    databaseId: dbId, nombre: 'Taller Con Cuenta', limiteCredito: '10000',
  }, randomUUID(), 'Prueba', ownerActor);
  const turn = await writeOperation(pool, 'POST', '/api/caja/abrir', {
    databaseId: dbId, monto: '5000',
  }, randomUUID(), 'Prueba', ownerActor);

  // Compra a crédito + pago en efectivo desde caja (fuerza retención en bootstrap para cuadratura de caja)
  const purchase = await writeOperation(pool, 'POST', '/api/compras', {
    databaseId: dbId, suplidorId: supplier.result.id, numero: 'SUP-900', condicion: 'Credito',
    items: [{ productoId: prod.result.id, versionProducto: 1, codigo: 'SEC-001', nombre: 'Bujía Secreta', cantidad: '2', costo: '123.4567', precio1: '300', precio2: '250', precio3: '250' }],
  }, randomUUID(), 'Prueba', ownerActor);
  await writeOperation(pool, 'POST', '/api/cuentas/pagos', {
    databaseId: dbId, compraId: purchase.result.id, version: 1, cajaId: turn.result.id, metodoPago: 'efectivo', monto: '100', referencia: 'EF-1', nota: 'Pago caja',
  }, randomUUID(), 'Prueba', ownerActor);

  // Venta normal y cuenta de taller abierta con ítem despachado
  const snap1 = await readSnapshot(pool, 'Prueba');
  const pRow = snap1.state.productos.find(p => p.codigo === 'SEC-001');
  const saleRes = await writeOperation(pool, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: customer.result.id,
    versionConfiguracion: snap1.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: pRow.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pRow.version }],
  }, randomUUID(), 'Prueba', ownerActor, { deltaBaseRevision: snap1.revision });
  const snap2 = await readSnapshot(pool, 'Prueba');
  const pRow2 = snap2.state.productos.find(p => p.codigo === 'SEC-001');
  await writeOperation(pool, 'POST', '/api/taller', {
    databaseId: dbId, clienteId: customer.result.id, mecanico: 'Pedro', vehiculo: 'CG150',
    items: [{ productoId: pRow2.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pRow2.version }],
  }, randomUUID(), 'Prueba', ownerActor);

  // 2. Verificar redacción completa para cajero en snapshot, delta y bootstrap
  const fullSnap = await readSnapshot(pool, 'Prueba');
  const cajeroSnap = redactSnapshotForRole(fullSnap, 'cajero');
  assert.equal(cajeroSnap.state.productos[0].costo, 0);
  assert.equal(cajeroSnap.state.formulas.length, 0);
  assert.equal(cajeroSnap.state.suplidores[0].formulaId, null);
  assert.equal(cajeroSnap.state.suplidores[0].diasCredito, null);
  assert.equal(cajeroSnap.state.facturas[0].items[0].costoUnitario, null);
  assert.equal(cajeroSnap.state.facturas[0].items[0].costoUnitarioExacto, null);
  assert.equal(cajeroSnap.state.cuentasTaller[0].items[0].costoUnitario, null);
  assert.equal(cajeroSnap.state.cuentasTaller[0].items[0].costoUnitarioExacto, null);

  // Delta de venta redactado para cajero
  const cajeroDelta = redactSnapshotForRole(saleRes, 'cajero');
  assert.equal(cajeroDelta.changes.facturasUpsert[0].items[0].costoUnitario, null);
  assert.equal(cajeroDelta.changes.facturasUpsert[0].items[0].costoUnitarioExacto, null);

  // Bootstrap redactado: sin costo_unitario, sin fórmulas, sin código/costo real en compra_detalles retenidos, y restaura limpio en PGlite
  const minimalBootstrap = await readSyncBootstrap(pool, 'Prueba', undefined, { minimal: true });
  assert.equal(minimalBootstrap.snapshot.state, undefined);
  assert.ok(minimalBootstrap.catalogo);
  const cajeroBoot = redactBootstrapForRole(minimalBootstrap, 'cajero');
  assert.equal(cajeroBoot.backup.tables.formulas_precios.length, 0);
  assert.equal(cajeroBoot.backup.tables.venta_detalles[0].costo_unitario, null);
  assert.equal(cajeroBoot.backup.tables.cuentas_taller_items[0].costo_unitario, null);
  assert.equal(cajeroBoot.backup.tables.compras.length, 1);
  assert.equal(cajeroBoot.backup.tables.compra_detalles.length, 1);
  assert.equal(cajeroBoot.backup.tables.compra_detalles[0].codigo, 'RESTRINGIDO');
  assert.notEqual(cajeroBoot.backup.tables.compra_detalles[0].costo, '123.4567');

  engine = new DesktopEngine(new DesktopLedger(dir));
  await engine.adopt(cajeroBoot);
  assert.equal((await engine.snapshot()).state.productos[0].stock, 10);

  // 3. Guardas de rol para cajero: limiteCredito (403), descuento > 10% (403), descuento <= 10% (200), recordatorio suplidor (403)
  await assert.rejects(
    writeOperation(pool, 'POST', '/api/clientes', {
      databaseId: dbId, nombre: 'Auto Crédito', limiteCredito: '999999',
    }, randomUUID(), 'Prueba', cashierActor),
    err => err.status === 403,
  );
  const cBefore = (await readSnapshot(pool, 'Prueba')).state.clientes.find(c => c.id === customer.result.id);
  await assert.rejects(
    writeOperation(pool, 'PUT', `/api/clientes/${cBefore.id}`, {
      databaseId: dbId, version: cBefore.version, nombre: cBefore.nombre, limiteCredito: '50000',
    }, randomUUID(), 'Prueba', cashierActor),
    err => err.status === 403,
  );
  // Cajero sí puede editar teléfono sin alterar limiteCredito
  const okEdit = await writeOperation(pool, 'PUT', `/api/clientes/${cBefore.id}`, {
    databaseId: dbId, version: cBefore.version, nombre: cBefore.nombre, tel: '809-555-9999', limiteCredito: '10000',
  }, randomUUID(), 'Prueba', cashierActor);
  assert.equal(okEdit.result.id, cBefore.id);

  // Descuento 25% rechazado a cajero (403), descuento 10% permitido
  const snap3 = await readSnapshot(pool, 'Prueba');
  const p3 = snap3.state.productos.find(p => p.codigo === 'SEC-001');
  await assert.rejects(
    writeOperation(pool, 'POST', '/api/ventas', {
      databaseId: dbId, cajaId: turn.result.id, clienteId: customer.result.id,
      versionConfiguracion: snap3.state.configuracionVersion,
      condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
      descuentoPorcentaje: 25,
      items: [{ productoId: p3.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: p3.version }],
    }, randomUUID(), 'Prueba', cashierActor),
    err => err.status === 403,
  );
  const okDisc = await writeOperation(pool, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: customer.result.id,
    versionConfiguracion: snap3.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    descuentoPorcentaje: 10,
    items: [{ productoId: p3.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: p3.version }],
  }, randomUUID(), 'Prueba', cashierActor);
  assert.ok(okDisc.result.id);

  // Recordatorio con suplidorId bloqueado para cajero (403)
  await assert.rejects(
    writeOperation(pool, 'POST', '/api/recordatorios', {
      databaseId: dbId, titulo: 'Pagar suplidor', suplidorId: supplier.result.id,
    }, randomUUID(), 'Prueba', cashierActor),
    err => err.status === 403,
  );

  // 4. Eliminar cliente con cuenta de taller abierta -> 409
  const cLatest = (await readSnapshot(pool, 'Prueba')).state.clientes.find(c => c.id === customer.result.id);
  await assert.rejects(
    writeOperation(pool, 'DELETE', `/api/clientes/${cLatest.id}`, {
      databaseId: dbId, version: cLatest.version,
    }, randomUUID(), 'Prueba', ownerActor),
    err => err.status === 409 && /taller/i.test(err.message),
  );

  // 5. Desktop /api/desktop/archive redacta y filtra por actorId para cajero
  engine.ledger.database.prepare('INSERT INTO reconciliation_archives VALUES(?,?)').run(
    'owner-arch',
    JSON.stringify({ id: 'owner-arch', actorId: ownerActor.id, checkpoint: minimalBootstrap.backup, operations: [] }),
  );
  engine.ledger.database.prepare('INSERT INTO reconciliation_archives VALUES(?,?)').run(
    'cashier-arch',
    JSON.stringify({ id: 'cashier-arch', actorId: cashierActor.id, checkpoint: minimalBootstrap.backup, operations: [] }),
  );
  const tok = 'tok-cajero-audit-v4';
  engine.ledger.set('profile', { id: cashierActor.id, username: 'cajero1', name: 'cajero1', role: 'cajero', generation: 'g1', onlineAt: Date.now(), allowOffline: true });
  engine.ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(tok), cashierActor.id, Date.now() + 3600_000);
  srv = desktopServer(engine, { request: async () => { throw Object.assign(new Error('offline'), { status: 503 }); }, clear() {} }, dir);
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const archRes = await fetch(base + '/api/desktop/archive', { headers: { Cookie: `felix-desktop=${tok}` } });
  assert.equal(archRes.status, 200);
  const archBody = await archRes.json();
  assert.equal(archBody.archives.length, 1);
  assert.equal(archBody.archives[0].actorId, cashierActor.id);
  assert.equal(archBody.archives[0].checkpoint.tables.productos[0].costo, '0.0000');
  assert.equal(archBody.archives[0].checkpoint.tables.venta_detalles[0].costo_unitario, null);

  // 6. Reloj atrasado en Windows (occurredAt monótono): simula turno abierto en el futuro (+5 s) y verifica venta local válida
  const futureTurn = await readSyncBootstrap(pool, 'Prueba', undefined, { minimal: true });
  const shiftedMs = Date.now() + 5000;
  futureTurn.backup.tables.turnos_caja[0].abierto_en = new Date(shiftedMs).toISOString();
  for (const v of futureTurn.backup.tables.ventas) v.creado_en = new Date(shiftedMs + 100).toISOString();
  for (const a of futureTurn.backup.tables.abonos_cuentas) a.creado_en = new Date(shiftedMs + 200).toISOString();
  await engine.adopt(redactBootstrapForRole(futureTurn, 'cajero'));
  const localBefore = await engine.snapshot();
  const localProd = localBefore.state.productos.find(p => p.codigo === 'SEC-001');
  const localSale = await engine.write('POST', '/api/ventas', {
    databaseId: localBefore.databaseId,
    cajaId: localBefore.state.caja.session.id,
    clienteId: localBefore.state.clientes.find(c => c.esContado).id,
    versionConfiguracion: localBefore.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: localProd.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: localProd.version }],
  }, randomUUID(), { ...cashierActor, generation: 'g1' });
  assert.ok(localSale.result.id);
  // Debe reconstruir limpio al reiniciar (validateCashRestore no falla)
  await engine.rebuild();
  assert.ok(engine.pool);

  // 7. POST /api/restore acepta Content-Encoding: gzip
  const rawBackup = await readSnapshot(pool, 'Prueba', true);
  const snapNow = await readSnapshot(pool, 'Prueba');
  const gzPayload = gzipSync(Buffer.from(JSON.stringify({ databaseId: snapNow.databaseId, revision: snapNow.revision, backup: rawBackup }), 'utf8'));
  const restoreReq = new Request('http://127.0.0.1/api/restore', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1',
      Origin: 'http://127.0.0.1',
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Idempotency-Key': randomUUID(),
    },
    body: gzPayload,
  });
  const restoreRes = await handleRequest(restoreReq, { pool, databaseLabel: 'Prueba', readAsset: async () => '' });
  assert.equal(restoreRes.status, 200, await restoreRes.clone().text());
});

test('auditoría v4: utilidades Tailwind usadas en JSX existen en theme.css o standards.css', async () => {
  const stylesDir = join(process.cwd(), 'frontend', 'src', 'styles');
  let css = '';
  for (const name of await readdir(stylesDir)) {
    if (name.endsWith('.css')) css += '\n' + await readFile(join(stylesDir, name), 'utf8');
  }
  const required = [
    'sm:inline', 'text-white', 'lg:flex-row', 'lg:items-center', 'lg:justify-between',
    'bg-muted-foreground', 'bg-muted-foreground/60', 'z-40', 'p-1.5', 'p-8',
    'bg-accent/70', 'bg-accent/60', 'bg-muted/35', 'border-foreground/20',
    'w-[166px]', 'text-[13.5px]', 'opacity-35', 'opacity-45', 'py-16',
    'left-2.5', 'text-3xl', 'min-h-11', 'sm:min-h-8', 'max-w-xl', 'w-32',
  ];
  const defined = new Set();
  for (const m of css.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
    defined.add(m[1].replace(/\\(.)/g, '$1'));
  }
  const missing = required.filter(cls => !defined.has(cls));
  assert.deepEqual(missing, []);
});
