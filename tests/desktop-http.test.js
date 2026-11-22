import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { startDesktop } from '../src/desktop/main.js';
import { windowsSecrets } from '../src/desktop/credentials.js';
import { handleRequest } from '../src/http/app.js';
import { hostingConfig } from '../src/hosting.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { temporaryPostgres } from './postgres.js';
import { testAuthService } from './fixtures/supabase-auth.js';

test('gateway Windows autentica, conserva caja y sesión offline, bloquea origen e invalida accesos revocados', { timeout: 120_000, skip: process.platform !== 'win32' }, async () => {
  let directory, database, pool, auth, app, browser;
  let network = 'online';
  const password = 'clave-navegador-sintetica-12345';
  const remoteOrigin = 'https://pos.example';
  try {
    directory = await mkdtemp(join(tmpdir(), 'felix-desktop-http-'));
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    auth = await testAuthService();
    const hosting = hostingConfig({ ...auth.env, PUBLIC_ORIGIN: remoteOrigin });
    const initial = await readSnapshot(pool, 'Prueba gateway');
    await writeOperation(pool, 'POST', '/api/productos', {
      databaseId: initial.databaseId, codigo: 'WIN-HTTP-001', nombre: 'Producto sintético Windows',
      costo: '10.0001', precio1: '12.3400', precio2: '12.0000', precio3: '11.0000', stock: '5',
    }, randomUUID(), 'Prueba gateway', { id: 'fixture-user', name: 'felix' });
    const remoteOptions = {
      origin: remoteOrigin, secrets: windowsSecrets,
      fetcher: async (url, options) => {
        if (network === 'offline') throw new TypeError('Desconexión sintética');
        if (network === 'revoked') return Response.json({ error: 'Inicia sesión para acceder al sistema.' }, { status: 401 });
        return handleRequest(new Request(url, { ...options, headers: { ...options.headers, 'X-Forwarded-Proto': 'https' } }), {
          pool, hosting, databaseLabel: 'Prueba gateway', readAsset: () => { throw new Error('El transporte remoto sólo admite API en esta prueba'); },
        });
      },
    };
    const start = () => startDesktop({ directory, assetsDirectory: resolve('dist/operational'), remoteOptions });
    app = await start();
    await assert.rejects(start(), /ya está abierto/, 'No pueden abrirse dos motores sobre el mismo SQLite');
    const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
      const response = await fetch(app.origin + path, { method, redirect: 'manual',
        headers: { ...(body && { Origin: app.origin, 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
        ...(body && { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, json: () => JSON.parse(text) };
    };
    assert.equal((await call('/api/state')).status, 401);
    assert.equal((await call('/api/desktop/export')).status, 401);
    assert.equal((await call('/ventas')).status, 303);
    const loginHtml = await call('/login');
    assert.match(loginHtml.text, /<head><script src="\/desktop\.js"><\/script>/);
    assert.equal((await call('/desktop.js')).text, 'window.__FELIX_DESKTOP__ = true;');
    assert.equal((await call('/pos.sqlite')).status, 404);
    assert.equal((await call('/application.lock')).status, 404);
    const spoofedHost = await new Promise((done, reject) => {
      const request = httpRequest(app.origin + '/api/state', { headers: { Host: 'ajeno.example' } }, response => {
        response.resume(); response.on('end', () => done(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(spoofedHost, 403);
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password }, headers: { Origin: 'https://ajeno.example' } })).status, 403);
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    network = 'offline';
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password } })).status, 401, 'El primer acceso necesita servidor');
    assert.equal(app.engine.status().initialized, false);
    network = 'online';
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const login = async () => {
      await page.goto(app.origin + '/login');
      await page.getByLabel('Usuario', { exact: true }).fill('felix');
      await page.getByLabel('Contraseña', { exact: true }).fill(password);
      await page.getByLabel('Mantener sesión en este dispositivo').check();
      await page.getByRole('button', { name: 'Entrar al sistema' }).click();
      await page.getByRole('heading', { name: 'Agregar productos' }).waitFor({ timeout: 60_000 });
    };
    await login();
    assert.equal(await page.evaluate(() => window.__FELIX_DESKTOP__), true);
    assert.equal(await page.getByRole('button', { name: 'Instalar app', exact: true }).count(), 0);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
    assert.equal(app.engine.status().initialized, true);
    const profile = app.engine.ledger.get('profile');
    assert.equal(profile.id, 'fixture-user');
    assert.notEqual(profile.hash, password);
    assert.equal(Object.hasOwn(profile, 'password'), false);
    const protectedCookie = app.engine.ledger.get('remoteCookie');
    assert.ok(protectedCookie && !protectedCookie.includes('fixture-access'));
    assert.match(await windowsSecrets.unprotect(protectedCookie), /^__Host-felix-session=/);
    const cookieRow = (await context.cookies(app.origin)).find(cookie => cookie.name === 'felix-desktop');
    assert.equal(cookieRow.httpOnly, true);
    assert.equal(cookieRow.sameSite, 'Strict');
    let cookie = cookieRow.name + '=' + cookieRow.value;
    const html = await call('/ventas', { cookie });
    assert.equal(html.status, 200);
    assert.ok(html.text.indexOf('/desktop.js') < html.text.indexOf('type="module"'));
    await page.getByRole('link', { name: 'Inventario', exact: true }).click();
    await page.getByText('Producto sintético Windows', { exact: true }).waitFor();
    network = 'offline';
    await call('/api/desktop/sync', { method: 'POST', body: {}, cookie });
    await page.getByRole('link', { name: 'Caja', exact: true }).click();
    const packets = [];
    const droppedOpeningResponse = Promise.withResolvers();
    await page.route('**/api/caja/abrir', async route => {
      const request = route.request();
      packets.push({ id: request.headers()['idempotency-key'], body: request.postData() });
      if (packets.length !== 1) return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await response.body();
      await route.abort('connectionfailed');
      droppedOpeningResponse.resolve();
    });
    const journal = () => page.evaluate(() => new Promise((done, reject) => {
      const opening = indexedDB.open('repuestos-felix-operaciones', 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('operaciones', 'readonly');
        const request = transaction.objectStore('operaciones').get('pendiente');
        request.onsuccess = () => done(request.result ?? null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      };
    }));
    await page.getByLabel('Fondo inicial').fill('100.01');
    await page.getByRole('main').getByRole('button', { name: 'Abrir caja', exact: true }).click();
    await droppedOpeningResponse.promise;
    await page.getByText('Solicitud pendiente de confirmación', { exact: true }).waitFor();
    assert.equal(await page.getByText('Caja abierta', { exact: true }).count(), 0, 'Una respuesta perdida no confirma la apertura en la interfaz');
    const uncertain = await journal();
    assert.equal(uncertain.id, packets[0].id);
    assert.equal(uncertain.status, 'sending');
    assert.equal(uncertain.body, packets[0].body);
    assert.equal((await call('/api/state', { cookie })).json().state.caja.summary.expected, 100.01);
    assert.equal((await readSnapshot(pool, 'Prueba gateway')).state.caja.session.open, false, 'La caja local no se declara guardada en el servidor sin red');
    assert.equal((await call('/api/desktop/pending', { cookie })).json().length, 1);
    assert.equal((await call('/api/desktop/sync', { method: 'POST', body: {}, cookie, headers: { Origin: 'https://ajeno.example' } })).status, 403);
    const previousOrigin = app.origin;
    await app.stop(); app = await start();
    assert.equal(app.origin, previousOrigin, 'El origen debe conservarse para recuperar el diario IndexedDB de una respuesta local incierta');
    assert.equal((await call('/api/state', { cookie })).json().state.caja.summary.expected, 100.01, 'La sesión y caja local sobreviven al reinicio');
    await page.reload();
    await page.getByText('Solicitud pendiente de confirmación', { exact: true }).waitFor();
    assert.deepEqual(await journal(), uncertain, 'El reinicio recupera los mismos UUID y bytes pendientes');
    assert.equal(packets.length, 1, 'La recarga no vuelve a enviar la apertura por su cuenta');
    await page.getByRole('button', { name: 'Reintentar solicitud', exact: true }).click();
    await page.getByText('Solicitud pendiente de confirmación', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await journal(), null);
    assert.deepEqual(packets, [packets[0], packets[0]], 'La confirmación recuperada usa la clave idempotente original');
    assert.equal((await call('/api/desktop/pending', { cookie })).json().length, 1);
    const localBackup = (await call('/api/backup', { cookie })).json();
    assert.equal(localBackup.tables.turnos_caja.length, 1, 'La respuesta perdida y el reinicio dejan un solo turno');
    assert.equal((await call('/api/state', { cookie })).json().state.caja.summary.expected, 100.01);
    await page.getByRole('button', { name: 'Cerrar caja', exact: true }).waitFor();
    await page.getByRole('button', { name: /Sincronización:.*1 operación pendiente/ }).waitFor();
    assert.equal(await page.getByText('Este equipo · almacenamiento local', { exact: true }).count(), 0);
    const evidence = resolve('dist/verification/desktop');
    await mkdir(evidence, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== dark) await page.getByRole('button', { name: 'Cambiar tema' }).click();
        await page.screenshot({ path: join(evidence, `gateway-caja-${width}-${dark ? 'oscuro' : 'claro'}.png`), fullPage: true, animations: 'disabled' });
        const control = await page.getByRole('button', { name: /^Sincronización:/ }).boundingBox();
        assert.ok(control.x >= 0 && control.x + control.width <= width, `El control debe caber en ${width}px`);
      }
    }
    assert.equal((await call('/logout', { method: 'POST', body: {}, cookie })).status, 200);
    assert.equal((await call('/api/state', { cookie })).status, 401);
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password: 'incorrecta' } })).status, 401);
    await login();
    cookie = (await context.cookies(app.origin)).filter(item => item.name === 'felix-desktop').map(item => item.name + '=' + item.value).join(';');
    assert.equal((await call('/api/state', { cookie })).json().state.caja.summary.expected, 100.01);
    network = 'revoked';
    const revoked = await call('/api/desktop/sync', { method: 'POST', body: {}, cookie });
    assert.equal(revoked.json().connection, 'authentication');
    assert.equal((await call('/api/state', { cookie })).status, 401);
    network = 'offline';
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password } })).status, 401, 'Una revocación remota impide acceder con el verificador offline');
    assert.equal(app.engine.ledger.pending().length, 1, 'La revocación conserva las operaciones locales');
    assert.equal(app.engine.ledger.get('remoteCookie'), null);
    network = 'online';
    await login();
    cookie = (await context.cookies(app.origin)).filter(item => item.name === 'felix-desktop').map(item => item.name + '=' + item.value).join(';');
    assert.equal((await call('/api/desktop/sync', { method: 'POST', body: {}, cookie })).json().pending, 0);
    network = 'revoked';
    assert.equal((await call('/api/account', { cookie })).status, 401);
    assert.equal((await call('/api/state', { cookie })).status, 401, 'Un 401 en una API remota autenticada también revoca la sesión local');
    network = 'offline';
    assert.equal((await call('/login', { method: 'POST', body: { username: 'felix', password } })).status, 401);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await app?.stop();
    await auth?.close();
    await pool?.end();
    await database?.stop();
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(directory.includes('felix-desktop-http-'));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
