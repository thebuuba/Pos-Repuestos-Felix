import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { openTestCash } from './fixtures/cash.js';

let database, pool, server, browser, assets, origin, script;
before(async () => {
  script = (await build({ entryPoints: ['frontend/src/data/pos-client.js'], bundle: true, write: false,
    format: 'iife', globalName: 'clientModule' })).outputFiles[0].text;
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try {
    await migrateDatabase(admin);
    await admin.query("INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock,gravado) VALUES ('REC-1','Artículo de recuperación',1,10,9,8,100,false)");
  } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  await openTestCash(pool);
  assets = await mkdtemp(path.join(tmpdir(), 'felix-ios-recovery-'));
  await buildOperational(assets);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assets + path.sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    assert.ok(path.basename(assets).startsWith('felix-ios-recovery-'));
    await rm(assets, { recursive: true, force: true });
  }
});

async function openClient(t, recover = true) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.route(origin + '/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin + '/fixture');
  await page.addScriptTag({ content: script });
  await page.evaluate(async recover => {
    window.client = clientModule.createPosClient();
    await client.reload({ recover });
  }, recover);
  return page;
}
function writeProduct(page, code) {
  return page.evaluate(codigo => client.writeOperation({ method: 'POST', path: '/api/productos',
    databaseId: client.getState().snapshot.databaseId,
    payload: { codigo, nombre: codigo, costo: 1, precio1: 2, precio2: 0, precio3: 0, stock: 4 },
  }).then(() => null, error => ({ message: error.message, uncertain: error.uncertain })), code);
}
function writeSale(page) {
  return page.evaluate(() => {
    const snapshot = client.getState().snapshot;
    const product = snapshot.state.productos.find(row => row.codigo === 'REC-1');
    return client.writeOperation({ method: 'POST', path: '/api/ventas', databaseId: snapshot.databaseId,
      payload: { clienteId: snapshot.state.clientes.find(row => row.esContado).id, condicion: 'Contado', tipoComprobante: 'B02',
        cajaId: snapshot.state.caja.session.id, metodoPago: 'tarjeta', versionConfiguracion: snapshot.state.configuracion.version,
        items: [{ productoId: product.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: product.version }] },
    }).then(() => null, error => ({ message: error.message, uncertain: error.uncertain }));
  });
}

test('a lost response is recovered automatically with the identical durable packet', { timeout: 30000 }, async t => {
  const page = await openClient(t);
  const packets = [];
  const beforeSales = (await pool.query('SELECT count(*) FROM ventas')).rows[0].count;
  await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    return route.continue();
  });
  assert.equal((await writeSale(page)).uncertain, true);
  await page.waitForFunction(() => client.getState().pending === null, null, { timeout: 6000 });
  assert.deepEqual(packets, [packets[0], packets[0]]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count), Number(beforeSales) + 1);
});

for (const desktop of [true, false]) test(`${desktop ? 'Windows recovers a lost local sale response' : 'web/PWA keeps its recovery network guard'} when navigator reports no internet`, { timeout: 30000 }, async t => {
  const page = await openClient(t);
  await page.evaluate(desktop => {
    window.__FELIX_DESKTOP__ = desktop;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, desktop);
  const packets = [];
  const beforeSales = Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count);
  await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    return route.continue();
  });
  assert.equal((await writeSale(page)).uncertain, true);
  if (desktop) await page.waitForFunction(() => client.getState().pending === null, null, { timeout: 4000 });
  else {
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  }
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.deepEqual(packets, desktop ? [packets[0], packets[0]] : [packets[0]]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count), beforeSales + 1);
});

test('a blocked request times out on Safari-compatible AbortController and keeps its packet', { timeout: 15000 }, async t => {
  const page = await openClient(t, false);
  await page.evaluate(() => {
    AbortSignal.timeout = undefined;
    const schedule = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay >= 15000 ? 50 : delay, ...args);
    const request = window.fetch;
    window.fetch = (url, options) => url === '/api/productos'
      ? new Promise((resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal.reason)))
      : request(url, options);
  });
  const result = await Promise.race([writeProduct(page, 'IOS-HANG'),
    new Promise(resolve => setTimeout(() => resolve({ timedOut: false }), 1000))]);
  assert.equal(result.uncertain, true, 'A hanging fetch must stop waiting and preserve an uncertain operation');
  assert.equal(await page.evaluate(() => client.getState().pending.path), '/api/productos');
  assert.equal(await page.evaluate(() => client.getState().busy), false);
});

test('the sale draft follows global confirmation and presents one receipt without another charge', { timeout: 30000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const packets = [];
  let allow = false;
  await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    return allow ? route.continue() : route.abort();
  });
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('REC-1');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByRole('button', { name: 'Reintentar venta', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reintentar solicitud', exact: true }).count(), 0);
  await page.locator('aside').getByRole('link', { name: /Inventario/ }).click();
  await page.getByRole('button', { name: 'Reintentar solicitud', exact: true }).waitFor();
  allow = true;
  await page.getByRole('button', { name: 'Reintentar solicitud', exact: true }).click();
  const receipt = page.getByRole('dialog');
  await receipt.getByRole('heading', { name: 'Venta registrada', exact: true }).waitFor({ timeout: 6000 });
  assert.equal(new Set(packets.map(packet => packet.id)).size, 1);
  assert.equal(new Set(packets.map(packet => packet.body)).size, 1);
  await receipt.getByRole('button', { name: /Nueva venta/ }).click();
  await page.locator('aside').getByRole('link', { name: /Punto de venta/ }).click();
  assert.equal(await search.isDisabled(), false);
  assert.equal(await page.getByRole('button', { name: 'Reintentar venta' }).count(), 0);
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
});

async function fastRecovery(page) {
  await page.evaluate(() => {
    const schedule = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => schedule(callback,
      [1000, 3000, 10000].includes(delay) ? 20 : delay, ...args);
  });
}

test('transient recovery is bounded to three retries and retains the original packet', { timeout: 15000 }, async t => {
  const page = await openClient(t);
  await fastRecovery(page);
  const packets = [];
  await page.route('**/api/ventas', route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: 503, json: { error: 'Servicio temporalmente ocupado.' } });
  });
  assert.equal((await writeSale(page)).uncertain, true);
  await page.waitForFunction(() => !client.getState().recovering && client.getState().error, null, { timeout: 3000 });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(packets.length, 4);
  assert.equal(new Set(packets.map(packet => packet.id)).size, 1);
  assert.equal(new Set(packets.map(packet => packet.body)).size, 1);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await page.evaluate(() => client.reload({ recover: true }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(packets.length, 4, 'A periodic catalog refresh must not reset the retry budget');
});

test('reconnection during the last active retry renews the bounded recovery budget', { timeout: 30000 }, async t => {
  const page = await openClient(t);
  await fastRecovery(page);
  const packets = [];
  const lastAttempt = Promise.withResolvers();
  const releaseLastAttempt = Promise.withResolvers();
  t.after(() => releaseLastAttempt.resolve());
  const beforeSales = Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count);
  await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 4) {
      lastAttempt.resolve();
      await releaseLastAttempt.promise;
    }
    if (packets.length <= 4) return route.fulfill({ status: 503, json: { error: 'Servicio temporalmente ocupado.' } });
    return route.continue();
  });
  assert.equal((await writeSale(page)).uncertain, true);
  await lastAttempt.promise;
  assert.equal(await page.evaluate(() => client.getState().recovering), true);
  // online/focus/visibility use these options, even when a previous attempt is
  // still waiting for its response. Its later 503 must not consume that event.
  await page.evaluate(() => client.reload({ recover: true, resumeRecovery: true, background: true }));
  releaseLastAttempt.resolve();
  await page.waitForFunction(() => client.getState().pending === null, null, { timeout: 3000 });
  assert.equal(packets.length, 5);
  assert.equal(new Set(packets.map(packet => packet.id)).size, 1);
  assert.equal(new Set(packets.map(packet => packet.body)).size, 1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count), beforeSales + 1);
});

for (const status of [401, 403, 409]) test(`automatic recovery stops on ${status} and preserves an unproven packet`, { timeout: 15000 }, async t => {
  const page = await openClient(t);
  await fastRecovery(page);
  let writes = 0;
  await page.route('**/api/ventas', route => {
    writes++;
    return route.fulfill({ status, json: { error: 'Requiere revisión.' } });
  });
  assert.equal((await writeSale(page)).uncertain, true);
  await page.evaluate(() => client.reload({ recover: true, resumeRecovery: true }).catch(() => {}));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(writes, 1);
  assert.ok(await page.evaluate(() => client.getState().pending.id));
  if (status === 401) {
    assert.equal(await page.evaluate(() => client.getState().authenticationRequired), true);
    assert.equal(await page.evaluate(() => client.getState().saleOperationId), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('repuestos-felix-venta-pendiente')), null);
  }
});

test('a changed database blocks automatic replay before it sends the old packet', { timeout: 15000 }, async t => {
  const page = await openClient(t);
  let writes = 0;
  await page.route('**/api/ventas', route => { writes++; return route.abort(); });
  await writeSale(page);
  const pending = await page.evaluate(() => client.getState().pending);
  await page.route('**/api/state', async route => {
    const response = await route.fetch({ headers: {} });
    const snapshot = await response.json();
    snapshot.databaseId = '12345678-1234-4234-8234-123456789abc';
    return route.fulfill({ status: 200, json: snapshot });
  });
  await page.evaluate(() => client.reload({ recover: true, resumeRecovery: true }));
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(writes, 1);
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
});

for (const mobile of [false, true]) test(`reopening recovers after an initial 503 without user retry and shows only its own receipt (${mobile ? 'WebKit iPhone PWA' : 'Chromium'})`, { timeout: 30000 }, async t => {
  const engine = mobile ? await webkit.launch({ headless: true }) : browser;
  if (mobile) t.after(() => engine.close());
  const context = await engine.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: mobile, hasTouch: mobile, locale: 'es-DO', reducedMotion: 'reduce', serviceWorkers: mobile ? 'allow' : 'block' });
  t.after(() => context.close());
  if (mobile) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let packets = [];
  const beforeSales = (await pool.query('SELECT count(*) FROM ventas')).rows[0].count;
  let reopening = false, failedCatalog = false, confirmedCatalog = false;
  if (mobile) await context.addInitScript(() => {
    // WebKit cannot route requests made by a service worker. Inject the loss
    // at fetch's response boundary while leaving the real PWA worker running.
    const request = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const reopening = sessionStorage.getItem('ios-fixture-reopening') === '1';
      if (url === '/api/state' && reopening && !sessionStorage.getItem('ios-fixture-read-failed')) {
        sessionStorage.setItem('ios-fixture-read-failed', '1');
        return Response.json({ error: 'El servicio no confirmó la lectura del catálogo.' }, { status: 503 });
      }
      if (url === '/api/ventas') {
        const packets = JSON.parse(sessionStorage.getItem('ios-fixture-packets') || '[]');
        if (packets.length && !reopening) throw new TypeError('Fixture: la respuesta sigue interrumpida.');
        if (reopening && !sessionStorage.getItem('ios-fixture-catalog-confirmed')) throw new Error('Fixture: reintento antes del catálogo.');
        packets.push({ body: options.body, id: options.headers['Idempotency-Key'] });
        sessionStorage.setItem('ios-fixture-packets', JSON.stringify(packets));
        const response = await request(url, options);
        if (packets.length === 1) {
          if (response.status !== 200) throw new Error('Fixture: la venta inicial no fue aceptada.');
          throw new TypeError('Fixture: respuesta perdida después del commit.');
        }
        return response;
      }
      const response = await request(url, options);
      if (url === '/api/state' && reopening && [200, 304].includes(response.status)) sessionStorage.setItem('ios-fixture-catalog-confirmed', '1');
      return response;
    };
  });
  if (!mobile) await page.route('**/api/state', async route => {
    if (reopening && !failedCatalog) {
      failedCatalog = true;
      return route.fulfill({ status: 503, json: { error: 'El servicio no confirmó la lectura del catálogo.' } });
    }
    // WebKit interception cannot fulfill a 304; this fixture deliberately
    // obtains a full, real catalog while testing initial-read failure recovery.
    const headers = route.request().headers();
    delete headers['if-none-match'];
    const response = await route.fetch({ headers });
    if (reopening) confirmedCatalog = true;
    return route.fulfill({ response });
  });
  if (!mobile) await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    assert.ok(reopening && confirmedCatalog, 'A reopened client must confirm the catalog before replaying');
    return route.continue();
  });
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('REC-1');
  await search.press('Enter');
  if (mobile) await page.getByRole('button', { name: /^Cobrar/ }).click();
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByRole('button', { name: 'Reintentar venta' }).waitFor().catch(async error => {
    t.diagnostic(JSON.stringify({ packets: packets.length, pageErrors, body: await page.locator('body').innerText() }));
    throw error;
  });
  if (mobile) {
    await mkdir('dist/verification/ios-recovery', { recursive: true });
    await page.getByRole('button', { name: 'Reintentar venta' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'dist/verification/ios-recovery/webkit-pending-sale.png' });
    await page.evaluate(() => sessionStorage.setItem('ios-fixture-reopening', '1'));
  }
  reopening = true;
  await page.reload();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
  await page.getByText('Restableciendo la conexión…', { exact: true }).waitFor();
  if (mobile) {
    await mkdir('dist/verification/ios-recovery', { recursive: true });
    await page.screenshot({ path: 'dist/verification/ios-recovery/webkit-reconnecting.png' });
  }
  await page.getByRole('dialog').getByRole('heading', { name: 'Venta registrada' }).waitFor({ timeout: 12000 });
  if (mobile) packets = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ios-fixture-packets')));
  assert.deepEqual(packets, [packets[0], packets[0]]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count), Number(beforeSales) + 1);
  assert.deepEqual(pageErrors, []);
  if (mobile) await page.screenshot({ path: 'dist/verification/ios-recovery/webkit-recovered-receipt.png' });
});

test('another tab can confirm a sale while only the originating draft receives its receipt', { timeout: 30000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const packets = [];
  let otherConfirmed = false;
  const beforeSales = (await pool.query('SELECT count(*) FROM ventas')).rows[0].count;
  await page.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    return otherConfirmed ? route.continue() : route.abort();
  });
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('REC-1');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByRole('button', { name: 'Reintentar venta' }).waitFor();
  const other = await context.newPage();
  await other.route('**/api/ventas', async route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    otherConfirmed = true;
    return route.fulfill({ response });
  });
  await other.goto(origin + '/inventario');
  await page.getByRole('dialog').getByRole('heading', { name: 'Venta registrada' }).waitFor({ timeout: 20000 });
  assert.equal(await other.getByRole('dialog').count(), 0, 'A foreign pending sale must not open a receipt over this tab');
  assert.equal(new Set(packets.map(packet => packet.id)).size, 1);
  assert.equal(new Set(packets.map(packet => packet.body)).size, 1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM ventas')).rows[0].count), Number(beforeSales) + 1);
  const settledRequests = packets.length;
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(packets.length, settledRequests, 'Confirmation broadcasts must not create an endless replay loop');
});

test('a permanent error during automatic recovery replaces the old temporary sale message without releasing its draft', { timeout: 30000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const packets = [];
  await page.route('**/api/ventas', route => {
    packets.push({ body: route.request().postData(), id: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: packets.length === 1 ? 503 : 403,
      json: { error: packets.length === 1 ? 'Servicio temporalmente ocupado.' : 'El servicio rechazó el acceso a esta operación.' } });
  });
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('REC-1');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByText('El servicio rechazó el acceso a esta operación.', { exact: true }).waitFor({ timeout: 6000 });
  assert.equal(await page.getByRole('button', { name: 'Reintentar venta' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Reintentar solicitud' }).count(), 0);
  assert.equal(await search.isDisabled(), true);
  assert.deepEqual(packets, [packets[0], packets[0]]);
});
