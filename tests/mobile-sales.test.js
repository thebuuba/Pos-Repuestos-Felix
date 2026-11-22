import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium, webkit } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { observeScanAudio } from './fixtures/scan-audio.js';

test('venta corta en teléfono: cobro confirmado, más sin perder el carrito, refresco automático y escritorio conservado', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-mobile-sale-'));
  let database, pool, server, browser;
  try {
    await buildOperational(directory);
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const initial = await (await fetch(origin + '/api/state')).json();
    const write = async (route, payload) => {
      const response = await fetch(origin + route, { method: 'POST', headers: {
        Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
      }, body: JSON.stringify({ databaseId: initial.databaseId, ...payload }) });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    await write('/api/caja/abrir', { monto: '0.00' });
    await write('/api/productos', { codigo: 'MOVIL-01', nombre: 'Filtro de prueba móvil',
      costo: '1.0000', precio1: '10.1250', precio2: '9.0000', precio3: '8.0000', stock: 10, gravado: false });
    const evidence = path.resolve('dist/verification/mobile-simple');
    await mkdir(evidence, { recursive: true });
    for (const [engine, options, name] of [[chromium, { channel: 'msedge' }, 'chromium'], [webkit, {}, 'webkit']]) {
      browser = await engine.launch({ ...options, headless: true });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        locale: 'es-DO', reducedMotion: 'reduce' });
      await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/ventas');
      await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
      const audioAvailable = await observeScanAudio(page);
      assert.equal(await page.locator('aside').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Actualizar datos', exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('combobox', { name: 'Cliente', exact: true }).isVisible(), false);
      const search = page.getByLabel('Código o nombre del producto', { exact: true });
      assert.equal(await search.evaluate(element => getComputedStyle(element).fontSize), '16px');
      assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).touchAction), 'pan-x pan-y');
      if (name === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.synthesizePinchGesture', { x: 150, y: 300, scaleFactor: 1.8, gestureSourceType: 'touch' });
        assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'El gesto de pinza no amplía la PWA');
        await cdp.detach();
      }
      assert.ok((await page.getByRole('button', { name: /^Cobrar/ }).boundingBox()).y < 760, 'El cobro aparece en la primera pantalla');
      await page.getByRole('button', { name: /Datos de factura/ }).tap();
      await page.getByRole('combobox', { name: 'Cliente', exact: true }).waitFor();
      await page.getByRole('button', { name: /Datos de factura/ }).tap();
      await search.fill('Filtro');
      await page.getByRole('button').filter({ hasText: 'Filtro de prueba móvil' }).tap();
      const row = page.getByRole('row').filter({ hasText: 'Filtro de prueba móvil' });
      await row.waitFor();
      assert.equal(await row.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      await row.getByRole('button', { name: 'Sumar', exact: true }).tap();
      assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2');
      const focusRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/state');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await focusRead;
      assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2', 'Refrescar datos conserva el borrador');
      await page.getByRole('button', { name: 'Más', exact: true }).tap();
      await page.getByRole('dialog', { name: 'Más opciones' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2', 'Abrir Más conserva la venta');
      // A navigation must revalidate immediately, without relying on the five-second poll.
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      const stateRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/state');
      await page.getByRole('link', { name: 'Inventario', exact: true }).tap();
      await stateRead;
      await page.getByRole('link', { name: 'Ventas', exact: true }).tap();
      await search.fill('MOVIL-01'); await search.press('Enter');
      await row.waitFor();
      await page.clock.resume();
      await page.getByText('Agregado a la venta', { exact: true }).waitFor();
      if (audioAvailable) {
        await page.waitForFunction(() => window.scanAudio.peak > 0.01 && window.scanAudio.beeps[0]?.ended);
        assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 1);
      } else assert.equal(await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext)), 'undefined');
      await writeFile(path.join(evidence, `${name}-audio.json`), JSON.stringify({ engine: name,
        audioAPIAvailable: audioAvailable, realSignalVerified: audioAvailable, visualConfirmationVerified: true }, null, 2));
      await page.screenshot({ path: path.join(evidence, `${name}-confirmacion-escaner.png`), animations: 'disabled' });
      for (const [width, height] of [[320, 700], [390, 844], [844, 390]]) {
        await page.setViewportSize({ width, height });
        for (const dark of [false, true]) {
          if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== dark)
            await page.getByRole('button', { name: 'Cambiar tema' }).tap();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: path.join(evidence, `${name}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true, animations: 'disabled' });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: /^Cobrar/ }).tap();
      await page.getByRole('button', { name: 'Exacto', exact: true }).tap();
      assert.equal(await page.getByRole('spinbutton', { name: 'Monto recibido' }).inputValue(), '10.13');
      await page.screenshot({ path: path.join(evidence, `${name}-cobro.png`), animations: 'disabled' });
      await page.getByRole('button', { name: /Registrar venta/ }).tap();
      await page.getByRole('dialog').waitFor();
      const state = await (await fetch(origin + '/api/state')).json();
      assert.equal(state.state.facturas.length, name === 'chromium' ? 1 : 2);
      assert.equal(state.state.facturas.at(-1).total, 10.13);
      assert.equal(state.state.productos[0].stock, name === 'chromium' ? 9 : 8);
      assert.deepEqual(errors, []);
      // Same components at desktop width retain the full controls and unrestricted browser zoom.
      const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await desktop.goto(origin + '/ventas');
      await desktop.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
      assert.equal(await desktop.locator('aside').isVisible(), true);
      assert.equal(await desktop.getByRole('button', { name: 'Actualizar datos', exact: true }).isVisible(), true);
      assert.equal(await desktop.getByRole('combobox', { name: 'Cliente', exact: true }).isVisible(), true);
      assert.equal(await desktop.getByRole('button', { name: 'Tarjeta', exact: true }).isVisible(), true);
      assert.equal(await desktop.getByRole('button', { name: /Registrar venta/ }).isVisible(), true);
      assert.equal(await desktop.locator('html').evaluate(element => getComputedStyle(element).touchAction), 'auto');
      await browser.close(); browser = null;
    }
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await pool?.end(); await database?.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-mobile-sale-'));
    await rm(directory, { recursive: true, force: true });
  }
});
