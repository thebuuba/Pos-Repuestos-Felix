import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

test('inventario conectado pagina todo el catálogo, filtra existencias y conserva los importes exactos', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'felix-inventory-pagination-'));
  let database, admin, pool, server, browser;
  try {
    await buildOperational(directory);
    database = await temporaryPostgres();
    admin = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(admin);
    await admin.query(`
      INSERT INTO pos_privado.netpos_importaciones (huella,database_id,categorias,marcas,ubicaciones,unidades)
      SELECT repeat('b',64),database_id,ARRAY['Solo del maestro','Categoría extendida de ' || repeat('CATALOGO',8)],'{}','{}','{}' FROM pos_privado.sistema;
      INSERT INTO productos (codigo,nombre,stock,stock_minimo,costo,precio1,precio2,precio3,categoria,notificar_minimo)
      SELECT CASE id WHEN 122 THEN 'CASO-ULTIMO' WHEN 123 THEN 'caso-ultimo' ELSE 'SINT-' || id END,
        'Pieza sintética ' || lpad(id::text,3,'0') || CASE id WHEN 121 THEN ' ' || repeat('REPUESTO',10) ELSE '' END,
        CASE id WHEN 3 THEN 1234567.25 WHEN 121 THEN 0 WHEN 122 THEN 0 WHEN 123 THEN 1.25 ELSE 1 END,
        CASE id WHEN 3 THEN 9876543.5 ELSE 2 END,
        CASE id WHEN 123 THEN 999999999999.9898 ELSE 12.3456 END, 15, 10.003, 0,
        CASE WHEN id <= 100 THEN 'Grupo A' ELSE 'Grupo B' END, id NOT IN (1, 122)
      FROM generate_series(1,123) AS id;
    `);
    pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + sep) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', timezoneId: 'America/Santo_Domingo', serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/inventario');
    const table = page.getByRole('table');
    const rows = table.locator('tbody tr');
    const previous = page.getByRole('button', { name: 'Anterior', exact: true });
    const next = page.getByRole('button', { name: 'Siguiente', exact: true });
    const result = text => page.getByText(text, { exact: true }).waitFor({ timeout: 5500 });
    await table.waitFor();
    assert.equal(await rows.count(), 50);
    await result('Mostrando 1–50 de 123 productos');
    assert.equal(await previous.isDisabled(), true);
    await next.press('Enter');
    await result('Mostrando 51–100 de 123 productos');
    assert.match(await rows.first().innerText(), /Pieza sintética 051/);
    await next.click();
    await result('Mostrando 101–123 de 123 productos');
    assert.equal(await rows.count(), 23);
    assert.equal(await next.isDisabled(), true);

    const search = page.getByRole('textbox', { name: 'Buscar por código, nombre o marca' });
    await search.fill('caso-ultimo');
    await result('Mostrando 1–2 de 2 productos');
    const lower = rows.filter({ hasText: /caso-ultimo/ });
    const upper = rows.filter({ hasText: /CASO-ULTIMO/ });
    assert.match(await lower.innerText(), /Pieza sintética 123/);
    assert.match(await upper.innerText(), /Pieza sintética 122/);
    assert.equal(await lower.getByRole('cell', { name: 'RD$ 999,999,999,999.9898', exact: true }).count(), 1);
    assert.equal(await lower.getByRole('cell', { name: 'RD$ 10.003', exact: true }).count(), 1);
    await lower.getByRole('button', { name: 'Editar', exact: true }).click();
    const sheet = page.getByRole('dialog');
    const cost = sheet.getByRole('spinbutton', { name: 'Costo base RD$', exact: true });
    assert.equal(await cost.inputValue(), '999999999999.9898');
    await cost.fill('24.5678');
    await sheet.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
    await lower.getByRole('cell', { name: 'RD$ 24.5678', exact: true }).waitFor();
    assert.equal(await upper.getByRole('cell', { name: 'RD$ 12.3456', exact: true }).count(), 1);
    await page.reload();
    await search.fill('CASO-ULTIMO');
    await result('Mostrando 1–2 de 2 productos');
    await lower.getByRole('button', { name: 'Editar', exact: true }).click();
    assert.equal(await cost.inputValue(), '24.5678');
    assert.equal(await sheet.getByLabel('Código', { exact: true }).inputValue(), 'caso-ultimo');
    await sheet.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await search.fill('no existe');
    await result('Mostrando 0 de 0 productos');
    await result('Sin resultados');
    assert.equal(await next.isDisabled(), true);
    await search.fill('');

    const categories = page.getByRole('combobox', { name: 'Filtrar por categoría' });
    await next.click();
    await categories.click();
    assert.equal(await page.getByRole('option', { name: 'Solo del maestro', exact: true }).count(), 1);
    assert.equal(await page.getByRole('option', { name: 'Motor', exact: true }).count(), 0);
    await page.getByRole('option', { name: 'Grupo B', exact: true }).click();
    await result('Mostrando 1–23 de 23 productos');
    await categories.click();
    await page.getByRole('option', { name: 'Grupo A', exact: true }).click();
    await result('Mostrando 1–50 de 100 productos');

    const restock = page.getByRole('heading', { name: /Bajo inventario/ }).locator('xpath=ancestor::section');
    await restock.getByRole('listitem').first().waitFor();
    assert.equal(await restock.getByRole('listitem').count(), 10);
    assert.match(await restock.getByRole('heading').innerText(), /121/);
    const lowCard = page.getByRole('link', { name: 'Ver Bajo mínimo', exact: true }).locator('xpath=../..');
    const outCard = page.getByRole('link', { name: 'Ver Agotados', exact: true }).locator('xpath=../..');
    assert.match(await lowCard.innerText(), /\b120\b/);
    assert.match(await outCard.innerText(), /\b2\b/);
    await next.click();
    await restock.getByRole('link', { name: 'Ver inventario', exact: true }).click();
    await result('Mostrando 1–50 de 121 productos');
    assert.equal(await rows.filter({ hasText: 'Pieza sintética 001' }).count(), 0);
    await next.click();
    await next.click();
    await result('Mostrando 101–121 de 121 productos');
    assert.equal(await upper.count(), 0);
    assert.equal(await rows.filter({ hasText: 'Pieza sintética 121' }).count(), 1);
    await page.getByRole('button', { name: 'Bajo', exact: true }).click();
    await result('Mostrando 1–50 de 120 productos');
    await page.getByRole('button', { name: 'Agotado', exact: true }).click();
    await result('Mostrando 1–2 de 2 productos');
    assert.equal(await upper.count(), 1);
    await page.getByRole('button', { name: 'Todos', exact: true }).click();

    await next.click();
    await result('Mostrando 51–100 de 123 productos');
    await next.click();
    await result('Mostrando 101–123 de 123 productos');
    const refresh = page.getByRole('button', { name: 'Actualizar datos', exact: true });
    await admin.query('UPDATE productos SET activo=false WHERE id > 70; UPDATE pos_privado.sistema SET revision=revision+1');
    await refresh.click();
    await result('Mostrando 51–70 de 70 productos');
    assert.equal(await next.isDisabled(), true);
    await admin.query('UPDATE productos SET activo=true; UPDATE pos_privado.sistema SET revision=revision+1');
    await refresh.click();
    await result('Mostrando 51–100 de 123 productos');
    await previous.click();
    await result('Mostrando 1–50 de 123 productos');

    const evidence = process.env.INVENTORY_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        const dark = theme === 'dark';
        const html = page.locator('html');
        if (await html.evaluate(el => el.classList.contains('dark')) !== dark) {
          await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
        }
        await page.evaluate(() => document.fonts.ready);
        const documentWidth = await html.evaluate(el => el.scrollWidth);
        assert.ok(documentWidth <= width, `${width} px en ${theme}, ancho del documento ${documentWidth} px`);
        if (width < 640) {
          assert.equal(await table.evaluate(el => el.parentElement.scrollWidth > el.parentElement.clientWidth), true);
        }
        if (evidence) {
          await table.evaluate(element => {
            element.parentElement.scrollLeft = 0;
            window.scrollTo(0, 0);
          });
          await page.screenshot({ path: join(evidence, `inventario-${width}-${theme}.png`), animations: 'disabled' });
        }
        if (evidence && [390, 1440].includes(width)) {
          await next.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(evidence, `paginacion-${width}-${theme}.png`), animations: 'disabled' });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
          await sheet.waitFor();
          await page.screenshot({ path: join(evidence, `formulario-${width}-${theme}.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await sheet.waitFor({ state: 'hidden' });
        }
      }
    }

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool?.end();
    await admin?.end();
    await database?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
