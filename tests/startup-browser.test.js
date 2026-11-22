import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium, webkit } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';

let directory, database, pool, server, origin;
const stateReads = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'felix-startup-'));
  await buildOperational(directory);
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(pool);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
  server.on('request', (request, response) => {
    if (request.url === '/api/state') response.on('finish', () => stateReads.push({ condition: request.headers['if-none-match'], status: response.statusCode }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await pool?.end(); await database?.stop();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-startup-'));
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [engine, options, name] of [[chromium, { channel: 'msedge' }, 'chromium'], [webkit, {}, 'webkit']]) {
  test(`${name}: carga desde el HTML, una consulta inicial y navegación sin pantalla de espera`, async t => {
    const browser = await engine.launch({ ...options, headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-DO', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let releaseScript, releaseState, reads = 0;
    const scriptGate = new Promise(resolve => { releaseScript = resolve; });
    let stateGate = new Promise(resolve => { releaseState = resolve; });
    await page.route('**/assets/pwa/app-*.js', async route => { await scriptGate; await route.continue(); });
    await page.route('**/api/state', async route => { reads++; await stateGate; await route.continue(); });
    await page.goto(origin + '/ventas', { waitUntil: 'commit' });
    const loading = page.getByRole('status').filter({ hasText: /Preparando la aplicación|Cargando productos para la venta/ });
    await loading.waitFor();
    assert.match(await loading.innerText(), /Preparando la aplicación/);
    assert.equal(reads, 0, 'La espera aparece antes de descargar el JavaScript');
    const firstRead = page.waitForRequest('**/api/state');
    releaseScript(); await firstRead;
    await loading.waitFor();
    assert.match(await loading.innerText(), /Cargando productos para la venta/);
    assert.equal(await page.getByText(/pendiente de sincronización/).count(), 0);
    assert.equal(await page.getByRole('navigation', { name: 'Navegación rápida' }).count(), 0);
    const evidence = path.resolve('dist/verification/startup');
    await mkdir(evidence, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(evidence, `${name}-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    releaseState();
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    // Flush mount effects without the periodic poll.
    await page.clock.runFor(50);
    assert.equal(reads, 1, 'Montar la navegación no solicita otra copia inicial');
    stateGate = new Promise(resolve => { releaseState = resolve; });
    const nextRead = page.waitForRequest('**/api/state');
    let releaseModule;
    const moduleGate = new Promise(resolve => { releaseModule = resolve; });
    await page.route('**/assets/pwa/chunk-*.js', async route => { await moduleGate; await route.continue(); });
    await page.getByRole('link', { name: 'Inventario', exact: true }).click();
    const navigationRequest = await nextRead;
    await page.getByRole('status').filter({ hasText: 'Abriendo Inventario…' }).waitFor();
    assert.equal((await page.getByRole('status').filter({ hasText: 'Abriendo Inventario…' }).boundingBox()).height, 192);
    await page.screenshot({ path: path.join(evidence, `${name}-abriendo-inventario.png`), animations: 'disabled' });
    releaseModule();
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
    assert.equal(await loading.count(), 0, 'La nueva sección se muestra aunque el refresco tarde');
    assert.equal(await page.getByText(/pendiente de sincronización/).count(), 0);
    const refreshed = page.waitForResponse('**/api/state');
    releaseState();
    const navigationResponse = await refreshed;
    // WebKit can expose the revalidated response as 200. Verify the wire response
    // at our disposable server, where no catalog body was sent for this request.
    assert.ok([200, 304].includes(navigationResponse.status()));
    assert.deepEqual(stateReads.at(-1), { condition: navigationRequest.headers()['if-none-match'], status: 304 });
    assert.ok(stateReads.at(-1).condition);
    await page.getByRole('link', { name: 'Ventas', exact: true }).click();
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  });

  test(`${name}: el arranque fallido permite reintentar y la sesión cerrada no muestra datos`, async t => {
    const browser = await engine.launch({ ...options, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(6000);
    await page.clock.install(); await page.clock.pauseAt(new Date());
    let status = 503;
    await page.route('**/api/state', route => status === 200 ? route.continue() : route.fulfill({ status,
      json: { error: status === 401 ? 'Inicia sesión para acceder al sistema.' : 'No se pudo conectar con el servicio.' } }));
    await page.goto(origin + '/ventas');
    await page.getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
    assert.equal(await page.getByText('Abriendo Félix POS…', { exact: true }).count(), 0);
    assert.equal(await page.getByText(/pendiente de sincronización/).count(), 0);
    assert.equal(await page.locator('.pos-sale').count(), 0);
    status = 200;
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    status = 401;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
    assert.equal(await page.locator('.pos-sale').count(), 0);
  });

  test(`${name}: un módulo que no se descarga permite reintentar y mantiene la navegación`, async t => {
    const browser = await engine.launch({ ...options, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await page.goto(origin + '/ventas');
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    await page.route('**/assets/pwa/chunk-*.js', route => route.abort('failed'));
    await page.getByRole('link', { name: 'Caja', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /No se pudo abrir este módulo/ }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Navegación rápida' }).isVisible(), true);
    await page.unroute('**/assets/pwa/chunk-*.js');
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.getByRole('heading', { name: 'Caja', exact: true }).waitFor();
  });
}

for (const [engine, options, name] of [[chromium, { channel: 'msedge' }, 'chromium'], [webkit, {}, 'webkit']]) {
test(`${name}: el tema elegido se aplica antes del JavaScript y persiste entre carga y navegación`, async t => {
  const browser = await engine.launch({ ...options, headless: true });
  t.after(() => browser.close());
  for (const [saved, expected] of [[null, 'light'], ['light', 'light'], ['dark', 'dark']]) {
    const context = await browser.newContext({ colorScheme: 'dark', serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await context.addInitScript(saved => { if (saved && !localStorage.getItem('felix-theme')) localStorage.setItem('felix-theme', saved); }, saved);
    let release, releaseData;
    const gate = new Promise(resolve => { release = resolve; });
    const dataGate = new Promise(resolve => { releaseData = resolve; });
    await page.route('**/assets/pwa/app-*.js', async route => { await gate; await route.continue(); });
    await page.route('**/api/state', async route => { await dataGate; await route.continue(); });
    try {
      await page.goto(origin + '/ventas', { waitUntil: 'commit' });
      await page.locator('.pos-startup').waitFor();
      // The inline HTML background paints before the stylesheet arrives; body
      // can still be transparent at this point without a visible theme change.
      const initial = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), color: getComputedStyle(document.documentElement).backgroundColor }));
      assert.equal(initial.dark, expected === 'dark');
      release();
      await page.getByRole('status').filter({ hasText: 'Cargando productos para la venta…' }).waitFor();
      await mkdir('dist/verification/session-theme', { recursive: true });
      await page.screenshot({ path: `dist/verification/session-theme/${name}-startup-${saved || 'default'}.png`, animations: 'disabled' });
      releaseData();
      await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), initial.dark);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), initial.color, 'El fondo no cambia al montar el POS');
      await page.screenshot({ path: `dist/verification/session-theme/${name}-sale-${saved || 'default'}.png`, animations: 'disabled' });
      const wanted = expected === 'dark' ? 'claro' : 'oscuro';
      await page.getByRole('button', { name: 'Cambiar tema' }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem('felix-theme')), wanted === 'claro' ? 'light' : 'dark');
      await page.reload();
      await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), wanted === 'oscuro');
    } finally { release(); releaseData(); await context.close(); }
  }
});
}
