import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { receiptFromConfirmation } from '../frontend/src/data/operational-sales.js';

const actor = { id: 'owner-taller', name: 'dueno', role: 'dueno' };

test('cuentas abiertas de taller: inventario en despacho, precio congelado, devoluciones, cobro consolidado con NCF, crédito a CxC, anulación, cancelación y respaldo v8/v7', { timeout: 120000 }, async t => {
  const db = await temporaryPostgres();
  const db2 = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const pool2 = new pg.Pool({ connectionString: db2.connectionString });
  t.after(async () => {
    await pool2.end();
    await pool.end();
    await db2.stop();
    await db.stop();
  });

  await migrateDatabase(pool);
  await migrateDatabase(pool2);
  const init = await readSnapshot(pool, 'Taller');
  const dbId = init.databaseId;
  const write = (method, path, body, ctx = {}) =>
    writeOperation(pool, method, path, { databaseId: dbId, ...body }, randomUUID(), 'Taller', actor, ctx);

  // Configurar caja, NCF B02, cliente crédito y productos
  const turn = await write('POST', '/api/caja/abrir', { monto: '1000' });
  const cajaId = turn.result.id;
  await write('PUT', '/api/ncf', {
    tipo: 'B02', inicio: 1, fin: 100, actual: 0, vencimiento: '2030-12-31', activa: true,
  });
  const cashCustomer = turn.state.clientes.find(c => c.esContado);
  const creditCust = await write('POST', '/api/clientes', {
    nombre: 'Taller Mecánico El Sol', rnc: '131555666', tel: '809-555-7777', limiteCredito: '20000',
  });
  const pA = await write('POST', '/api/productos', {
    codigo: 'FRN-01', nombre: 'Juego de bandas de freno', gravado: true,
    costo: '400.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000', stock: '10',
  });
  const pB = await write('POST', '/api/productos', {
    codigo: 'ACE-01', nombre: 'Aceite sintético 10W-40', gravado: false,
    costo: '200.0000', precio1: '500.0000', precio2: '450.0000', precio3: '400.0000', stock: '8',
  });

  // 1. Abrir cuenta #1 con 3 unidades de FRN-01 a P1 (1000.0000) -> stock baja inmediatamente 10 -> 7
  const open1 = await write('POST', '/api/taller', {
    clienteId: cashCustomer.id,
    clienteNombre: 'Carlos Civic Rojo',
    mecanico: 'Luis Gómez',
    vehiculo: 'Honda Civic 2019',
    retiradoPor: 'Ayudante José',
    nota: 'Cambio de frenos delanteros',
    items: [{ productoId: pA.result.id, versionProducto: 1, nivelPrecio: 'precio1', cantidad: '3' }],
  });
  const acc1Id = open1.result.id;
  assert.equal(open1.state.productos.find(p => p.id === pA.result.id).stock, 7);
  assert.equal(open1.state.cuentasTaller.length, 1);
  assert.equal(open1.state.cuentasTaller[0].cliente, 'Carlos Civic Rojo');
  assert.equal(open1.state.cuentasTaller[0].items[0].precioExacto, '1000.0000');
  assert.ok(open1.state.movimientos.some(m => m.tipo === 'despacho' && m.cantidad === -3 && m.existencia_posterior === 7));

  // 2. Subir precio de FRN-01 de 1000 a 1200 mientras la cuenta sigue abierta
  const prodNow = open1.state.productos.find(p => p.id === pA.result.id);
  const priceUp = await write('PUT', `/api/productos/${pA.result.id}`, {
    version: prodNow.version,
    codigo: 'FRN-01', nombre: 'Juego de bandas de freno', marca: '', categoria: '', ubicacion: '',
    stockMinimo: '0', gravado: true, notificarMinimo: true, stock: '7',
    costo: '400.0000', precio1: '1200.0000', precio2: '1100.0000', precio3: '1000.0000',
  });
  const pAUpdated = priceUp.state.productos.find(p => p.id === pA.result.id);
  const pBNow = priceUp.state.productos.find(p => p.id === pB.result.id);

  // 3. Despachar 1 unidad más de FRN-01 (al precio NUEVO 1200) + 2 de ACE-01 (exento 500)
  const disp1 = await write('POST', `/api/taller/${acc1Id}/despachar`, {
    version: 1,
    retiradoPor: 'Luis Gómez',
    items: [
      { productoId: pA.result.id, versionProducto: pAUpdated.version, nivelPrecio: 'precio1', cantidad: '1' },
      { productoId: pB.result.id, versionProducto: pBNow.version, nivelPrecio: 'precio1', cantidad: '2' },
    ],
  });
  assert.equal(disp1.state.productos.find(p => p.id === pA.result.id).stock, 6);
  assert.equal(disp1.state.productos.find(p => p.id === pB.result.id).stock, 6);
  const accAfterDisp = disp1.state.cuentasTaller.find(a => a.id === acc1Id);
  assert.equal(accAfterDisp.version, 2);
  assert.equal(accAfterDisp.items[0].precioExacto, '1000.0000', 'La primera entrega debe mantener precio congelado 1000');
  assert.equal(accAfterDisp.items[1].precioExacto, '1200.0000', 'La segunda entrega congela el nuevo precio 1200');
  assert.equal(accAfterDisp.items[2].gravado, false, 'Aceite conserva gravado=false');

  // 4. Devolver 1 unidad de la primera entrega (3 -> neta 2) -> stock de FRN-01 sube 6 -> 7
  const ret1 = await write('POST', `/api/taller/${acc1Id}/devolver`, {
    version: accAfterDisp.version,
    itemId: accAfterDisp.items[0].id,
    cantidad: '1',
    motivo: 'Sobró una banda',
  });
  assert.equal(ret1.state.productos.find(p => p.id === pA.result.id).stock, 7);
  const accAfterRet = ret1.state.cuentasTaller.find(a => a.id === acc1Id);
  assert.equal(accAfterRet.items[0].cantidadDevuelta, 1);
  assert.equal(accAfterRet.items[0].cantidadNeta, 2);
  assert.ok(ret1.state.movimientos.some(m => m.tipo === 'devolucion_despacho' && m.cantidad === 1 && m.existencia_posterior === 7));

  // 5. Cobrar cuenta #1 en efectivo con descuento de RD$200:
  // Bruto: 2*1000 (2000) + 1*1200 (1200) + 2*500 (1000) = 4200 -> menos RD$200 = 4000 exactos!
  const billed1 = await write('POST', `/api/taller/${acc1Id}/facturar`, {
    version: accAfterRet.version,
    clienteId: cashCustomer.id,
    cajaId,
    condicion: 'Contado',
    tipoComprobante: 'B02',
    metodoPago: 'efectivo',
    descuentoMonto: '200',
    versionConfiguracion: ret1.state.configuracionVersion,
  });
  assert.equal(billed1.result.id, acc1Id);
  assert.ok(billed1.result.ventaId > 0);
  // Stock NO debe descontarse por segunda vez al facturar!
  assert.equal(billed1.state.productos.find(p => p.id === pA.result.id).stock, 7);
  assert.equal(billed1.state.productos.find(p => p.id === pB.result.id).stock, 6);
  const inv1 = billed1.state.facturas.find(f => f.id === billed1.result.ventaId);
  assert.equal(inv1.cliente, 'Carlos Civic Rojo');
  assert.equal(inv1.total, 4000);
  assert.equal(inv1.descuento, 200);
  assert.equal(inv1.ncf, 'B0200000001');
  assert.equal(inv1.items.length, 3);
  assert.equal(billed1.state.caja.summary.cashSales, 4000);
  assert.equal(billed1.state.caja.summary.expected, 5000); // 1000 fondo + 4000 efectivo
  const receipt1 = receiptFromConfirmation(billed1);
  assert.equal(receipt1.totals.total, 4000);
  assert.equal(receipt1.totals.grossTotal, 4200);
  assert.equal(receipt1.ncf, 'B0200000001');

  // 6. Anular la factura generada desde taller -> devuelve stock (FRN-01: 7+3=10, ACE-01: 6+2=8) y ajusta caja (5000->1000)
  const voided1 = await write('POST', `/api/ventas/${inv1.id}/anular`, {
    version: inv1.version,
    motivo: 'Corrección de prueba',
  });
  assert.equal(voided1.state.productos.find(p => p.id === pA.result.id).stock, 10);
  assert.equal(voided1.state.productos.find(p => p.id === pB.result.id).stock, 8);
  assert.equal(voided1.state.caja.summary.expected, 1000);

  // 7. Cuenta #2 facturada a CRÉDITO -> entra directo en Cuentas x cobrar + acepta abono
  const pBFor2 = voided1.state.productos.find(p => p.id === pB.result.id);
  const open2 = await write('POST', '/api/taller', {
    clienteId: creditCust.result.id,
    mecanico: 'Marcos',
    vehiculo: 'Hilux 2021',
    items: [{ productoId: pB.result.id, versionProducto: pBFor2.version, nivelPrecio: 'precio1', cantidad: '3' }],
  });
  const billed2 = await write('POST', `/api/taller/${open2.result.id}/facturar`, {
    version: 1,
    clienteId: creditCust.result.id,
    cajaId,
    condicion: 'Credito',
    tipoComprobante: 'B02',
    metodoPago: 'credito',
    vencimiento: '2030-11-30',
    versionConfiguracion: open2.state.configuracionVersion,
  });
  const inv2 = billed2.state.facturas.find(f => f.id === billed2.result.ventaId);
  assert.equal(inv2.condicion, 'Credito');
  assert.equal(inv2.total, 1500);
  assert.equal(billed2.state.clientes.find(c => c.id === creditCust.result.id).deuda, 1500);
  // Abonar RD$500 en efectivo a esa CxC
  const abono = await write('POST', '/api/cuentas/cobros', {
    ventaId: inv2.id, version: inv2.version, monto: '500', metodoPago: 'efectivo', cajaId, nota: 'Primer abono taller',
  });
  assert.equal(abono.state.clientes.find(c => c.id === creditCust.result.id).deuda, 1000);
  assert.equal(abono.state.caja.summary.expected, 1500); // 1000 fondo + 500 cobro

  // 8. Cuenta #3 abierta y luego CANCELADA -> devuelve todas las piezas al inventario
  const pAFor3 = abono.state.productos.find(p => p.id === pA.result.id);
  const open3 = await write('POST', '/api/taller', {
    clienteId: cashCustomer.id,
    mecanico: 'Pedro',
    items: [{ productoId: pA.result.id, versionProducto: pAFor3.version, nivelPrecio: 'precio3', cantidad: '2' }],
  });
  assert.equal(open3.state.productos.find(p => p.id === pA.result.id).stock, 8);
  const cancelled3 = await write('POST', `/api/taller/${open3.result.id}/cancelar`, {
    version: 1, motivo: 'Cliente pospuso reparación',
  });
  assert.equal(cancelled3.state.productos.find(p => p.id === pA.result.id).stock, 10);
  assert.equal(cancelled3.state.cuentasTaller.find(a => a.id === open3.result.id).estado, 'cancelada');

  // 9. Respaldo v8 y restauración íntegra en db2 + compatibilidad hacia atrás con respaldo v7
  const backupV8 = await readSnapshot(pool, 'Taller', true);
  assert.equal(backupV8.version, 8);
  assert.equal(backupV8.tables.cuentas_taller.length, 3);
  assert.equal(backupV8.tables.cuentas_taller_items.length, 5);
  const init2 = await readSnapshot(pool2, 'Restaurada');
  const restoredV8 = await writeOperation(pool2, 'POST', '/api/restore', {
    databaseId: init2.databaseId, revision: init2.revision, backup: backupV8,
  }, randomUUID(), 'Restaurada', actor);
  assert.equal(restoredV8.state.cuentasTaller.length, 3);
  assert.equal(restoredV8.state.productos.find(p => p.codigo === 'FRN-01').stock, 10);
  assert.equal(restoredV8.state.productos.find(p => p.codigo === 'ACE-01').stock, 5);

  // Comprobar que un respaldo v7 (sin tablas de taller ni movimientos despacho) restaura limpiamente
  const v7CleanDb = await temporaryPostgres();
  const v7CleanPool = new pg.Pool({ connectionString: v7CleanDb.connectionString });
  t.after(async () => { await v7CleanPool.end(); await v7CleanDb.stop(); });
  await migrateDatabase(v7CleanPool);
  const v7Export = await readSnapshot(v7CleanPool, 'V7', true);
  v7Export.version = 7;
  delete v7Export.tables.cuentas_taller;
  delete v7Export.tables.cuentas_taller_items;
  const restoredV7 = await writeOperation(pool2, 'POST', '/api/restore', {
    databaseId: restoredV8.databaseId, revision: restoredV8.revision, backup: v7Export,
  }, randomUUID(), 'Restaurada', actor);
  assert.deepEqual(restoredV7.state.cuentasTaller, []);
});

test('Windows offline SQLite: cuentas de taller offline, sincronización sin duplicados/NCF y actualización automática v7 -> v8', { timeout: 120000 }, async t => {
  const db = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: db.connectionString });
  const dir = await mkdtemp(join(tmpdir(), 'felix-taller-offline-'));
  let engine;
  t.after(async () => {
    await engine?.pool?.end().catch(() => {});
    engine?.ledger?.close();
    await cloud.end();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await migrateDatabase(cloud);
  const init = await readSnapshot(cloud, 'Nube');
  await writeOperation(cloud, 'POST', '/api/productos', {
    databaseId: init.databaseId, codigo: 'TALL-OFF', nombre: 'Bujía Iridium', gravado: true,
    costo: '100.0000', precio1: '300.0000', precio2: '280.0000', precio3: '250.0000', stock: '20',
  }, randomUUID(), 'Nube', actor);
  await writeOperation(cloud, 'PUT', '/api/ncf', {
    databaseId: init.databaseId, tipo: 'B02', inicio: 1, fin: 50, actual: 0, vencimiento: '2030-12-31', activa: true,
  }, randomUUID(), 'Nube', actor);

  // Simular una instalación existente v7 en Windows (sin local_cuentas_taller ni local_cuentas_taller_items)
  const boot1 = await readSyncBootstrap(cloud, 'Nube');
  const ledgerV7 = new DesktopLedger(dir);
  engine = new DesktopEngine(ledgerV7);
  await engine.adopt(boot1);
  // Registrar una venta previa para verificar que se conserva al actualizar v7 -> v8
  const openTurn = await engine.write('POST', '/api/caja/abrir', { databaseId: boot1.snapshot.databaseId, monto: '500' }, randomUUID(), actor);
  const cajaId = openTurn.result.id;
  const prod = openTurn.state.productos[0];
  const cashCust = openTurn.state.clientes.find(c => c.esContado);
  await engine.write('POST', '/api/ventas', {
    databaseId: boot1.snapshot.databaseId, cajaId, clienteId: cashCust.id,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    versionConfiguracion: openTurn.state.configuracionVersion,
    items: [{ productoId: prod.id, versionProducto: prod.version, nivelPrecio: 'precio1', cantidad: '1' }],
  }, randomUUID(), actor);

  // Borrar manualmente las tablas v8 en SQLite para simular archivo pos.sqlite creado en v1.1.2 (v7)
  await engine.pool.end();
  engine.pool = null;
  ledgerV7.database.exec('DROP TABLE local_cuentas_taller_items; DROP TABLE local_cuentas_taller;');
  ledgerV7.close();

  // Reabrir con DesktopLedger v8 -> debe recrear las tablas v8 y conservar intactas las operaciones y ventas v7!
  const ledgerV8 = new DesktopLedger(dir);
  engine = new DesktopEngine(ledgerV8);
  await engine.rebuild();
  const afterUpgrade = await engine.snapshot();
  assert.equal(afterUpgrade.state.facturas.length, 1, 'La venta previa v7 se conservó intacta');
  assert.equal(afterUpgrade.state.productos[0].stock, 19);
  assert.equal(engine.status().pending, 2);

  // Operar cuenta de taller 100% offline: abrir + despachar 2do lote + devolver 1 + cobrar en efectivo
  const dbId = afterUpgrade.databaseId;
  const p1 = afterUpgrade.state.productos[0];
  const wOpen = await engine.write('POST', '/api/taller', {
    databaseId: dbId, clienteId: cashCust.id, clienteNombre: 'Moto Delivery', mecanico: 'Ramón',
    items: [{ productoId: p1.id, versionProducto: p1.version, nivelPrecio: 'precio3', cantidad: '3' }],
  }, randomUUID(), actor);
  assert.equal(wOpen.state.productos[0].stock, 16);

  const p2 = wOpen.state.productos[0];
  const wDisp = await engine.write('POST', `/api/taller/${wOpen.result.id}/despachar`, {
    databaseId: dbId, version: 1, retiradoPor: 'Ramón',
    items: [{ productoId: p2.id, versionProducto: p2.version, nivelPrecio: 'precio3', cantidad: '2' }],
  }, randomUUID(), actor);
  assert.equal(wDisp.state.productos[0].stock, 14);

  const firstItemId = wDisp.state.cuentasTaller[0].items[0].id;
  const wRet = await engine.write('POST', `/api/taller/${wOpen.result.id}/devolver`, {
    databaseId: dbId, version: 2, itemId: firstItemId, cantidad: '1', motivo: 'No la necesitó',
  }, randomUUID(), actor);
  assert.equal(wRet.state.productos[0].stock, 15);

  const wBill = await engine.write('POST', `/api/taller/${wOpen.result.id}/facturar`, {
    databaseId: dbId, version: 3, clienteId: cashCust.id, cajaId,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    versionConfiguracion: wRet.state.configuracionVersion,
  }, randomUUID(), actor);
  const offlineInv = wBill.state.facturas.find(f => f.id === wBill.result.ventaId);
  assert.equal(offlineInv.total, 1000); // 4 netas * 250
  assert.equal(offlineInv.ncf, null, 'Offline nunca debe emitir NCF simulado');
  assert.equal(engine.status().pending, 6);

  // Cerrar y reabrir SQLite para comprobar durabilidad antes de sincronizar
  await engine.pool.end();
  engine.pool = null;
  engine.ledger.close();
  engine = new DesktopEngine(new DesktopLedger(dir));
  await engine.rebuild();
  assert.equal(engine.status().pending, 6);

  // Sincronizar con la nube
  const remote = async (path, options = {}) => {
    if (path === '/api/sync/bootstrap') return readSyncBootstrap(cloud, 'Nube');
    if (path === '/api/sync/operations') return writeSyncOperation(cloud, options.body, 'Nube', actor, { receiptOnly: Boolean(options.receiptOnly) });
    throw new Error('Ruta remota inesperada: ' + path);
  };
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 0, JSON.stringify(engine.status()));

  // Re-sincronizar no duplica nada
  await engine.synchronize(remote, actor);
  const cloudSnap = await readSnapshot(cloud, 'Nube');
  assert.equal(cloudSnap.state.productos[0].stock, 15);
  assert.equal(cloudSnap.state.facturas.length, 2);
  assert.equal(cloudSnap.state.facturas.filter(f => f.ncf !== null).length, 0, 'Ninguna factura offline sincronizada emite NCF');
  assert.equal(cloudSnap.state.cuentasTaller.length, 1);
  assert.equal(cloudSnap.state.cuentasTaller[0].estado, 'facturada');
  assert.equal(cloudSnap.state.caja.summary.expected, 1800); // 500 fondo + 300 venta v7 + 1000 taller
});

test('E2E navegador: flujo completo de cuentas de taller en mostrador, estado de cuenta, cobro efectivo y paso a Cuentas x cobrar', { timeout: 180000 }, async t => {
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-taller-ui-'));
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
    await pool.end();
    await db.stop();
    await rm(assetsDir, { recursive: true, force: true });
  });

  await migrateDatabase(pool);
  const init = await readSnapshot(pool, 'TallerUI');
  const dbId = init.databaseId;
  await writeOperation(pool, 'POST', '/api/caja/abrir', { databaseId: dbId, monto: '1000' }, randomUUID(), 'TallerUI', actor);
  await writeOperation(pool, 'POST', '/api/clientes', {
    databaseId: dbId, nombre: 'Taller Hermanos Cruz', rnc: '131999888', tel: '809-555-3333', limiteCredito: '15000',
  }, randomUUID(), 'TallerUI', actor);
  await writeOperation(pool, 'POST', '/api/productos', {
    databaseId: dbId, codigo: 'FLT-90', nombre: 'Filtro de aceite Toyota', gravado: true,
    costo: '200.0000', precio1: '500.0000', precio2: '450.0000', precio3: '400.0000', stock: '12',
  }, randomUUID(), 'TallerUI', actor);
  await writeOperation(pool, 'POST', '/api/productos', {
    databaseId: dbId, codigo: 'COR-55', nombre: 'Correa de alternador', gravado: true,
    costo: '300.0000', precio1: '700.0000', precio2: '650.0000', precio3: '600.0000', stock: '10',
  }, randomUUID(), 'TallerUI', actor);

  await buildOperational(assetsDir);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assetsDir + sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(origin + '/ventas', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Cuentas taller/i }).waitFor({ state: 'visible' });

  // 1. Verificar cero desborde horizontal en móvil 390px y oscuro
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(mobileOverflow, false, 'No debe haber desborde horizontal en /ventas móvil 390px');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 2. Agregar producto al carrito del mostrador y enviarlo a una nueva cuenta de taller
  const searchInput = page.getByLabel(/Código o nombre del producto/i);
  await searchInput.fill('FLT-90');
  await searchInput.press('Enter');
  await page.getByText('Filtro de aceite Toyota').first().waitFor({ state: 'visible' });

  await page.getByRole('button', { name: /Cuentas taller/i }).click();
  await page.getByRole('button', { name: /Abrir cuenta con carrito/i }).click();
  await page.getByLabel(/Nombre \/ referencia del cliente/i).fill('Cliente Civic Blanco');
  await page.getByLabel(/^Mecánico$/i).fill('Luis Gómez');
  await page.getByLabel(/Vehículo \/ motor \/ placa/i).fill('Civic 2018');
  await page.getByRole('button', { name: /Abrir cuenta de taller/i }).click();

  // Debe pasar al detalle de la cuenta #1 con 1 filtro despachado
  await page.getByText('Cuenta de taller #1').waitFor({ state: 'visible' });
  await page.getByText('Filtro de aceite Toyota').first().waitFor({ state: 'visible' });

  // 3. Despachar 2 correas dentro del detalle de la cuenta (a P3=600)
  const workshopSearch = page.locator('#taller-buscar-prod');
  await workshopSearch.fill('COR-55');
  await page.locator('#taller-cant').fill('2');
  await page.getByRole('button', { name: /^Despachar$/i }).click();
  await page.getByText('Correa de alternador').first().waitFor({ state: 'visible' });

  // 4. Devolver 1 correa inline
  const returnButtons = page.getByRole('button', { name: /^Devolver$/i });
  await returnButtons.last().click();
  const returnQtyInput = page.locator('input[id^="dev-cant-"]');
  await returnQtyInput.fill('1');
  await page.getByRole('button', { name: /Confirmar devolución/i }).click();
  await page.getByText(/Devuelto: 1/i).waitFor({ state: 'visible' });

  // 5. Imprimir estado de cuenta (pre-ticket informativo)
  await page.getByRole('button', { name: /Imprimir estado/i }).click();
  await page.getByRole('heading', { name: /Estado de cuenta de taller/i }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /^Cerrar$/i }).click();

  // 6. Cobrar cuenta en efectivo
  await page.getByRole('button', { name: /Cobrar cuenta/i }).click();
  await page.getByRole('button', { name: /^Exacto$/i }).click();
  await page.getByRole('button', { name: /Confirmar y cobrar/i }).click();
  await page.getByRole('heading', { name: /Venta registrada/i }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Nueva venta/i }).click();

  // 7. Abrir cuenta #2 para "Taller Hermanos Cruz", despachar 1 filtro y facturarla a CRÉDITO -> verificar en /cuentas-por-cobrar
  await page.getByRole('button', { name: /Cuentas taller/i }).click();
  await page.getByRole('button', { name: /^Nueva cuenta$/i }).click();
  await page.getByLabel(/Cliente registrado/i).click();
  await page.getByRole('option', { name: 'Taller Hermanos Cruz' }).click();
  await page.getByLabel(/^Mecánico$/i).fill('Carlos');
  await page.getByRole('button', { name: /Abrir cuenta de taller/i }).click();
  await page.getByText('Cuenta de taller #2').waitFor({ state: 'visible' });
  await page.locator('#taller-buscar-prod').fill('FLT-90');
  await page.getByRole('button', { name: /^Despachar$/i }).click();
  await page.getByText('Filtro de aceite Toyota').first().waitFor({ state: 'visible' });

  await page.getByRole('button', { name: /Cobrar cuenta/i }).click();
  await page.getByLabel(/Condición de pago/i).click();
  await page.getByRole('option', { name: /Crédito \(Cuentas x cobrar\)/i }).click();
  await page.getByRole('button', { name: /Facturar a crédito/i }).click();
  await page.getByRole('heading', { name: /Venta registrada/i }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Nueva venta/i }).click();

  // Navegar a Cuentas x cobrar y verificar que aparece Taller Hermanos Cruz
  await page.goto(origin + '/cuentas-por-cobrar', { waitUntil: 'networkidle' });
  await page.getByText('Taller Hermanos Cruz').first().waitFor({ state: 'visible' });

  assert.deepEqual(pageErrors, [], 'No debe haber errores JS sin capturar');
});
