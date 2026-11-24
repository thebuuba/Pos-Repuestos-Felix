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

function isoShiftDays(delta) {
  const now = new Date();
  const shifted = new Date(now.getTime() + delta * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

test('E2E Centro de Notificaciones Inteligentes: reglas reales, Alt+A, filtros, posponer, CxC vencidas, post-venta, móvil y rol Cajero', { timeout: 180000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const snap0 = await readSnapshot(pool, 'Test');
    const databaseId = snap0.databaseId;
    const actor = { id: 'fixture-user', name: 'felix', role: 'dueno' };

    // 1. Sembrar productos:
    // - BUJ-HOT: stock 63, luego vendemos 60 -> quedan 3 con ritmo 2/día (~1.5 días -> quiebre inminente crítico)
    // - ACE-LOSS: costo 400, precio1 350 -> precio <= costo (solo dueño)
    // - PAS-LOW: stock 2, minimo 5 -> al vender 2 en la prueba salta toast post-venta "Se agotó"
    const pHot = await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'BUJ-HOT', nombre: 'Bujía Alta Rotación', marca: 'NGK',
      ubicacion: 'A-1', stock: 63, stockMinimo: 2, costo: 80, precio1: 150, precio2: 140, precio3: 130, gravado: true,
    }, randomUUID(), 'Test', actor);
    await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'ACE-LOSS', nombre: 'Aceite Margen Negativo', marca: 'Motul',
      ubicacion: 'B-1', stock: 12, stockMinimo: 2, costo: 400, precio1: 350, precio2: 340, precio3: 330, gravado: true,
    }, randomUUID(), 'Test', actor);
    await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'PAS-LOW', nombre: 'Pastilla Crítica', marca: 'Brembo',
      ubicacion: 'C-1', stock: 2, stockMinimo: 5, costo: 150, precio1: 300, precio2: 280, precio3: 260, gravado: true,
    }, randomUUID(), 'Test', actor);

    // 2. Sembrar cliente con límite de crédito RD$ 10,000 y suplidor a crédito
    const cust = await writeOperation(pool, 'POST', '/api/clientes', {
      databaseId, nombre: 'Taller El Primo', rnc: '131000111', tel: '8095550101', limiteCredito: 10000,
    }, randomUUID(), 'Test', actor);
    const supp = await writeOperation(pool, 'POST', '/api/suplidores', {
      databaseId, nombre: 'Importadora Cibao', rnc: '131000222', tel: '8095550202', contacto: 'Luis', diasCredito: 15,
    }, randomUUID(), 'Test', actor);

    // 3. Configurar NCF B01 por vencer en 7 días
    await writeOperation(pool, 'PUT', '/api/ncf', {
      databaseId, tipo: 'B01', inicio: 1, fin: 100, actual: 10, vencimiento: isoShiftDays(7), activa: true,
    }, randomUUID(), 'Test', actor);

    // 4. Abrir caja temporal, hacer venta a crédito de 60 bujías (RD$ 9,000 -> 90% del límite!) y cerrar caja
    const cash = await writeOperation(pool, 'POST', '/api/caja/abrir', {
      databaseId, monto: '1000',
    }, randomUUID(), 'Test', actor);
    const snapBeforeSale = await readSnapshot(pool, 'Test');
    const hotProduct = snapBeforeSale.state.productos.find(p => p.codigo === 'BUJ-HOT');
    const sale = await writeOperation(pool, 'POST', '/api/ventas', {
      databaseId,
      clienteId: cust.result.id,
      tipoComprobante: 'B02',
      condicion: 'Credito',
      metodoPago: 'credito',
      cajaId: cash.result.id,
      versionConfiguracion: snapBeforeSale.state.configuracion.version,
      items: [{ productoId: hotProduct.id, versionProducto: hotProduct.version, cantidad: '60', nivelPrecio: 'precio1' }],
    }, randomUUID(), 'Test', actor);

    // Registrar compra a crédito vencida hace 4 días en ACE-LOSS (no toca PAS-LOW)
    const lossProd = (await readSnapshot(pool, 'Test')).state.productos.find(p => p.codigo === 'ACE-LOSS');
    const validPurch = await writeOperation(pool, 'POST', '/api/compras', {
      databaseId,
      suplidorId: supp.result.id,
      numero: 'FAC-SUP-99',
      condicion: 'Credito',
      items: [{
        productoId: lossProd.id, versionProducto: lossProd.version,
        codigo: lossProd.codigo, nombre: lossProd.nombre, cantidad: '1',
        costo: '400', precio1: '350', precio2: '340', precio3: '330',
      }],
    }, randomUUID(), 'Test', actor);
    assert.ok(validPurch.result.id);

    // Simular paso del tiempo en BD desechable para vencimientos de CxC (-5 d) y CxP (-4 d)
    await pool.query('UPDATE ventas SET vencimiento = $1 WHERE id = $2', [isoShiftDays(-5), sale.result.id]);
    await pool.query('UPDATE compras SET vencimiento = $1 WHERE id = $2', [isoShiftDays(-4), validPurch.result.id]);

    // Cerrar caja para disparar también "Caja cerrada"
    const cashSnap = await readSnapshot(pool, 'Test');
    await writeOperation(pool, 'POST', '/api/caja/cerrar', {
      databaseId, cajaId: cashSnap.state.caja.session.id, version: cashSnap.state.caja.session.version, conteo: '1000',
    }, randomUUID(), 'Test', actor);

    // 5. Levantar servidor y Playwright
    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-notif-'));
    await buildOperational(directory);
    server = await createApp(pool, {
      hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
      assetsDirectory: pathToFileURL(directory + sep),
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const appOrigin = 'http://127.0.0.1:' + server.address().port;

    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO' });
    assert.equal((await ownerCtx.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'felix', password: ownerPassword },
    })).status(), 200);
    assert.equal((await ownerCtx.request.post(appOrigin + '/api/usuarios', {
      headers: { Origin: appOrigin },
      data: { username: 'cajeronotif', displayName: 'Cajero Notif', password: 'clave-cajero-123', role: 'cajero' },
    })).status(), 201);

    const page = await ownerCtx.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const evidence = resolve('dist/verification/notifications');
    await mkdir(evidence, { recursive: true });

    // A. Escritorio dueño: verificar badge numérico y abrir con Alt+A
    await page.goto(appOrigin + '/');
    await page.getByRole('heading', { name: 'Panel', exact: true }).waitFor();
    const bell = page.getByRole('button', { name: 'Notificaciones', exact: true });
    await bell.waitFor();
    const initialUnread = Number(await bell.getAttribute('data-unread-count'));
    assert.ok(initialUnread >= 6, `Se esperaban >= 6 alertas sin leer para dueño, obtuvo ${initialUnread}`);

    await page.keyboard.press('Alt+a');
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Notificaciones').waitFor();
    await dialog.locator('[data-alert-id="stock-velocity"]').waitFor();
    await dialog.locator('[data-alert-id="price-below-cost"]').waitFor();
    await dialog.locator('[data-alert-id="cxc-overdue"]').waitFor();
    await dialog.locator('[data-alert-id="cxp-overdue"]').waitFor();
    await dialog.locator('[data-alert-id="credit-limit"]').waitFor();
    await dialog.locator('[data-alert-id="ncf-exp-soon-B01"]').waitFor();
    await dialog.locator('[data-alert-id="cash-closed"]').waitFor();

    await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'desktop-light.png') });

    // B. Filtros por categoría (Críticas e Inventario)
    await dialog.getByRole('tab', { name: /Críticas/ }).click();
    assert.equal(await dialog.locator('[data-alert-id="cash-closed"]').count(), 0);
    assert.equal(await dialog.locator('[data-alert-id="cxc-overdue"]').count(), 1);
    await dialog.getByRole('tab', { name: /Todas/ }).click();

    // C. Posponer una alerta y luego reactivarla
    await dialog.locator('[data-alert-id="cash-closed"]').getByRole('button', { name: /Posponer/ }).click();
    assert.equal(await dialog.locator('[data-alert-id="cash-closed"]').count(), 0);
    await dialog.getByRole('button', { name: /Pospuestas hasta mañana \(1\)/ }).click();
    await dialog.getByRole('button', { name: /Reactivar/ }).click();
    await dialog.locator('[data-alert-id="cash-closed"]').waitFor();

    // D. Cerrar con Alt+A, cambiar a modo oscuro y capturar evidencia
    await page.keyboard.press('Alt+a');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
    await page.keyboard.press('Alt+a');
    await dialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'desktop-dark.png') });

    // E. Clic en "Ver vencidas" de CxC -> aterriza filtrado en /cuentas-por-cobrar?filtro=vencidas
    await dialog.locator('[data-alert-id="cxc-overdue"]').getByRole('button', { name: /Ver vencidas/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('Solo vencidas · Quitar filtro').waitFor();
    assert.match(page.url(), /\/cuentas-por-cobrar\?filtro=vencidas/);

    // F. Marcar todas como leídas -> badge baja a 0
    await page.keyboard.press('Alt+a');
    await dialog.getByRole('button', { name: /Marcar leídas/ }).click();
    await page.keyboard.press('Escape');
    assert.equal(Number(await bell.getAttribute('data-unread-count')), 0);

    // G. Móvil 390x844 (claro) y 320x568: campana visible en cabecera, sin scroll horizontal
    await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await bell.isVisible(), true, 'La campana debe verse en móvil 390px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await bell.click();
    await dialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(evidence, 'mobile-390-light.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    await page.setViewportSize({ width: 320, height: 568 });
    assert.equal(await bell.isVisible(), true, 'La campana debe verse en móvil 320px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    // H. Abrir caja y vender 2 unidades de PAS-LOW -> toast discreto post-venta "Se agotó: Pastilla Crítica"
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(appOrigin + '/caja');
    await page.getByLabel('Fondo inicial').fill('500');
    await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
    await page.getByText('Efectivo esperado en caja').waitFor();

    await page.goto(appOrigin + '/ventas');
    const search = page.getByLabel('Código o nombre del producto');
    await search.fill('PAS-LOW');
    await search.press('Enter');
    await search.fill('PAS-LOW');
    await search.press('Enter');
    await page.getByRole('button', { name: 'Exacto', exact: true }).click();
    await page.getByRole('button', { name: /Registrar venta/ }).click();
    await page.getByText(/Se agotó: Pastilla Crítica/).waitFor();
    await page.keyboard.press('Escape');

    // H2. Novedad en vivo desde otra sesión (Meta diaria alcanzada): sale toast con "Ver" sin robar el foco del buscador
    const searchInput = page.getByLabel('Código o nombre del producto');
    await searchInput.focus();
    const cfgSnap = await readSnapshot(pool, 'Test');
    await writeOperation(pool, 'PUT', '/api/configuracion', {
      databaseId, version: cfgSnap.state.configuracion.version, metaDiaria: '1000',
    }, randomUUID(), 'OtroEquipo', actor);
    await page.getByText(/Meta diaria alcanzada/).waitFor({ timeout: 10000 });
    const focusedAfterToast = await searchInput.evaluate((el) => document.activeElement === el);
    assert.equal(focusedAfterToast, true, 'El aviso en vivo nunca debe robar el foco del buscador en Ventas');

    // I. Sesión de Cajero: NO ve precio <= costo, CxP ni NCF; SÍ ve CxC y rotación
    const cashierCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
    assert.equal((await cashierCtx.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'cajeronotif', password: 'clave-cajero-123' },
    })).status(), 200);
    const cPage = await cashierCtx.newPage();
    cPage.on('pageerror', err => errors.push(err.message));
    await cPage.goto(appOrigin + '/ventas');
    await cPage.getByLabel('Código o nombre del producto').waitFor();
    await cPage.getByRole('button', { name: 'Notificaciones', exact: true }).click();
    const cDialog = cPage.getByRole('dialog');
    await cDialog.locator('[data-alert-id="stock-velocity"]').waitFor();
    await cDialog.locator('[data-alert-id="cxc-overdue"]').waitFor();
    assert.equal(await cDialog.locator('[data-alert-id="price-below-cost"]').count(), 0);
    assert.equal(await cDialog.locator('[data-alert-id="cxp-overdue"]').count(), 0);
    assert.equal(await cDialog.locator('[data-alert-id="ncf-exp-soon-B01"]').count(), 0);
    await cashierCtx.close();

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    if (directory) await rm(directory, { recursive: true, force: true });
    await pool?.end();
    await database?.stop();
    await auth?.close();
  }
});
