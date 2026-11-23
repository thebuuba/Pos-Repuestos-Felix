import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { testAuthService } from './fixtures/supabase-auth.js';
import { productForBarcode } from '../frontend/src/data/barcode-scanner.js';

const actor = { id: 'test-owner', name: 'Dueño Prueba', role: 'dueno' };
const verifyDir = resolve('dist/verification/pos-completo');

test('API transaccional v7: códigos alternativos, descuentos, anulaciones, abonos CxC/CxP, NCF real, meta diaria y respaldo v7', { timeout: 120000 }, async t => {
  const database = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: database.connectionString });
  t.after(async () => { await pool.end(); await database.stop(); });
  await migrateDatabase(pool);

  const initial = await readSnapshot(pool, 'Prueba');
  const databaseId = initial.databaseId;
  const write = (method, path, payload, key = randomUUID()) =>
    writeOperation(pool, method, path, { databaseId, ...payload }, key, 'Prueba', actor);

  // 1. Productos con códigos alternativos y prevención de duplicados
  const prod = await write('POST', '/api/productos', {
    codigo: 'FIL-001',
    codigosAlternativos: ['7460012345678', '000ALT1'],
    nombre: 'Filtro de aceite Yamaha',
    marca: 'Yamaha',
    categoria: 'Motor',
    ubicacion: 'A-1',
    costo: '100',
    precio1: '200',
    precio2: '180',
    precio3: '160',
    stock: '20',
    stockMinimo: '5',
    gravado: true,
  });
  assert.deepEqual(prod.state.productos[0].codigosAlternativos, ['7460012345678', '000ALT1']);
  // Resolución de escáner con código alternativo (preservando ceros a la izquierda)
  const mappedProducts = prod.state.productos.map(p => ({ id: p.id, code: p.codigo, altCodes: p.codigosAlternativos, stock: p.stock }));
  assert.equal(productForBarcode(mappedProducts, '000ALT1').id, prod.result.id);
  assert.equal(productForBarcode(mappedProducts, '7460012345678').id, prod.result.id);

  // Colisión con código alternativo de otro producto -> 409
  await assert.rejects(
    write('POST', '/api/productos', {
      codigo: '000ALT1', nombre: 'Colisión', costo: '10', precio1: '20', precio2: 0, precio3: 0, stock: '1',
    }),
    err => err.status === 409,
  );
  await assert.rejects(
    write('POST', '/api/productos', {
      codigo: 'OTRO-1', codigosAlternativos: ['7460012345678'], nombre: 'Colisión Alt', costo: '10', precio1: '20', precio2: 0, precio3: 0, stock: '1',
    }),
    err => err.status === 409,
  );

  // 2. Apertura de caja y venta con 10 % de descuento sin NCF configurado
  const cash = await write('POST', '/api/caja/abrir', { monto: '1000.00' });
  const cashId = cash.result.id;
  const s1State = await readSnapshot(pool, 'Prueba');
  const cashCustomer = s1State.state.clientes.find(c => c.esContado);
  const saleCash = await write('POST', '/api/ventas', {
    cajaId: cashId,
    clienteId: cashCustomer.id,
    versionCliente: cashCustomer.version,
    versionConfiguracion: s1State.state.configuracionVersion,
    condicion: 'Contado',
    tipoComprobante: 'B02',
    metodoPago: 'efectivo',
    descuentoPorcentaje: 10,
    items: [{ productoId: prod.result.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: s1State.state.productos[0].version }],
  });
  const factura1 = saleCash.state.facturas.find(f => f.id === saleCash.result.id);
  assert.equal(factura1.descuentoPorcentaje, 10);
  assert.equal(factura1.descuento, 40);
  assert.equal(factura1.total, 360);
  assert.equal(Number((factura1.base + factura1.itbis).toFixed(2)), 360);
  assert.equal(factura1.ncf, null, 'Sin secuencia NCF activa, no se emite NCF');
  assert.equal(saleCash.state.productos[0].stock, 18);
  assert.equal(saleCash.state.caja.summary.expected, 1360);

  // 2b. Descuento libre en monto fijo (RD$ 75 sobre RD$ 400 -> total 325) y validaciones
  const pSnapAmt = saleCash.state.productos[0];
  await assert.rejects(
    write('POST', '/api/ventas', {
      cajaId: cashId, clienteId: cashCustomer.id, versionConfiguracion: saleCash.state.configuracionVersion,
      condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
      descuentoPorcentaje: 10, descuentoMonto: 20,
      items: [{ productoId: prod.result.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pSnapAmt.version }],
    }),
    err => err.status === 400,
  );
  await assert.rejects(
    write('POST', '/api/ventas', {
      cajaId: cashId, clienteId: cashCustomer.id, versionConfiguracion: saleCash.state.configuracionVersion,
      condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
      descuentoMonto: 250,
      items: [{ productoId: prod.result.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pSnapAmt.version }],
    }),
    err => err.status === 400,
  );
  const saleFixedDiscount = await write('POST', '/api/ventas', {
    cajaId: cashId, clienteId: cashCustomer.id, versionConfiguracion: saleCash.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'tarjeta',
    descuentoMonto: 75,
    items: [{ productoId: prod.result.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: pSnapAmt.version }],
  });
  const fFixed = saleFixedDiscount.state.facturas.find(f => f.id === saleFixedDiscount.result.id);
  assert.equal(fFixed.descuento, 75);
  assert.equal(fFixed.descuentoPorcentaje, 18.75);
  assert.equal(fFixed.total, 325);
  assert.equal(Number((fFixed.base + fFixed.itbis).toFixed(2)), 325);
  // Anulamos esta venta de tarjeta para dejar el stock en 18 y no alterar el resto de aserciones
  await write('POST', `/api/ventas/${fFixed.id}/anular`, { version: fFixed.version, motivo: 'Limpieza prueba descuento fijo' });

  // 3. Anulación de factura de efectivo (devuelve stock con movimiento 'anulacion' y revierte caja)
  const voidKey = randomUUID();
  const voided = await write('POST', `/api/ventas/${factura1.id}/anular`, {
    version: factura1.version,
    motivo: 'Error en artículo facturado',
  }, voidKey);
  const f1Voided = voided.state.facturas.find(f => f.id === factura1.id);
  assert.equal(f1Voided.estado, 'anulada');
  assert.equal(f1Voided.motivoAnulacion, 'Error en artículo facturado');
  assert.equal(voided.state.productos[0].stock, 20);
  assert.equal(voided.state.caja.summary.expected, 1000);
  const movAnulacion = await pool.query("SELECT tipo, cantidad, motivo FROM movimientos_inventario WHERE producto_id=$1 AND tipo='anulacion'", [prod.result.id]);
  assert.equal(movAnulacion.rowCount, 2);
  assert.equal(Number(movAnulacion.rows[0].cantidad), 2);
  // Idempotencia al reenviar la misma anulación
  const voidReplay = await write('POST', `/api/ventas/${factura1.id}/anular`, {
    version: factura1.version,
    motivo: 'Error en artículo facturado',
  }, voidKey);
  assert.equal(voidReplay.confirmation.replayed, true);
  // Doble anulación con clave nueva -> 409
  await assert.rejects(
    write('POST', `/api/ventas/${factura1.id}/anular`, { version: f1Voided.version, motivo: 'Otra vez' }),
    err => err.status === 409,
  );

  // 4. Venta a crédito y cobro parcial en efectivo en Cuentas x cobrar
  const customer = await write('POST', '/api/clientes', { nombre: 'Taller El Primo', rnc: '131000001', tel: '809-555-1111', limiteCredito: '5000' });
  const beforeCredit = await readSnapshot(pool, 'Prueba');
  const creditCustomer = beforeCredit.state.clientes.find(c => c.id === customer.result.id);
  const creditSale = await write('POST', '/api/ventas', {
    cajaId: cashId,
    clienteId: creditCustomer.id,
    versionCliente: creditCustomer.version,
    versionConfiguracion: beforeCredit.state.configuracionVersion,
    condicion: 'Credito',
    metodoPago: 'credito',
    tipoComprobante: 'B01',
    vencimiento: '2030-06-30',
    items: [{ productoId: prod.result.id, cantidad: '5', nivelPrecio: 'precio1', versionProducto: beforeCredit.state.productos[0].version }],
  });
  const fCredit = creditSale.state.facturas.find(f => f.id === creditSale.result.id);
  assert.equal(fCredit.total, 1000);
  assert.equal(fCredit.vencimiento, '2030-06-30');
  assert.equal(creditSale.state.clientes.find(c => c.id === creditCustomer.id).deuda, 1000);

  // Cobro parcial en efectivo -> entra a la caja abierta
  const cobro = await write('POST', '/api/cuentas/cobros', {
    ventaId: fCredit.id,
    version: fCredit.version,
    monto: '400',
    metodoPago: 'efectivo',
    cajaId: cashId,
    nota: 'Abono inicial',
  });
  assert.equal(cobro.state.facturas.find(f => f.id === fCredit.id).pagado, 400);
  assert.equal(cobro.state.clientes.find(c => c.id === creditCustomer.id).deuda, 600);
  assert.equal(cobro.state.caja.summary.cobros, 400);
  assert.equal(cobro.state.caja.summary.expected, 1400);

  // Sobrepago rechazado -> 409
  const fCreditAfterCobro = cobro.state.facturas.find(f => f.id === fCredit.id);
  await assert.rejects(
    write('POST', '/api/cuentas/cobros', {
      ventaId: fCredit.id, version: fCreditAfterCobro.version, monto: '650', metodoPago: 'transferencia',
    }),
    err => err.status === 409,
  );
  // Anular venta que ya tiene abonos -> 409
  await assert.rejects(
    write('POST', `/api/ventas/${fCredit.id}/anular`, { version: fCreditAfterCobro.version, motivo: 'No permitido' }),
    err => err.status === 409,
  );

  // 5. Compra a crédito y pago a suplidor en efectivo en Cuentas x pagar
  const supplier = await write('POST', '/api/suplidores', { nombre: 'Importadora Masotti', rnc: '101000002', diasCredito: 30 });
  const beforeBuy = await readSnapshot(pool, 'Prueba');
  const buy = await write('POST', '/api/compras', {
    suplidorId: supplier.result.id,
    numero: 'FAC-CRED-100',
    condicion: 'Credito',
    vencimiento: '2030-07-15',
    items: [{
      productoId: prod.result.id, versionProducto: beforeBuy.state.productos[0].version,
      codigo: 'FIL-001', nombre: 'Filtro de aceite Yamaha', cantidad: '20', costo: '100',
      precio1: '200', precio2: '180', precio3: '160',
    }],
  });
  const cCredit = buy.state.compras.find(c => c.id === buy.result.id);
  assert.equal(cCredit.condicion, 'Credito');
  assert.equal(cCredit.vencimiento, '2030-07-15');
  assert.equal(buy.state.suplidores.find(s => s.id === supplier.result.id).deuda, 2000);

  // Pago en efectivo que excede la caja esperada (1400) -> 409
  await assert.rejects(
    write('POST', '/api/cuentas/pagos', {
      compraId: cCredit.id, version: cCredit.version, monto: '1500', metodoPago: 'efectivo', cajaId: cashId,
    }),
    err => err.status === 409,
  );
  const pago = await write('POST', '/api/cuentas/pagos', {
    compraId: cCredit.id,
    version: cCredit.version,
    monto: '300',
    metodoPago: 'efectivo',
    cajaId: cashId,
    nota: 'Pago parcial',
  });
  assert.equal(pago.state.compras.find(c => c.id === cCredit.id).pagado, 300);
  assert.equal(pago.state.suplidores.find(s => s.id === supplier.result.id).deuda, 1700);
  assert.equal(pago.state.caja.summary.pagos, 300);
  assert.equal(pago.state.caja.summary.expected, 1100);

  // 6. Secuencias NCF reales configurables (emisión secuencial, tope 409 y desactivación)
  await write('PUT', '/api/ncf', {
    tipo: 'B02', inicio: 1, fin: 2, actual: 0, vencimiento: '2030-12-31', activa: true,
  });
  const ncfSnap1 = await readSnapshot(pool, 'Prueba');
  const cashCust1 = ncfSnap1.state.clientes.find(c => c.esContado);
  const pNcf1 = ncfSnap1.state.productos[0];
  const sNcf1 = await write('POST', '/api/ventas', {
    cajaId: cashId, clienteId: cashCust1.id, versionCliente: cashCust1.version,
    versionConfiguracion: ncfSnap1.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: pNcf1.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pNcf1.version }],
  });
  assert.equal(sNcf1.state.facturas.find(f => f.id === sNcf1.result.id).ncf, 'B0200000001');

  const pNcf2 = sNcf1.state.productos[0];
  const cashCust2 = sNcf1.state.clientes.find(c => c.esContado);
  const sNcf2 = await write('POST', '/api/ventas', {
    cajaId: cashId, clienteId: cashCust2.id, versionCliente: cashCust2.version,
    versionConfiguracion: sNcf1.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: pNcf2.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pNcf2.version }],
  });
  assert.equal(sNcf2.state.facturas.find(f => f.id === sNcf2.result.id).ncf, 'B0200000002');

  // Secuencia agotada -> 409
  const pNcf3 = sNcf2.state.productos[0];
  const cashCust3 = sNcf2.state.clientes.find(c => c.esContado);
  await assert.rejects(
    write('POST', '/api/ventas', {
      cajaId: cashId, clienteId: cashCust3.id, versionCliente: cashCust3.version,
      versionConfiguracion: sNcf2.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
      items: [{ productoId: pNcf3.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pNcf3.version }],
    }),
    err => err.status === 409,
  );

  // Desactivar secuencia -> vuelve a emitir sin NCF
  const seqB02 = sNcf2.state.secuenciasNcf.find(s => s.tipo === 'B02');
  await write('PUT', '/api/ncf', {
    tipo: 'B02', inicio: 1, fin: 2, actual: seqB02.actual, vencimiento: '2030-12-31', activa: false, version: seqB02.version,
  });

  // 7. Meta diaria configurable
  const beforeCfg = await readSnapshot(pool, 'Prueba');
  const updatedCfg = await write('PUT', '/api/configuracion', {
    version: beforeCfg.state.configuracionVersion,
    metaDiaria: 15000,
  });
  assert.equal(updatedCfg.state.configuracion.metaDiaria, 15000);

  // 8. Respaldo relacional v8 y restauración completa en base desechable
  const exported = await readSnapshot(pool, 'Prueba', true);
  assert.equal(exported.version, 8);
  assert.equal(exported.tables.productos_codigos.length, 2);
  assert.equal(exported.tables.abonos_cuentas.length, 2);
  assert.equal(exported.tables.secuencias_ncf.length, 1);

  const db2 = await temporaryPostgres();
  const pool2 = new pg.Pool({ connectionString: db2.connectionString });
  t.after(async () => { await pool2.end(); await db2.stop(); });
  await migrateDatabase(pool2);
  const init2 = await readSnapshot(pool2, 'Restaurada');
  await writeOperation(pool2, 'POST', '/api/restore', { databaseId: init2.databaseId, revision: init2.revision, backup: exported }, randomUUID(), 'Restaurada', actor);
  const restored = await readSnapshot(pool2, 'Restaurada');
  assert.deepEqual(restored.state.productos[0].codigosAlternativos, ['7460012345678', '000ALT1']);
  assert.equal(restored.state.abonos.length, 2);
  assert.equal(restored.state.configuracion.metaDiaria, 15000);
  assert.equal(restored.state.facturas.filter(f => f.estado === 'anulada').length, 2);
  assert.equal(restored.state.caja.summary.expected, 1500);
});

test('roles en servidor HTTP: cajero solo opera mostrador y no ve costos ni rutas de dueño', { timeout: 120000 }, async t => {
  const database = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: database.connectionString });
  const auth = await testAuthService({ role: 'cajero' });
  t.after(async () => { await auth.close(); await pool.end(); await database.stop(); });
  await migrateDatabase(pool);
  const snap = await readSnapshot(pool, 'Prueba');
  await writeOperation(pool, 'POST', '/api/productos', {
    databaseId: snap.databaseId, codigo: 'CAD-1', nombre: 'Cadena 428H', costo: '350', precio1: '650', precio2: '600', precio3: '550', stock: '10',
  }, randomUUID(), 'Prueba', actor);

  const origin = 'https://pos.example';
  const hosting = hostingConfig({ ...auth.env, PUBLIC_ORIGIN: origin });
  const call = (path, { method = 'GET', body, cookie = '' } = {}) =>
    handleRequest(new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        'X-Forwarded-Proto': 'https',
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...(method !== 'GET' ? { 'Idempotency-Key': randomUUID() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }), { hosting, pool, readAsset: () => 'asset' });

  const login = await call('/login', { method: 'POST', body: { username: 'felix', password: 'clave-navegador-sintetica-12345' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const accountRes = await call('/api/account', { cookie });
  assert.equal((await accountRes.json()).role, 'cajero');

  // Estado redactado para cajero: costo oculto (0) y compras vacías
  const stateRes = await call('/api/state', { cookie });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.state.productos[0].costo, 0);
  assert.equal(stateBody.state.productos[0].costoExacto, '0.0000');
  assert.deepEqual(stateBody.state.compras, []);

  // Operaciones bloqueadas con 403
  for (const [method, path, body] of [
    ['POST', '/api/productos', { databaseId: snap.databaseId, codigo: 'NO-1', nombre: 'No', costo: '1', precio1: '2', precio2: 0, precio3: 0, stock: '1' }],
    ['POST', '/api/compras', { databaseId: snap.databaseId, suplidorId: 1, numero: 'X', items: [] }],
    ['POST', '/api/suplidores', { databaseId: snap.databaseId, nombre: 'No' }],
    ['PUT', '/api/configuracion', { databaseId: snap.databaseId, version: 1, metaDiaria: 100 }],
    ['PUT', '/api/ncf', { databaseId: snap.databaseId, tipo: 'B02', inicio: 1, fin: 10, actual: 1, vencimiento: '2030-01-01', activa: true }],
    ['POST', '/api/ventas/1/anular', { databaseId: snap.databaseId, version: 1, motivo: 'No' }],
    ['POST', '/api/cuentas/pagos', { databaseId: snap.databaseId, compraId: 1, version: 1, monto: 10, metodoPago: 'transferencia' }],
    ['GET', '/api/backup', undefined],
  ]) {
    const res = await call(path, { method, body, cookie });
    assert.equal(res.status, 403, `${method} ${path} debe devolver 403 para cajero`);
  }

  // Operaciones permitidas para cajero: abrir caja, crear cliente, vender con respuesta delta redactada
  const openCash = await call('/api/caja/abrir', { method: 'POST', body: { databaseId: snap.databaseId, monto: '500' }, cookie });
  assert.equal(openCash.status, 200);
  const newCustomer = await call('/api/clientes', { method: 'POST', body: { databaseId: snap.databaseId, nombre: 'Cliente Cajero', rnc: '', tel: '' }, cookie });
  assert.equal(newCustomer.status, 200);

  const beforeDelta = await (await call('/api/state', { cookie })).json();
  const prodDelta = beforeDelta.state.productos[0];
  const cashCustDelta = beforeDelta.state.clientes.find(c => c.esContado);
  const deltaSaleRes = await handleRequest(new Request(origin + '/api/ventas', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
      Cookie: cookie,
      'Idempotency-Key': randomUUID(),
      'X-Felix-Delta': String(beforeDelta.revision),
    },
    body: JSON.stringify({
      databaseId: snap.databaseId,
      cajaId: beforeDelta.state.caja.session.id,
      clienteId: cashCustDelta.id,
      versionConfiguracion: beforeDelta.state.configuracionVersion,
      condicion: 'Contado',
      tipoComprobante: 'B02',
      metodoPago: 'efectivo',
      items: [{ productoId: prodDelta.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: prodDelta.version }],
    }),
  }), { hosting, pool, readAsset: () => 'asset' });
  assert.equal(deltaSaleRes.status, 200);
  const deltaBody = await deltaSaleRes.json();
  assert.equal(deltaBody.delta, true);
  assert.equal(deltaBody.baseRevision, beforeDelta.revision);
  assert.equal(deltaBody.revision, beforeDelta.revision + 1);
  assert.equal(deltaBody.changes.productosUpsert.length, 1);
  assert.equal(deltaBody.changes.productosUpsert[0].costo, 0, 'Delta debe redactar costo para cajero');
  assert.equal(deltaBody.changes.productosUpsert[0].stock, 9);
  assert.equal(deltaBody.changes.facturasUpsert.length, 1);
  assert.equal(deltaBody.state, undefined);

  // Si X-Felix-Delta viene desactualizado (otro equipo escribió antes), el servidor devuelve snapshot completo
  const staleDeltaRes = await handleRequest(new Request(origin + '/api/clientes', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
      Cookie: cookie,
      'Idempotency-Key': randomUUID(),
      'X-Felix-Delta': '0',
    },
    body: JSON.stringify({ databaseId: snap.databaseId, nombre: 'Cliente Fallback', rnc: '', tel: '' }),
  }), { hosting, pool, readAsset: () => 'asset' });
  assert.equal(staleDeltaRes.status, 200);
  const staleBody = await staleDeltaRes.json();
  assert.equal(staleBody.delta, undefined);
  assert.ok(Array.isArray(staleBody.state.productos));
});

test('Windows offline SQLite: códigos alternativos, descuento, anulación y abono sincronizan sin NCF offline ni duplicados', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'felix-desktop-v7-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  let engine;
  t.after(async () => { await engine?.close(); await cloud.end(); await database.stop(); await rm(directory, { recursive: true, force: true }); });
  await migrateDatabase(cloud);

  // Configurar secuencia NCF activa en la nube para comprobar que Windows offline NUNCA emite NCF
  const cloudInit = await readSnapshot(cloud, 'Nube');
  await writeOperation(cloud, 'PUT', '/api/ncf', {
    databaseId: cloudInit.databaseId, tipo: 'B02', inicio: 1, fin: 100, actual: 1, vencimiento: '2030-12-31', activa: true,
  }, randomUUID(), 'Nube', actor);

  const remote = (path, options) => path === '/api/sync/bootstrap'
    ? readSyncBootstrap(cloud, 'Nube')
    : writeSyncOperation(cloud, options.body, 'Nube', actor);
  engine = new DesktopEngine(new DesktopLedger(directory));
  await engine.adopt(await remote('/api/sync/bootstrap'));
  const databaseId = engine.ledger.get('databaseId');
  const write = (method, path, body, key = randomUUID()) => engine.write(method, path, { databaseId, ...body }, key, actor);

  const cash = await write('POST', '/api/caja/abrir', { monto: '500' });
  const prod = await write('POST', '/api/productos', {
    codigo: 'OFF-1', codigosAlternativos: ['7460009998887'], nombre: 'Bujía NGK', costo: '80', precio1: '150', precio2: '140', precio3: '130', stock: '10',
  });
  const cust = await write('POST', '/api/clientes', { nombre: 'Cliente Offline', limiteCredito: '2000' });
  const localSnap = await engine.snapshot();
  const cCash = localSnap.state.clientes.find(c => c.esContado);
  const cCred = localSnap.state.clientes.find(c => c.id === cust.result.id);
  const pLocal = localSnap.state.productos[0];

  // Venta en efectivo con 10 % de descuento offline -> ncf === null
  const sCash = await write('POST', '/api/ventas', {
    cajaId: cash.result.id, clienteId: cCash.id, versionCliente: cCash.version,
    versionConfiguracion: localSnap.state.configuracionVersion, condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    descuentoPorcentaje: 10,
    items: [{ productoId: pLocal.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: pLocal.version }],
  });
  assert.equal(sCash.state.facturas.find(f => f.id === sCash.result.id).ncf, null);
  assert.equal(sCash.state.facturas.find(f => f.id === sCash.result.id).total, 270);

  // Venta a crédito + abono offline
  const pAfter1 = sCash.state.productos[0];
  const sCred = await write('POST', '/api/ventas', {
    cajaId: cash.result.id,
    clienteId: cCred.id, versionCliente: cCred.version, versionConfiguracion: sCash.state.configuracionVersion,
    condicion: 'Credito', metodoPago: 'credito', tipoComprobante: 'B02', vencimiento: '2030-10-10',
    items: [{ productoId: pAfter1.id, cantidad: '2', nivelPrecio: 'precio1', versionProducto: pAfter1.version }],
  });
  const fCred = sCred.state.facturas.find(f => f.id === sCred.result.id);
  await write('POST', '/api/cuentas/cobros', {
    ventaId: fCred.id, version: fCred.version, monto: '100', metodoPago: 'efectivo', cajaId: cash.result.id, nota: 'Cobro offline',
  });

  // Anular la venta en efectivo offline
  const fCashBeforeVoid = (await engine.snapshot()).state.facturas.find(f => f.id === sCash.result.id);
  await write('POST', `/api/ventas/${fCashBeforeVoid.id}/anular`, { version: fCashBeforeVoid.version, motivo: 'Anulación offline' });

  // Cerrar y reabrir SQLite para comprobar persistencia offline antes de sincronizar
  await engine.close();
  engine = new DesktopEngine(new DesktopLedger(directory));
  await engine.rebuild();
  assert.equal(engine.status().pending, 7);

  // Sincronizar con la nube
  await engine.synchronize(remote, actor);
  assert.equal(engine.status().pending, 0, JSON.stringify(engine.status()));

  const cloudAfter = await readSnapshot(cloud, 'Nube');
  assert.equal(cloudAfter.state.productos[0].stock, 8);
  assert.deepEqual(cloudAfter.state.productos[0].codigosAlternativos, ['7460009998887']);
  assert.equal(cloudAfter.state.facturas.length, 2);
  assert.equal(cloudAfter.state.facturas.filter(f => f.ncf !== null).length, 0, 'Ninguna venta sincronizada desde offline debe emitir NCF');
  assert.equal(cloudAfter.state.facturas.filter(f => f.estado === 'anulada').length, 1);
  assert.equal(cloudAfter.state.abonos.length, 1);
  assert.equal(cloudAfter.state.caja.summary.expected, 600);
});

test('E2E navegador: Ctrl K, notificaciones, códigos alternativos, espera, cotización, descuento, abonos, anulación, NCF, meta diaria y rol cajero', { timeout: 180000 }, async t => {
  let database, pool, server, browser, directory, authCashier, cashierServer;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const init = await readSnapshot(pool, 'Prueba');
    await writeOperation(pool, 'POST', '/api/clientes', {
      databaseId: init.databaseId, nombre: 'Taller Moto Feliz', rnc: '131000099', tel: '809-555-2222', limiteCredito: '10000',
    }, randomUUID(), 'Prueba', actor);
    await writeOperation(pool, 'POST', '/api/suplidores', {
      databaseId: init.databaseId, nombre: 'Suplidor Norte', rnc: '101000088', diasCredito: 30,
    }, randomUUID(), 'Prueba', actor);

    directory = await mkdtemp(join(tmpdir(), 'felix-pos-completo-'));
    await buildOperational(directory);
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + sep) });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;

    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // 1. Crear producto con código alternativo en Inventario
    await page.goto(origin + '/inventario');
    await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Código', { exact: true }).fill('PAS-900');
    await sheet.getByLabel('Descripción').fill('Pastilla de freno delantera');
    await sheet.getByLabel('Marca').fill('Brembo');
    await sheet.getByLabel('Existencia').fill('15');
    await sheet.getByLabel('Mínimo').fill('5');
    await sheet.getByLabel('Costo base RD$').fill('300');
    await sheet.getByLabel(/Precio 1/).fill('500');
    await sheet.getByLabel(/Precio 2/).fill('450');
    await sheet.getByLabel(/Precio 3/).fill('400');
    await sheet.getByLabel('Códigos de barras alternativos').fill('7469988776655');
    await sheet.getByRole('button', { name: 'Agregar', exact: true }).click();
    await sheet.getByText('7469988776655').waitFor();
    await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });

    // 2. Búsqueda global (Ctrl K) y Notificaciones
    await page.keyboard.press('Control+k');
    const globalSearch = page.getByLabel('Buscar en el sistema');
    await globalSearch.fill('7469988776655');
    await page.getByRole('option', { name: /Pastilla de freno delantera/ }).waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Notificaciones' }).click();
    const notifDialog = page.getByRole('dialog');
    await notifDialog.getByText('Notificaciones').waitFor();
    await notifDialog.getByText('Caja cerrada').waitFor();
    await page.keyboard.press('Escape');

    // 3. Abrir caja
    await page.goto(origin + '/caja');
    await page.getByLabel('Fondo inicial').fill('2000');
    await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
    await page.getByText('Efectivo esperado en caja').waitFor();

    // 4. Punto de venta: buscar por código alternativo, En espera, Cotización y Descuento 10%
    await page.goto(origin + '/ventas');
    const posSearch = page.getByLabel('Código o nombre del producto');
    await posSearch.fill('7469988776655');
    await posSearch.press('Enter');
    await page.getByText('Pastilla de freno delantera').first().waitFor();

    // En espera (con nombre opcional vacío) y retomar desde el modal
    await page.getByRole('button', { name: /En espera/ }).click();
    await page.getByRole('button', { name: 'Poner venta actual en espera' }).click();
    await page.getByRole('button', { name: /En espera.*1/ }).waitFor();
    await page.getByRole('button', { name: /En espera/ }).click();
    await page.getByRole('button', { name: 'Retomar' }).click();
    await page.getByText('Pastilla de freno delantera').first().waitFor();

    // Cotización (no modifica stock)
    await page.getByRole('button', { name: 'Cotización' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Cotización' }).waitFor();
    await page.keyboard.press('Escape');

    // Aplicar descuento libre: probar monto fijo RD$ 75 (500 -> 425) y luego porcentaje libre 20% (500 -> 400)
    await page.getByRole('button', { name: 'Descuento en pesos' }).click();
    const customDiscount = page.getByLabel('Descuento personalizado');
    await customDiscount.fill('75');
    await page.getByText('425').first().waitFor();
    await page.getByRole('button', { name: 'Descuento en porcentaje' }).click();
    await customDiscount.fill('20');
    await page.getByText('400').first().waitFor();
    await page.getByRole('button', { name: 'Exacto', exact: true }).click();
    // Demorar brevemente POST /api/ventas para verificar respuesta delta y que NO aparezca el falso aviso "Solicitud pendiente"
    let sawPendingBannerDuringSend = false;
    let deltaResponseSeen = false;
    await page.route('**/api/ventas', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 350));
        sawPendingBannerDuringSend = (await page.getByText(/Solicitud pendiente de confirmación|Hay una solicitud pendiente/).count()) > 0;
        const response = await route.fetch();
        const body = await response.json();
        deltaResponseSeen = body?.delta === true;
        await route.fulfill({ response, json: body });
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: /Registrar venta/ }).click();
    await page.getByRole('dialog').getByText(/Registro /).first().waitFor();
    await page.unroute('**/api/ventas');
    assert.equal(sawPendingBannerDuringSend, false, 'No debe mostrarse el aviso de pendiente durante un envío normal');
    assert.equal(deltaResponseSeen, true, 'POST /api/ventas debe confirmar con respuesta compacta delta');
    await page.keyboard.press('Escape');

    // 5. Venta a crédito y cobro en Cuentas x cobrar
    await posSearch.fill('PAS-900');
    await posSearch.press('Enter');
    await page.getByRole('combobox', { name: 'Cliente' }).click();
    await page.getByRole('option', { name: 'Taller Moto Feliz' }).click();
    await page.getByRole('combobox', { name: 'Condición' }).click();
    await page.getByRole('option', { name: 'Crédito' }).click();
    await page.getByRole('button', { name: /Registrar venta/ }).click();
    await page.getByRole('dialog').getByText(/Registro /).first().waitFor();
    await page.keyboard.press('Escape');

    await page.goto(origin + '/cuentas-por-cobrar');
    await page.getByText('Taller Moto Feliz').first().waitFor();
    await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
    const payDlg = page.getByRole('dialog');
    await payDlg.getByRole('button', { name: '50%' }).click();
    await payDlg.getByRole('button', { name: /Cobrar RD\$/ }).click();
    await payDlg.waitFor({ state: 'hidden' });

    // 6. Compra a crédito y pago en Cuentas x pagar
    await page.goto(origin + '/compras');
    await page.getByRole('combobox', { name: 'Suplidor' }).click();
    await page.getByRole('option', { name: 'Suplidor Norte' }).click();
    await page.getByLabel('No. factura del suplidor').fill('COMP-CR-1');
    await page.getByRole('combobox', { name: 'Condición' }).click();
    await page.getByRole('option', { name: 'A crédito' }).click();
    await page.getByLabel('Código').fill('PAS-900');
    await page.getByLabel('Cantidad').fill('2');
    await page.getByLabel('Costo unitario').fill('300');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    await page.getByRole('button', { name: 'Subir factura al inventario' }).click();
    await page.getByText('COMP-CR-1', { exact: true }).waitFor();

    await page.goto(origin + '/cuentas-por-pagar');
    await page.getByText('COMP-CR-1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const paySupDlg = page.getByRole('dialog');
    await paySupDlg.getByRole('button', { name: /Pagar RD\$/ }).click();
    await paySupDlg.waitFor({ state: 'hidden' });

    // 7. Anular la venta en efectivo en Reportes
    await page.goto(origin + '/reportes');
    await page.getByRole('button', { name: 'Anular' }).last().click();
    const voidDlg = page.getByRole('dialog');
    await voidDlg.getByLabel('Motivo de anulación').fill('Error de mostrador');
    await voidDlg.getByRole('button', { name: 'Anular factura' }).click();
    await voidDlg.waitFor({ state: 'hidden' });
    await page.getByText('Error de mostrador').waitFor();

    // 8. Configurar NCF real B02 y Meta diaria en Configuración -> verificar Dashboard y Ventas
    await page.goto(origin + '/configuracion');
    await page.getByRole('tab', { name: 'Comprobantes NCF' }).click();
    await page.locator('#ncf-B02-start').fill('1');
    await page.locator('#ncf-B02-end').fill('500');
    await page.locator('#ncf-B02-expires').fill('2030-12-31');
    await page.getByRole('switch', { name: 'Activar secuencia B02' }).click();
    await page.getByRole('button', { name: 'Guardar' }).nth(1).click();
    await page.getByText(/Siguiente: B0200000001/).waitFor();

    await page.getByRole('tab', { name: 'Facturación' }).click();
    await page.locator('#billing-daily-goal').fill('5000');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.waitForTimeout(300);

    // Capturas de evidencia visual (escritorio 1440px claro/oscuro y móvil 390px claro/oscuro)
    await mkdir(verifyDir, { recursive: true });
    await page.goto(origin + '/');
    await page.getByText('RD$ 5,000.00').first().waitFor();
    await page.screenshot({ path: join(verifyDir, 'desktop-1440-dashboard-light.png'), fullPage: true });
    await page.goto(origin + '/ventas');
    await page.getByText('B0200000001', { exact: true }).waitFor();
    await page.screenshot({ path: join(verifyDir, 'desktop-1440-ventas-light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cambiar tema' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(verifyDir, 'desktop-1440-ventas-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '390px dark ventas overflow');
    await page.screenshot({ path: join(verifyDir, 'mobile-390-ventas-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cambiar tema' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(verifyDir, 'mobile-390-ventas-light.png'), fullPage: true });

    // 9. Verificar UI restringida para rol Cajero
    authCashier = await testAuthService({ role: 'cajero' });
    const cashierHosting = hostingConfig({ ...authCashier.env });
    cashierServer = await createApp(pool, { assetsDirectory: pathToFileURL(directory + sep), hosting: cashierHosting });
    await new Promise(done => cashierServer.listen(0, '127.0.0.1', done));
    const cashierOrigin = 'http://127.0.0.1:' + cashierServer.address().port;
    const cashierContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cPage = await cashierContext.newPage();
    cPage.on('pageerror', err => errors.push(err.message));
    await cPage.goto(cashierOrigin + '/login');
    await cPage.getByLabel('Usuario').fill('felix');
    await cPage.getByLabel('Contraseña', { exact: true }).fill('clave-navegador-sintetica-12345');
    await cPage.getByRole('button', { name: /Entrar|Iniciar sesión/ }).click();
    await cPage.waitForURL(url => !url.pathname.startsWith('/login'));
    await cPage.goto(cashierOrigin + '/inventario');
    await cPage.getByText('Pastilla de freno delantera').waitFor();
    assert.equal(await cPage.getByRole('button', { name: 'Nuevo artículo' }).count(), 0);
    assert.equal(await cPage.getByRole('columnheader', { name: 'Costo' }).count(), 0);
    assert.equal(await cPage.getByRole('link', { name: 'Reportes' }).count(), 0);
    await cPage.goto(cashierOrigin + '/reportes');
    await cPage.getByText('Esta sección solo está disponible para el dueño del negocio.').waitFor();
    await cPage.goto(cashierOrigin + '/configuracion');
    await cPage.getByText('Rol: Cajero').waitFor();
    assert.equal(await cPage.getByRole('tab', { name: 'Negocio' }).count(), 0);
    await cashierContext.close();

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (cashierServer) await new Promise(done => cashierServer.close(done));
    await authCashier?.close();
    if (server) await new Promise(done => server.close(done));
    await pool?.end();
    await database?.stop();
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
