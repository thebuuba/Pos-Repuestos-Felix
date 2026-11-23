import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { serveDesign } from '../scripts/serve-design.mjs';

let directory, browser, server;
const initial = { initialized: true, connection: 'offline', lastSync: '2026-11-22T12:30:00.000Z', pending: 2, conflict: null, error: null, deviceId: 'equipo-sintetico' };
const reference = '1a2b3c4d-0000-4000-8000-123456789abc';
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'felix-desktop-ui-'));
  await build({ stdin: { contents: `import { createRoot } from 'react-dom/client';
    import { DesktopSyncStatus } from './frontend/src/desktop-status.jsx';
    import './frontend/src/styles/theme.css'; import './frontend/src/styles/standards.css';
    createRoot(document.getElementById('root')).render(<DesktopSyncStatus onSync={() => { window.catalogRefreshes = (window.catalogRefreshes || 0) + 1; }}/>);`,
    loader: 'jsx', resolveDir: process.cwd() }, outfile: path.join(directory, 'app.js'),
    bundle: true, format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  await mkdir(path.join(directory, 'api/desktop'), { recursive: true });
  await writeFile(path.join(directory, 'api/desktop/export'), JSON.stringify({ operations: [{ reference }] }));
  server = await serveDesign(directory, 0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close(); await server?.close();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-desktop-ui-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup(t, desktop = true, status = initial) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  t.after(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.clock.install();
  await page.addInitScript(value => { window.__FELIX_DESKTOP__ = value; }, desktop);
  const packets = [];
  const state = { status, rows: [], fail: false };
  await page.route('**/api/desktop/**', async route => {
    packets.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), body: route.request().postData() });
    const target = new URL(route.request().url()).pathname;
    if (target.endsWith('/status')) return route.fulfill({ status: state.fail ? 503 : 200, json: state.fail ? { error: 'Servicio local no disponible' } : state.status });
    if (target.endsWith('/pending')) return route.fulfill({ json: state.rows });
    return route.fulfill({ json: {} });
  });
  await page.goto(server.origin + '/');
  return { page, state, packets };
}

test('la web no muestra el control Windows ni consulta sus rutas', async t => {
  const { page, packets } = await setup(t, false);
  assert.equal(await page.getByText('Este equipo · almacenamiento local', { exact: true }).count(), 0);
  assert.deepEqual(packets, []);
});

test('el estado saludable queda en un botón y los detalles sólo se abren al solicitarlo', async t => {
  const { page, packets } = await setup(t, true, { ...initial, connection: 'online', pending: 0 });
  const trigger = page.getByRole('button', { name: 'Sincronización: Al día', exact: true });
  await trigger.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByText('Este equipo · almacenamiento local', { exact: true }).count(), 0);
  assert.equal(packets.some(packet => packet.path.endsWith('/pending')), false);
  assert.ok((await trigger.boundingBox()).height <= 40);
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/Última sincronización/).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.clock.runFor(100);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
});

test('sin internet el control indica pendientes y abre la antigüedad de los datos', async t => {
  const { page } = await setup(t);
  const trigger = page.getByRole('button', { name: 'Sincronización: Sin conexión, 2 operaciones pendientes', exact: true });
  await trigger.waitFor();
  assert.match(await trigger.getAttribute('title'), /Inventario y saldos sin actualizar/);
  await trigger.click();
  const details = await page.getByRole('dialog').innerText();
  assert.match(details, /2 operaciones pendientes/);
  assert.match(details, /inventario y los saldos pueden estar desactualizados/);
  assert.match(details, /22\/11\/26|22\/11\/2026/);
  assert.match(details, /se conservan en este equipo/);
});

test('la comprobación inicial conserva la última hora y el sondeo muestra la confirmación sin pulsar sincronizar', async t => {
  const { page, state, packets } = await setup(t, true, { ...initial, connection: 'checking', pending: 0 });
  const trigger = page.getByRole('button', { name: 'Sincronización: Comprobando…', exact: true });
  await trigger.waitFor();
  assert.match(await trigger.locator('svg').getAttribute('class'), /animate-spin/);
  assert.match(await trigger.getAttribute('title'), /22\/11\/26|22\/11\/2026/);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Comprobando…', { exact: true }).waitFor();
  if (process.env.FELIX_DESKTOP_EVIDENCE_DIR) {
    await mkdir(process.env.FELIX_DESKTOP_EVIDENCE_DIR, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
        await dialog.screenshot({ path: path.join(process.env.FELIX_DESKTOP_EVIDENCE_DIR, `checking-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
      }
    }
  }
  state.status = { ...state.status, connection: 'online', lastSync: '2026-11-23T17:22:00.000Z' };
  await page.clock.runFor(15_100);
  await dialog.getByText('Al día', { exact: true }).waitFor();
  assert.match(await dialog.getByText(/Última sincronización/).innerText(), /23\/11\/26.*1:22/);
  assert.equal(packets.some(packet => packet.method !== 'GET'), false);
  assert.equal(await page.evaluate(() => window.catalogRefreshes), 1);
});

test('sincronizar envía una solicitud y espera un estado confirmado antes de quitar pendientes', async t => {
  const { page, state } = await setup(t);
  const gate = Promise.withResolvers();
  const requests = [];
  await page.route('**/api/desktop/sync', async route => {
    requests.push(route.request()); await gate.promise;
    state.status = { ...initial, connection: 'online', pending: 0, lastSync: '2026-11-22T14:00:00Z' };
    await route.fulfill({ json: state.status });
  });
  await page.getByRole('button', { name: /^Sincronización:/ }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Sincronizando…', exact: true }).isDisabled(), true);
  assert.match(await page.locator('#root').innerText(), /2 operaciones pendientes/);
  gate.resolve();
  await page.getByRole('dialog').getByText('Sin operaciones pendientes.', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method(), 'POST');
  assert.deepEqual(requests[0].postDataJSON(), {});
  assert.equal(await page.evaluate(() => window.catalogRefreshes), 1);
});

test('el conflicto se conserva visible y la lista permite exportar sin sobrescribir', async t => {
  const { page, state, packets } = await setup(t, true, { ...initial, connection: 'conflict', conflict: 'Existencias del servidor insuficientes' });
  state.rows = [{ reference, date: '2026-11-22T14:00:00Z', operation: 'Venta', status: 'conflict', error: 'Existencias del servidor insuficientes', total: '10.25' }];
  await page.getByRole('button', { name: 'Sincronización: Revisar sincronización, 2 operaciones pendientes', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Venta', { exact: true }).waitFor();
  assert.equal(await dialog.getByText(reference, { exact: true }).count(), 0, 'El identificador técnico se conserva en la exportación, no en la interfaz');
  assert.match(await dialog.innerText(), /10\.25/);
  assert.match(await dialog.innerText(), /no se sobrescriben automáticamente/);
  await page.route('**/api/desktop/export', route => route.continue());
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Descargar operaciones', exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'operaciones-pendientes-felix.json');
  assert.equal(JSON.parse(await readFile(await download.path(), 'utf8')).operations[0].reference, reference);
  assert.equal(packets.some(packet => packet.method !== 'GET'), false);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= 375);
  if (process.env.FELIX_DESKTOP_EVIDENCE_DIR) {
    await mkdir(process.env.FELIX_DESKTOP_EVIDENCE_DIR, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        await page.screenshot({ path: path.join(process.env.FELIX_DESKTOP_EVIDENCE_DIR, `pending-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
      }
    }
  }
});

test('primera descarga y sesión remota vencida muestran instrucciones sin afirmar disponibilidad global', async t => {
  const { page, state } = await setup(t, true, { ...initial, initialized: false, lastSync: null, pending: 0, connection: 'authentication' });
  await page.getByRole('button', { name: 'Sincronización: Iniciar sesión', exact: true }).click();
  await page.getByRole('dialog').getByText(/descargar los datos del negocio antes de trabajar sin conexión/).waitFor();
  state.status = { ...initial, connection: 'authentication' };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('dialog').getByText('2 operaciones pendientes.', { exact: true }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /se conservan en este equipo/);
});

test('el sondeo actualiza pendientes y conserva la última lectura si el estado local falla', async t => {
  const { page, state } = await setup(t);
  await page.getByRole('button', { name: /Sincronización:.*2 operaciones pendientes/ }).waitFor();
  state.status = { ...initial, pending: 3 };
  await page.clock.runFor(15_100);
  await page.getByRole('button', { name: /Sincronización:.*3 operaciones pendientes/ }).waitFor();
  state.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Sincronización: Revisar sincronización, 3 operaciones pendientes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /No se pudo comprobar/ }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /3 operaciones pendientes/);
  assert.equal(await page.getByText('Sin operaciones pendientes', { exact: true }).count(), 0);
});

test('revisar pendientes exige confirmar la lista y conserva acceso al archivo tras el acuse', async t => {
  const { page, state, packets } = await setup(t, true, { ...initial, connection: 'conflict', conflict: 'Precio modificado', pending: 1 });
  const selection = { deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operationIds: [reference],
    operations: [{ reference, date: initial.lastSync, operation: 'Venta', total: '10.25', error: 'Precio modificado' }], resuming: false };
  await page.route('**/api/desktop/reconciliation', route => route.fulfill({ json: selection }));
  let submitted;
  await page.route('**/api/desktop/reconcile', async route => {
    submitted = route.request().postDataJSON();
    state.status = { ...initial, connection: 'online', pending: 0, archived: 1, lastSync: '2026-11-22T15:30:00.000Z' };
    await route.fulfill({ json: state.status });
  });
  await page.getByRole('button', { name: /^Sincronización:/ }).click();
  await page.getByRole('button', { name: 'Revisar pendientes', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Archivar y actualizar', exact: true });
  await confirm.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  assert.equal(submitted, undefined);
  if (process.env.FELIX_DESKTOP_EVIDENCE_DIR) {
    await mkdir(process.env.FELIX_DESKTOP_EVIDENCE_DIR, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        const dialog = page.getByRole('dialog');
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
        await dialog.screenshot({ path: path.join(process.env.FELIX_DESKTOP_EVIDENCE_DIR, `review-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
      }
    }
  }
  await page.getByRole('checkbox', { name: /He revisado/ }).check();
  await confirm.click();
  await page.getByText('1 operación archivada para revisión.', { exact: true }).waitFor();
  assert.deepEqual(submitted, { deviceId: selection.deviceId, databaseId: selection.databaseId, operationIds: selection.operationIds, acknowledged: true });
  assert.equal(await page.getByRole('link', { name: 'Descargar historial de revisión', exact: true }).getAttribute('href'), '/api/desktop/archive');
  assert.equal(packets.some(packet => packet.path.endsWith('/sync')), false);
});

test('una revisión sin acuse mantiene el pendiente y permite reanudarla', async t => {
  const { page, state } = await setup(t, true, { ...initial, connection: 'conflict', conflict: 'Existencias insuficientes', pending: 1 });
  await page.route('**/api/desktop/reconciliation', route => route.fulfill({ json: { deviceId: initial.deviceId, databaseId: 'base-ficticia', operationIds: [reference],
    operations: [{ reference, operation: 'Venta', date: initial.lastSync, total: '10.25' }], resuming: false } }));
  await page.route('**/api/desktop/reconcile', async route => {
    state.status = { ...state.status, reconciling: true };
    await route.fulfill({ status: 503, json: { error: 'La revisión espera confirmación del servidor.' } });
  });
  await page.getByRole('button', { name: /^Sincronización:/ }).click();
  await page.getByRole('button', { name: 'Revisar pendientes', exact: true }).click();
  await page.getByRole('checkbox', { name: /He revisado/ }).check();
  await page.getByRole('button', { name: 'Archivar y actualizar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /revisión espera confirmación/ }).waitFor();
  await page.getByRole('button', { name: 'Reanudar revisión', exact: true }).waitFor();
  assert.equal(await page.getByText('1 operación archivada para revisión.', { exact: true }).count(), 0);
  assert.match(await page.getByRole('dialog').innerText(), /1 operación pendiente/);
});
