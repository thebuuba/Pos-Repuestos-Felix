import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';

async function waitForActivation(worker) {
  // Reopening a client before activation can keep the old worker in control.
  // Poll from the waiting worker itself while all application pages are closed.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await worker.evaluate(() => !self.registration.waiting && !self.registration.installing &&
      self.registration.active?.state === 'activated')) return;
    await delay(25);
  }
  assert.fail('La actualización no terminó de activarse después de cerrar sus clientes');
}

test('PWA operativa instala recursos públicos, conserva navegación y espera para actualizar', { timeout: 120_000 }, async () => {
  let directory, database, pool, server, browser;
  try {
    directory = await mkdtemp(join(tmpdir(), 'felix-pwa-browser-'));
    await buildOperational(directory);
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + sep) });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await chromium.launchPersistentContext(join(directory, 'browser-profile'), {
      channel: 'msedge', headless: true, viewport: { width: 390, height: 844 }, locale: 'es-DO',
    });
    browser = context.browser();
    let page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/ventas');
    assert.equal(await page.locator('link[rel="manifest"]').count(), 1, 'El documento debe anunciar su manifiesto');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await page.getByText('Actualización disponible', { exact: true }).count(), 0, 'La primera instalación no es una actualización pendiente');
    const cdp = await context.newCDPSession(page);
    const { data, errors: manifestErrors } = await cdp.send('Page.getAppManifest');
    assert.deepEqual(manifestErrors, []);
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
    const manifest = JSON.parse(data);
    assert.equal(manifest.start_url, '/ventas');
    assert.equal(manifest.display, 'standalone');
    const scriptResponse = await fetch(origin + await page.locator('script[type="module"]').getAttribute('src'));
    assert.equal(scriptResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await scriptResponse.arrayBuffer();
    assert.deepEqual(manifest.shortcuts.map(item => item.url), ['/ventas', '/inventario', '/caja']);
    for (const icon of manifest.icons) {
      const response = await fetch(origin + icon.src);
      assert.equal(response.status, 200);
      const png = Buffer.from(await response.arrayBuffer());
      assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    }
    await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Instalar Repuestos Félix', exact: true }).waitFor();
    const evidence = resolve('dist/verification/pwa');
    await mkdir(evidence, { recursive: true });
    assert.ok((await page.getByRole('dialog').boundingBox()).height <= 844 * 0.91);
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.installRequested = true; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: 'Instalar ahora', exact: true }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        await page.getByRole('dialog').screenshot({ path: join(evidence, `instalacion-${width}-${dark ? 'oscuro' : 'claro'}.png`), animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.getByRole('button', { name: 'Instalar ahora', exact: true }).click();
    assert.equal(await page.evaluate(() => window.installRequested), true);
    assert.equal(await page.getByRole('button', { name: 'Instalar ahora', exact: true }).count(), 0, 'El evento de instalación se usa una sola vez');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    for (const path of ['/ventas', '/inventario', '/compras', '/caja', '/clientes', '/suplidores', '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/configuracion', '/ayuda']) {
      assert.ok(await page.getByRole('dialog').locator(`a[href="${path}"]`).count() >= 1, path);
    }
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    const cachePaths = await page.evaluate(async () => {
      const paths = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
      return paths;
    });
    assert.ok(cachePaths.includes('/pwa-shell.html'));
    assert.ok(cachePaths.some(path => /^\/assets\/pwa\/app-[a-f0-9]{16}\.js$/.test(path)));
    assert.ok(cachePaths.includes('/assets/fonts/inter-latin-wght-normal.woff2'));
    assert.equal(cachePaths.some(path => /^\/(?:api|login|logout|cuenta)(?:\/|$)/.test(path)), false);
    assert.equal(cachePaths.includes('/'), false);
    await context.setOffline(true);
    await page.getByText(/Datos desactualizados/).waitFor();
    await page.reload();
    await page.getByRole('main').getByText('Restableciendo la conexión…', { exact: true }).waitFor();
    await page.getByText('Volveremos a intentarlo automáticamente.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => fetch('/api/state').then(() => true, () => false)), false);
    assert.equal(await page.locator('.pos-sale').count(), 0, 'Sin una lectura nueva no se inventan datos');
    await context.setOffline(false);
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    const script = await readFile(join(directory, 'sw.js'), 'utf8');
    const nextWorkerReady = context.waitForEvent('serviceworker');
    await writeFile(join(directory, 'sw.js'), script.replace(/felix-pos-shell-([a-f0-9]+)/, 'felix-pos-shell-next-$1'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const nextWorker = await nextWorkerReady;
    await page.getByText('Actualización disponible', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.getByText('Actualización disponible', { exact: true }).isVisible(), false,
      'La PWA móvil aplica la versión al reabrir sin pedir una actualización manual');
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== dark) await page.getByRole('button', { name: 'Cambiar tema' }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Reflujo ${width} ${dark}`);
        await page.screenshot({ path: join(evidence, `${width}-${dark ? 'oscuro' : 'claro'}.png`), fullPage: true, animations: 'disabled' });
      }
    }
    await page.close();
    await waitForActivation(nextWorker);
    page = await context.newPage();
    await page.goto(origin + '/ventas');
    const afterUpgrade = await page.evaluate(async () => ({ names: await caches.keys(), source: (await (await fetch('/sw.js')).text()).match(/const CACHE = [^;]+/)?.[0] }));
    assert.equal(afterUpgrade.names.some(name => name.startsWith('felix-pos-shell-next-')), true);
    assert.equal(afterUpgrade.names.some(name => /^felix-pos-shell-[a-f0-9]+$/.test(name)), false, JSON.stringify(afterUpgrade));
    await page.route('**/api/state', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Inicia sesión para acceder al sistema.' }) }));
    await page.reload();
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
    assert.equal(await page.locator('.pos-sale').count(), 0, 'Una sesión cerrada no recupera datos desde la caché');
    assert.deepEqual(errors, []);

    // Upgrade from the previous worker at the same /sw.js URL, including its old cache prefix.
    await page.close();
    await writeFile(join(directory, 'sw.js'), `self.addEventListener('install', e => e.waitUntil(caches.open('felix-pos-shell-v5').then(c => c.addAll(['/index.html', '/app.js', '/styles.css'])))); self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));`);
    const legacy = await browser.newContext();
    const previous = await legacy.newPage();
    await previous.goto(origin + '/ventas');
    await previous.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await previous.evaluate(async () => (await caches.keys()).includes('felix-pos-shell-v5')), true);
    const currentWorkerReady = legacy.waitForEvent('serviceworker');
    await writeFile(join(directory, 'sw.js'), script);
    await previous.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const currentWorker = await currentWorkerReady;
    await previous.getByText('Actualización disponible', { exact: true }).waitFor();
    await previous.close();
    await waitForActivation(currentWorker);
    const upgraded = await legacy.newPage();
    await upgraded.goto(origin + '/ventas');
    assert.equal(await upgraded.evaluate(async () => (await caches.keys()).includes('felix-pos-shell-v5')), false);
    await upgraded.getByRole('heading', { name: 'Agregar productos' }).waitFor();

    const desktop = await browser.newContext();
    await desktop.addInitScript(() => { window.__FELIX_DESKTOP__ = true; });
    const native = await desktop.newPage();
    await native.goto(origin + '/ventas');
    await native.getByRole('heading', { name: 'Agregar productos' }).waitFor();
    assert.equal(await native.getByRole('button', { name: 'Instalar app', exact: true }).count(), 0);
    assert.equal(await native.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await pool?.end();
    await database?.stop();
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(directory.includes('felix-pwa-browser-'));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
