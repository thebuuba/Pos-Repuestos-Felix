import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { testAuthService } from './fixtures/supabase-auth.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';
import { buildOperational } from '../scripts/build-operational.mjs';

test('Configuración permite cambiar la cuenta real sin guardar credenciales en el diario local', { timeout: 120000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-account-'));
    await buildOperational(directory);
    server = await createApp(pool, { hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
      assetsDirectory: pathToFileURL(directory + sep) });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-DO' });
    const login = await context.request.post(origin + '/login', { headers: { Origin: origin },
      data: { username: 'felix', password: 'clave-navegador-sintetica-12345' } });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/configuracion');
    await page.getByRole('heading', { name: 'Configuración', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Mi cuenta', exact: true }).count(), 1);
    await page.getByRole('tab', { name: 'Mi cuenta', exact: true }).click();
    await page.getByLabel('Usuario', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Usuario', { exact: true }).inputValue(), 'felix');
    await page.getByLabel('Usuario', { exact: true }).fill('nuevo.felix');
    await page.getByLabel('Contraseña actual', { exact: true }).fill('incorrecta');
    await page.getByRole('button', { name: 'Guardar mi cuenta', exact: true }).click();
    await page.getByRole('alert').getByText(/La contraseña actual no es correcta/).waitFor();
    await page.route('**/api/account', route => route.request().method() === 'PUT' ? route.abort('connectionfailed') : route.continue());
    await page.getByLabel('Contraseña actual', { exact: true }).fill('clave-navegador-sintetica-12345');
    await page.getByRole('button', { name: 'Guardar mi cuenta', exact: true }).click();
    await page.getByRole('alert').getByText(/No se pudo confirmar el cambio/).waitFor();
    assert.equal(await page.getByLabel('Contraseña actual', { exact: true }).inputValue(), '');
    await page.unroute('**/api/account');
    await page.getByLabel('Contraseña actual', { exact: true }).fill('clave-navegador-sintetica-12345');
    await page.getByLabel('Nueva contraseña', { exact: true }).fill('123456');
    await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('no-coincide');
    await page.getByRole('button', { name: 'Guardar mi cuenta', exact: true }).click();
    await page.getByRole('alert').getByText('Las contraseñas nuevas no coinciden.', { exact: true }).waitFor();
    const evidence = resolve('dist/verification/account');
    await mkdir(evidence, { recursive: true });
    const styles = [];
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const dark of [false, true]) {
        if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== dark) {
          await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Cuenta ${width} ${dark}`);
        await page.screenshot({ path: join(evidence, `cuenta-${width}-${dark ? 'oscuro' : 'claro'}.png`), fullPage: true, animations: 'disabled' });
        styles.push({ width, dark, input: await page.getByLabel('Usuario', { exact: true }).evaluate(element => {
          const style = getComputedStyle(element);
          return { card: style.getPropertyValue('--card'), background: style.backgroundColor, color: style.color, radius: style.borderRadius };
        }) });
      }
    }
    await writeFile(join(evidence, 'styles.json'), JSON.stringify(styles, null, 2));
    await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('123456');
    await page.getByLabel('Contraseña actual', { exact: true }).fill('clave-navegador-sintetica-12345');
    const pending = Promise.withResolvers();
    let requests = 0;
    await page.route('**/api/account', async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      requests++;
      await pending.promise;
      return route.continue();
    });
    try {
      await page.getByRole('button', { name: 'Guardar mi cuenta', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmando…', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Usuario', { exact: true }).isDisabled(), true);
      assert.ok(page.url().endsWith('/configuracion'));
      assert.equal(requests, 1);
    } finally { pending.resolve(); }
    await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
    const stored = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      const rows = [];
      for (const { name } of databases) {
        const db = await new Promise((done, reject) => { const request = indexedDB.open(name); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
        try {
          for (const name of db.objectStoreNames) rows.push(await new Promise((done, reject) => {
            const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error);
          }));
        } finally { db.close(); }
      }
      return JSON.stringify({ rows, local: { ...localStorage }, session: { ...sessionStorage } });
    });
    for (const secret of ['clave-navegador-sintetica-12345', '123456', 'sb_secret_fixture']) assert.equal(stored.includes(secret), false);
    await page.getByLabel('Usuario', { exact: true }).fill('nuevo.felix');
    await page.getByLabel('Contraseña', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Entrar al sistema' }).click();
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    await auth?.close();
    await pool?.end();
    await database?.stop();
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(directory.startsWith(join(tmpdir(), 'felix-account-')));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
