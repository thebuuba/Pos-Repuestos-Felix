import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { testAuthService } from './fixtures/supabase-auth.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';
import { buildOperational } from '../scripts/build-operational.mjs';

const ownerPassword = 'clave-navegador-sintetica-12345';

test('Suplidor con compra a crédito anulada puede eliminarse sin falso saldo pendiente', async () => {
  let database, pool;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const snap0 = await readSnapshot(pool, 'Test');
    const databaseId = snap0.databaseId;
    const actor = { id: 'fixture-user', name: 'felix', role: 'dueno' };

    const supRes = await writeOperation(pool, 'POST', '/api/suplidores', {
      databaseId, nombre: 'Suplidor Anulable', rnc: '131000099', tel: '8095550999', diasCredito: 30,
    }, randomUUID(), 'Test', actor);
    const supId = supRes.result.id;

    const buyRes = await writeOperation(pool, 'POST', '/api/compras', {
      databaseId, suplidorId: supId, numero: 'SUP-CRED-1', condicion: 'Credito',
      items: [{
        productoId: null, versionProducto: null, codigo: 'PIEZA-SUP-1', nombre: 'Pieza Suplidor',
        cantidad: '2', costo: '100', precio1: '180', precio2: '160', precio3: '150',
      }],
    }, randomUUID(), 'Test', actor);
    const purchaseId = buyRes.result.id;

    // Con compra a crédito activa, eliminar el suplidor debe fallar con 409
    const snap1 = await readSnapshot(pool, 'Test');
    const sup1 = snap1.state.suplidores.find(s => s.id === supId);
    await assert.rejects(
      writeOperation(pool, 'DELETE', `/api/suplidores/${supId}`, { databaseId, version: sup1.version }, randomUUID(), 'Test', actor),
      { status: 409 },
    );

    // Al anular la compra a crédito, el saldo pasa a 0 y ya permite eliminar el suplidor
    const purchase1 = snap1.state.compras.find(c => c.id === purchaseId);
    await writeOperation(pool, 'POST', `/api/compras/${purchaseId}/anular`, {
      databaseId, version: purchase1.version, motivo: 'Factura cargada por error',
    }, randomUUID(), 'Test', actor);

    const snap2 = await readSnapshot(pool, 'Test');
    const sup2 = snap2.state.suplidores.find(s => s.id === supId);
    assert.equal(sup2.deuda, 0);
    await writeOperation(pool, 'DELETE', `/api/suplidores/${supId}`, { databaseId, version: sup2.version }, randomUUID(), 'Test', actor);

    const snap3 = await readSnapshot(pool, 'Test');
    assert.equal(snap3.state.suplidores.some(s => s.id === supId), false);
  } finally {
    await pool?.end();
    await database?.stop();
  }
});

test('E2E CxC y CxP: historial de abonos, recibo imprimible de cobro/pago y factura de compra en CxP', { timeout: 180000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const snap0 = await readSnapshot(pool, 'Test');
    const databaseId = snap0.databaseId;
    const actor = { id: 'fixture-user', name: 'felix', role: 'dueno' };

    const custRes = await writeOperation(pool, 'POST', '/api/clientes', {
      databaseId, nombre: 'Taller Crédito Historia', rnc: '131000022', tel: '8095550122', limiteCredito: 50000,
    }, randomUUID(), 'Test', actor);
    const supRes = await writeOperation(pool, 'POST', '/api/suplidores', {
      databaseId, nombre: 'Distribuidora Moto CxP', rnc: '131000033', tel: '8095550133', diasCredito: 30,
    }, randomUUID(), 'Test', actor);
    const cashRes = await writeOperation(pool, 'POST', '/api/caja/abrir', {
      databaseId, monto: 5000,
    }, randomUUID(), 'Test', actor);

    // Compra a crédito (también crea el producto en inventario)
    await writeOperation(pool, 'POST', '/api/compras', {
      databaseId, suplidorId: supRes.result.id, numero: 'COMP-CXP-1', condicion: 'Credito',
      items: [{
        productoId: null, versionProducto: null, codigo: 'CAD-520', nombre: 'Cadena 520 Reforzada',
        cantidad: '10', costo: '200', precio1: '400', precio2: '360', precio3: '320',
      }],
    }, randomUUID(), 'Test', actor);

    // Venta a crédito
    const snap1 = await readSnapshot(pool, 'Test');
    const prod = snap1.state.productos.find(p => p.codigo === 'CAD-520');
    const cfgVer = snap1.state.configuracion.version;
    const saleRes = await writeOperation(pool, 'POST', '/api/ventas', {
      databaseId, clienteId: custRes.result.id, cajaId: cashRes.result.id, condicion: 'Credito',
      tipoComprobante: 'B02', metodoPago: 'credito', versionConfiguracion: cfgVer,
      items: [{ productoId: prod.id, versionProducto: prod.version, nivelPrecio: 'precio1', cantidad: '2' }],
    }, randomUUID(), 'Test', actor);
    const saleDoc = 'F-' + String(saleRes.result.id).padStart(6, '0');

    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-accounts-ui-'));
    await buildOperational(directory);
    server = await createApp(pool, {
      hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
      assetsDirectory: pathToFileURL(directory + sep),
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const appOrigin = 'http://127.0.0.1:' + server.address().port;

    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO' });
    const loginRes = await context.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'felix', password: ownerPassword },
    });
    assert.equal(loginRes.status(), 200);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls += 1; };
    });

    const evidence = resolve('dist/verification/cuentas');
    await mkdir(evidence, { recursive: true });

    // 1. Cuentas x cobrar: abono parcial -> ver historial -> imprimir recibo de abono
    await page.goto(appOrigin + '/cuentas-por-cobrar');
    await page.getByText('Taller Crédito Historia').first().waitFor();
    await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
    const payDlg = page.getByRole('dialog');
    await payDlg.getByRole('button', { name: '50%' }).click();
    await payDlg.getByPlaceholder('Ej. Recibo #123').fill('Primer abono mostrador');
    await payDlg.getByRole('button', { name: /Cobrar RD\$/ }).click();
    await payDlg.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: `Ver abonos de ${saleDoc}`, exact: true }).click();
    const historyDlg = page.getByRole('dialog');
    await historyDlg.getByText(/Historial de cobros/).waitFor();
    assert.match(await historyDlg.innerText(), /Cobro #1/);
    assert.match(await historyDlg.innerText(), /Primer abono mostrador/);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(evidence, 'abonos-1440-light.png'), fullPage: true });

    await historyDlg.getByRole('button', { name: 'Imprimir abono #1', exact: true }).click();
    const receiptDlg = page.getByRole('dialog');
    await receiptDlg.getByText('Recibo de cobro', { exact: true }).waitFor();
    await receiptDlg.getByText('— RECIBO DE ABONO —', { exact: true }).waitFor();
    assert.match(await receiptDlg.innerText(), /AB-\d{6}/);
    assert.match(await receiptDlg.innerText(), /Taller Crédito Historia/);
    await receiptDlg.getByRole('button', { name: 'Imprimir', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidence, 'recibo-abono-390-dark.png'), fullPage: true });
    await receiptDlg.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await receiptDlg.waitFor({ state: 'hidden' });

    // 2. Cuentas x pagar: abrir factura de compra + registrar pago + ver historial de pagos
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.goto(appOrigin + '/cuentas-por-pagar');
    await page.getByText('COMP-CXP-1', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Ver factura COMP-CXP-1', exact: true }).click();
    const purchaseDlg = page.getByRole('dialog');
    await purchaseDlg.getByText(/Factura de compra COMP-CXP-1/).waitFor();
    assert.match(await purchaseDlg.innerText(), /Cadena 520 Reforzada/);
    await page.keyboard.press('Escape');
    await purchaseDlg.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const supPayDlg = page.getByRole('dialog');
    await supPayDlg.getByRole('button', { name: '50%' }).click();
    await supPayDlg.getByRole('button', { name: 'Transferencia', exact: true }).click();
    await supPayDlg.getByPlaceholder('Ej. Recibo #123').fill('Transf. #7788');
    await supPayDlg.getByRole('button', { name: /Pagar RD\$/ }).click();
    await supPayDlg.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Ver abonos de COMP-CXP-1', exact: true }).click();
    const supHistDlg = page.getByRole('dialog');
    await supHistDlg.getByText(/Historial de pagos/).waitFor();
    assert.match(await supHistDlg.innerText(), /Pago #1/);
    assert.match(await supHistDlg.innerText(), /Transf\. #7788/);
    await supHistDlg.getByRole('button', { name: 'Imprimir abono #1', exact: true }).click();
    await page.getByRole('dialog').getByText('Comprobante de pago', { exact: true }).waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    await auth?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    await pool?.end();
    await database?.stop();
  }
});
