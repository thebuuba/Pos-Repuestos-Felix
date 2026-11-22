import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';

test('la navegación inferior comparte rutas, conserva todos los módulos y deja libres acciones y diálogos', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-mobile-navigation-'));
  let database, pool, server, browser;
  try {
    await buildOperational(directory);
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'es-DO', reducedMotion: 'reduce' });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/ventas`);
    await page.locator('main h1').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Abrir menú' }).isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Actualizar datos', exact: true }).isVisible(), false);
    const nav = page.getByRole('navigation', { name: 'Navegación rápida' });
    await nav.waitFor();
    assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Ventas', 'Inventario', 'Caja']);
    assert.equal(await nav.getByRole('link', { name: 'Ventas', exact: true }).getAttribute('aria-current'), 'page');
    await nav.getByRole('link', { name: 'Inventario' }).click();
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario' }).waitFor();
    await nav.getByRole('link', { name: 'Caja', exact: true }).click();
    await page.getByRole('heading', { name: 'Caja', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario' }).waitFor();
    await nav.getByRole('button', { name: 'Más', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Más opciones' });
    await dialog.waitFor();
    await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    assert.equal(await dialog.getByRole('link').count(), 12, 'Los doce módulos permanecen disponibles');
    assert.ok((await dialog.boundingBox()).width >= 358, 'El panel ocupa el ancho del teléfono, sin barra lateral');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-controls') === 'pos-mobile-menu');
    assert.equal(await nav.getByRole('button', { name: 'Más', exact: true }).evaluate(element => element === document.activeElement), true);
    await nav.getByRole('button', { name: 'Más', exact: true }).click();
    await dialog.getByRole('link', { name: 'Compras', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).pathname, '/compras');
    await nav.getByRole('link', { name: 'Ventas', exact: true }).click();
    const evidence = path.resolve('dist/verification/mobile-navigation');
    await mkdir(evidence, { recursive: true });
    for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [844, 390], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      for (const dark of [false, true]) {
        if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== dark) await page.getByRole('button', { name: 'Cambiar tema' }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Reflujo ${width} ${dark}`);
        assert.equal(await nav.isVisible(), width < 1024);
        if (width < 1024) {
          for (const item of await nav.locator('a,button').all()) {
            const bounds = await item.boundingBox();
            assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Área táctil mínima');
          }
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const checkout = await page.getByRole('button', { name: /^Cobrar/ }).boundingBox();
          const bar = await nav.boundingBox();
          assert.ok(checkout.y + checkout.height <= bar.y, 'La barra no tapa el cobro al final de la pantalla');
        }
        await page.screenshot({ path: path.join(evidence, `${width}-${height}-${dark ? 'oscuro' : 'claro'}-cobro.png`), animations: 'disabled' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(evidence, `${width}-${height}-${dark ? 'oscuro' : 'claro'}.png`), animations: 'disabled' });
        if (width < 1024) {
          await nav.getByRole('button', { name: 'Más', exact: true }).click();
          await dialog.waitFor();
          for (const link of await dialog.getByRole('link').all()) {
            const bounds = await link.boundingBox();
            assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Los accesos de Más conservan área táctil');
          }
          assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
          await page.screenshot({ path: path.join(evidence, `${width}-${height}-${dark ? 'oscuro' : 'claro'}-mas.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
    const install = page.getByRole('dialog');
    await install.waitFor();
    assert.equal(await install.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height - 10));
    }), true, 'El diálogo queda por encima de la navegación');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await pool?.end();
    await database?.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-mobile-navigation-'));
    await rm(directory, { recursive: true, force: true });
  }
});
