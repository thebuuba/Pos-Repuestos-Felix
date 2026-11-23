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

test('E2E reimpresión de facturas de venta: Ventas, Panel, Reportes, Cuentas x cobrar, factura anulada y rol Cajero', { timeout: 180000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const snap0 = await readSnapshot(pool, 'Test');
    const databaseId = snap0.databaseId;
    const actor = { id: 'fixture-user', name: 'felix', role: 'dueno' };

    // Crear producto, cliente con crédito y abrir caja
    const prodRes = await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'BUJ-REPRINT', nombre: 'Bujía NGK Reimpresión', marca: 'NGK',
      ubicacion: 'A-1', stock: 20, minimo: 2, costo: 120, precio1: 250, precio2: 225, precio3: 200, itbis: true,
    }, randomUUID(), 'Test', actor);
    const productId = prodRes.result.id;

    const custRes = await writeOperation(pool, 'POST', '/api/clientes', {
      databaseId, nombre: 'Taller Hermanos Crédito', rnc: '131000001', tel: '8095550101',
      direccion: 'Av. Duarte', limiteCredito: 25000,
    }, randomUUID(), 'Test', actor);
    const creditCustomerId = custRes.result.id;

    const cashRes = await writeOperation(pool, 'POST', '/api/caja/abrir', {
      databaseId, monto: 2000,
    }, randomUUID(), 'Test', actor);
    const cashId = cashRes.result.id;

    const snap1 = await readSnapshot(pool, 'Test');
    const cashCustomerId = snap1.state.clientes.find(c => c.esContado).id;
    const prod1 = snap1.state.productos.find(p => p.id === productId);
    const cfgVer = snap1.state.configuracion.version;

    // 1. Venta al contado
    const sale1Res = await writeOperation(pool, 'POST', '/api/ventas', {
      databaseId, clienteId: cashCustomerId, cajaId: cashId, condicion: 'Contado',
      tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: cfgVer,
      items: [{ productoId: productId, versionProducto: prod1.version, nivelPrecio: 'precio1', cantidad: '2' }],
    }, randomUUID(), 'Test', actor);
    const sale1Id = sale1Res.result.id;

    // 2. Venta a crédito
    const snap2 = await readSnapshot(pool, 'Test');
    const prod2 = snap2.state.productos.find(p => p.id === productId);
    const sale2Res = await writeOperation(pool, 'POST', '/api/ventas', {
      databaseId, clienteId: creditCustomerId, cajaId: cashId, condicion: 'Credito',
      tipoComprobante: 'B02', metodoPago: 'credito', versionConfiguracion: cfgVer,
      items: [{ productoId: productId, versionProducto: prod2.version, nivelPrecio: 'precio1', cantidad: '3' }],
    }, randomUUID(), 'Test', actor);
    const sale2Id = sale2Res.result.id;

    // 3. Venta al contado que luego anulamos
    const snap3 = await readSnapshot(pool, 'Test');
    const prod3 = snap3.state.productos.find(p => p.id === productId);
    const sale3Res = await writeOperation(pool, 'POST', '/api/ventas', {
      databaseId, clienteId: cashCustomerId, cajaId: cashId, condicion: 'Contado',
      tipoComprobante: 'B02', metodoPago: 'efectivo', versionConfiguracion: cfgVer,
      items: [{ productoId: productId, versionProducto: prod3.version, nivelPrecio: 'precio1', cantidad: '1' }],
    }, randomUUID(), 'Test', actor);
    const sale3Id = sale3Res.result.id;
    const sale3Ver = sale3Res.state.facturas.find(f => f.id === sale3Id).version;
    await writeOperation(pool, 'POST', `/api/ventas/${sale3Id}/anular`, {
      databaseId, version: sale3Ver, motivo: 'Cliente cambió de pieza',
    }, randomUUID(), 'Test', actor);

    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-reprint-'));
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

    // Crear también un cajero vía /api/usuarios para probar su acceso a reimpresión
    const createCashier = await context.request.post(appOrigin + '/api/usuarios', {
      headers: { Origin: appOrigin },
      data: { username: 'cajero1', displayName: 'Cajero Uno', password: 'clave-cajero-123', role: 'cajero' },
    });
    assert.equal(createCashier.status(), 201);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls += 1; };
    });

    const evidence = resolve('dist/verification/reprint');
    await mkdir(evidence, { recursive: true });

    // ① Punto de venta (/ventas): abrir Facturas recientes y reimprimir sin borrar borrador
    await page.goto(appOrigin + '/ventas');
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    const searchInput = page.getByLabel('Código o nombre del producto');
    await searchInput.fill('BUJ-REPRINT');
    await searchInput.press('Enter');
    await page.locator('.sale-cart tbody tr', { hasText: 'Bujía NGK Reimpresión' }).waitFor();

    await page.getByRole('button', { name: 'Facturas recientes y reimpresión', exact: true }).click();
    const historyDialog = page.getByRole('dialog');
    await historyDialog.getByText('Facturas recientes', { exact: true }).waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(evidence, 'ventas-history-1440-light.png'), fullPage: true });
    await historyDialog.getByRole('button', { name: `Reimprimir Registro ${sale1Id}`, exact: true }).click();

    const receiptDialog = page.getByRole('dialog');
    await receiptDialog.getByText('Factura de venta', { exact: true }).waitFor();
    await receiptDialog.getByText('— Reimpresión —', { exact: true }).waitFor();
    assert.match(await receiptDialog.innerText(), /Bujía NGK Reimpresión/);
    await page.screenshot({ path: join(evidence, 'ventas-reprint-1440-light.png'), fullPage: true });

    await receiptDialog.getByRole('button', { name: 'Reimprimir', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1);
    await receiptDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await receiptDialog.waitFor({ state: 'hidden' });
    // El borrador actual sigue intacto después de reimprimir otra factura
    assert.equal(await page.locator('.sale-cart tbody tr', { hasText: 'Bujía NGK Reimpresión' }).count(), 1);

    // ② Panel (/): reimprimir desde Ventas recientes
    await page.goto(appOrigin + '/');
    await page.getByRole('heading', { name: 'Ventas recientes', exact: true }).waitFor();
    await page.getByRole('button', { name: `Reimprimir Registro ${sale1Id}`, exact: true }).click();
    const panelReceipt = page.getByRole('dialog');
    await panelReceipt.getByText('Factura de venta', { exact: true }).waitFor();
    await panelReceipt.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await panelReceipt.waitFor({ state: 'hidden' });

    // ③ Reportes (/reportes): reimprimir factura anulada mostrando sello FACTURA ANULADA y motivo
    await page.goto(appOrigin + '/reportes');
    await page.getByRole('heading', { name: 'Facturas del período', exact: true }).waitFor();
    await page.getByRole('button', { name: `Reimprimir Registro ${sale3Id}`, exact: true }).click();
    const voidReceipt = page.getByRole('dialog');
    await voidReceipt.getByText('Factura anulada', { exact: true }).waitFor();
    await voidReceipt.getByText('*** FACTURA ANULADA ***', { exact: true }).waitFor();
    assert.match(await voidReceipt.innerText(), /Cliente cambió de pieza/);
    await voidReceipt.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await voidReceipt.waitFor({ state: 'hidden' });

    // ④ Cuentas x cobrar (/cuentas-por-cobrar): reimprimir factura a crédito
    await page.goto(appOrigin + '/cuentas-por-cobrar');
    await page.getByRole('heading', { name: 'Cuentas x cobrar', exact: true }).waitFor();
    await page.getByRole('button', { name: `Reimprimir Registro ${sale2Id}`, exact: true }).click();
    const creditReceipt = page.getByRole('dialog');
    await creditReceipt.getByText('Factura de venta', { exact: true }).waitFor();
    assert.match(await creditReceipt.innerText(), /Taller Hermanos Crédito/);
    assert.match(await creditReceipt.innerText(), /Crédito/);

    // Verificar móvil 390×844 oscuro sin desbordamiento
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(evidence, 'reprint-390-dark.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `Desbordamiento en 390px: ${overflow}px`);

    await context.close();

    // ⑤ Rol Cajero: puede reimprimir desde /ventas y Panel sin entrar a Reportes
    const cashierCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-DO' });
    const cashierLogin = await cashierCtx.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'cajero1', password: 'clave-cajero-123' },
    });
    assert.equal(cashierLogin.status(), 200);
    const cashierPage = await cashierCtx.newPage();
    cashierPage.on('pageerror', err => errors.push(err.message));

    await cashierPage.goto(appOrigin + '/ventas');
    await cashierPage.getByRole('button', { name: 'Facturas recientes y reimpresión', exact: true }).click();
    await cashierPage.getByRole('dialog').getByRole('button', { name: `Reimprimir Registro ${sale1Id}`, exact: true }).click();
    await cashierPage.getByRole('dialog').getByText('— Reimpresión —', { exact: true }).waitFor();
    await cashierPage.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();

    await cashierPage.goto(appOrigin + '/');
    await cashierPage.getByRole('button', { name: `Reimprimir Registro ${sale1Id}`, exact: true }).click();
    await cashierPage.getByRole('dialog').getByText('Factura de venta', { exact: true }).waitFor();
    await cashierCtx.close();

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
