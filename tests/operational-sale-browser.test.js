import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

async function verifyPrintLayout(page, width, letter = false) {
  const receipt = page.locator('.pos-receipt-document');
  const settledWidth = () => receipt.evaluate(async element => {
    const dialog = element.closest('[role="dialog"]');
    dialog.getBoundingClientRect();
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).map(animation => animation.finished));
    return element.getBoundingClientRect().width;
  });
  const screenWidth = await settledWidth();
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#root').isVisible(), false);
  const printWidth = await settledWidth();
  assert.ok(Math.abs(printWidth - width) < 1, 'Ancho impreso esperado ' + width + ', obtenido ' + printWidth);
  if (letter) {
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
    assert.match(pdf.toString('latin1'), /\/MediaBox\s*\[0 0 612 792\]/, 'Carta mide 8.5 × 11 pulgadas.');
  }
  await page.emulateMedia({ media: 'screen' });
  assert.equal(await settledWidth(), screenWidth);
}

test('el POS busca en 7681 productos y recupera una venta confirmada tras perder la respuesta', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-sale-browser-'));
  let database, admin, pool, browser, server;
  try {
    database = await temporaryPostgres();
    admin = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(admin);
    await admin.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock,gravado)
      SELECT 'SINT-' || i,'Artículo sintético ' || i,1,10.0030,9,8,3,true FROM generate_series(1,7681) i`);
    await admin.query("UPDATE productos SET codigo='sint-7681 ' WHERE id=7681");
    await admin.query("UPDATE productos SET codigo='SINT-7681' WHERE id=1");
    await buildOperational(directory);
    pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO' });
    const errors = [], packets = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/ventas', async route => {
      packets.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (packets.length > 1) return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort('failed');
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/ventas');
    const search = page.getByPlaceholder('Escanea o escribe… ej. BUJ-C7HSA');
    await search.waitFor();
    assert.equal(await page.getByRole('button', { name: /Artículo sintético/ }).count(), 48);
    await page.getByRole('spinbutton', { name: 'Cantidad' }).fill('2.50');
    await search.fill('sint-7681 ');
    await search.press('Enter');
    const row = page.getByRole('row').filter({ hasText: 'Artículo sintético 7681' });
    assert.match(await row.innerText(), /10\.003/);
    assert.match(await row.innerText(), /25\.01/);
    const checkout = page.getByRole('button', { name: /Registrar venta/ });
    await checkout.click();
    const retry = page.getByRole('button', { name: 'Reintentar venta' });
    await retry.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.keyboard.press('F9');
    await retry.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Venta registrada' }).waitFor();
    assert.match(await dialog.innerText(), /Registro 1/);
    assert.match(await dialog.innerText(), /25\.01/);
    assert.match(await dialog.innerText(), /3\.82/);
    assert.match(await dialog.innerText(), /Sin emisión de NCF/);
    assert.doesNotMatch(await dialog.innerText(), /Recibido|Cambio|Efectivo/);
    await verifyPrintLayout(page, 80 * 96 / 25.4);
    assert.equal(packets.length, 2);
    assert.deepEqual(packets[0], packets[1]);
    assert.equal((await admin.query('SELECT count(*) AS n FROM ventas')).rows[0].n, '1');
    assert.equal((await admin.query("SELECT stock FROM productos WHERE codigo='sint-7681 '")).rows[0].stock, '0.50');
    for (const [format, width, letter] of [
      ['Térmica 80 mm', 80 * 96 / 25.4, false],
      ['Térmica 58 mm', 58 * 96 / 25.4, false],
      ['Carta (8.5 x 11)', 7.5 * 96, true],
    ]) {
      await admin.query('UPDATE configuracion SET formato_impresion=$1, version=version+1', [format]);
      await page.reload();
      await search.fill('SINT-3');
      await search.press('Enter');
      await checkout.click();
      await dialog.getByRole('heading', { name: 'Venta registrada' }).waitFor();
      await verifyPrintLayout(page, width, letter);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await pool?.end();
    await admin?.end();
    await database?.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-sale-browser-'));
    await rm(directory, { recursive: true, force: true });
  }
});
