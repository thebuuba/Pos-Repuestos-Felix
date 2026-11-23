import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';
import { createApp } from '../src/server.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { DesktopEngine } from '../src/desktop/engine.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { desktopServer } from '../src/desktop/server.js';
import { testAuthService } from './fixtures/supabase-auth.js';
import { temporaryPostgres } from './postgres.js';

const origin = 'https://pos.example';
const ownerPassword = 'clave-navegador-sintetica-12345';

async function httpFixture(t, { admin = true, role } = {}) {
  const auth = await testAuthService({ role });
  t.after(auth.close);
  const hosting = hostingConfig({
    ...auth.env,
    PUBLIC_ORIGIN: origin,
    ...(admin && { SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
  });
  const call = (path, { body, method = body ? 'POST' : 'GET', cookie = '', headers = {} } = {}) =>
    handleRequest(new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        'X-Forwarded-Proto': 'https',
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }), {
      hosting,
      readAsset: () => 'asset',
      pool: { connect: () => assert.fail('La administración de usuarios no debe tocar la base de operaciones.') },
    });
  const login = async (username, password) => {
    const res = await call('/login', { body: { username, password } });
    return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const ownerLogin = await login('felix', ownerPassword);
  assert.equal(ownerLogin.status, 200);
  return { call, login, ownerCookie: ownerLogin.cookie, hosting };
}

test('API /api/usuarios: CRUD completo, restablecimiento de clave, desactivación inmediata y anti-bloqueo', async t => {
  const { call, login, ownerCookie } = await httpFixture(t);

  // Sin sesión -> 401
  assert.equal((await call('/api/usuarios')).status, 401);

  // Listado inicial con el dueño actual
  const initialRes = await call('/api/usuarios', { cookie: ownerCookie });
  assert.equal(initialRes.status, 200);
  assert.equal(initialRes.headers.get('cache-control'), 'no-store');
  const initialBody = await initialRes.json();
  assert.equal(initialBody.available, true);
  assert.equal(initialBody.users.length, 1);
  assert.equal(initialBody.users[0].username, 'felix');
  assert.equal(initialBody.users[0].role, 'dueno');
  assert.equal(initialBody.users[0].active, true);
  assert.equal(initialBody.users[0].isSelf, true);

  // Validaciones de entrada y CSRF
  assert.equal((await call('/api/usuarios', {
    cookie: ownerCookie,
    headers: { Origin: 'https://ajeno.example' },
    body: { username: 'caja1', password: 'clave-valida', role: 'cajero' },
  })).status, 403);
  for (const invalidBody of [
    { username: 'a', password: 'clave-valida', role: 'cajero' },
    { username: 'caja..1', password: 'clave-valida', role: 'cajero' },
    { username: 'caja1', password: '123', role: 'cajero' },
    { username: 'caja1', password: 'clave-valida', role: 'admin' },
    { username: 'caja1', password: 'clave-valida', role: 'cajero', extra: true },
  ]) {
    assert.equal((await call('/api/usuarios', { cookie: ownerCookie, body: invalidBody })).status, 400);
  }

  // Crear cajero
  const createRes = await call('/api/usuarios', {
    cookie: ownerCookie,
    body: { username: ' Caja.Maria ', displayName: 'María López', password: 'clave-maria-1', role: 'cajero' },
  });
  assert.equal(createRes.status, 201);
  const { user: maria } = await createRes.json();
  assert.equal(maria.username, 'caja.maria');
  assert.equal(maria.displayName, 'María López');
  assert.equal(maria.role, 'cajero');
  assert.equal(maria.active, true);
  assert.equal(maria.isSelf, false);

  // Duplicado -> 400
  assert.equal((await call('/api/usuarios', {
    cookie: ownerCookie,
    body: { username: 'caja.maria', password: 'clave-maria-2', role: 'cajero' },
  })).status, 400);

  // Cajero puede iniciar sesión, pero NO puede administrar usuarios (403)
  const mariaLogin = await login('caja.maria', 'clave-maria-1');
  assert.equal(mariaLogin.status, 200);
  assert.equal((await call('/api/usuarios', { cookie: mariaLogin.cookie })).status, 403);
  assert.equal((await call('/api/usuarios', {
    cookie: mariaLogin.cookie,
    body: { username: 'otro', password: 'clave-otra-1', role: 'cajero' },
  })).status, 403);
  assert.equal((await call('/api/usuarios/' + maria.id, {
    cookie: mariaLogin.cookie,
    method: 'PUT',
    body: { role: 'dueno' },
  })).status, 403);

  // Protección anti-bloqueo: dueño no puede autodesactivarse ni bajarse su propio rol
  assert.equal((await call('/api/usuarios/fixture-user', {
    cookie: ownerCookie,
    method: 'PUT',
    body: { active: false },
  })).status, 400);
  assert.equal((await call('/api/usuarios/fixture-user', {
    cookie: ownerCookie,
    method: 'PUT',
    body: { role: 'cajero' },
  })).status, 400);

  // Editar nombre visible y rol a dueño
  const editRes = await call('/api/usuarios/' + maria.id, {
    cookie: ownerCookie,
    method: 'PUT',
    body: { displayName: 'María Pérez', role: 'dueno' },
  });
  assert.equal(editRes.status, 200);
  const { user: mariaOwner } = await editRes.json();
  assert.equal(mariaOwner.displayName, 'María Pérez');
  assert.equal(mariaOwner.role, 'dueno');

  // Restablecer contraseña: clave vieja falla, clave nueva entra
  const resetRes = await call('/api/usuarios/' + maria.id, {
    cookie: ownerCookie,
    method: 'PUT',
    body: { newPassword: 'clave-maria-nueva' },
  });
  assert.equal(resetRes.status, 200);
  assert.equal((await login('caja.maria', 'clave-maria-1')).status, 401);
  const mariaNewLogin = await login('caja.maria', 'clave-maria-nueva');
  assert.equal(mariaNewLogin.status, 200);

  // Desactivar usuario: revoca acceso inmediato en sesión activa y en login
  const disableRes = await call('/api/usuarios/' + maria.id, {
    cookie: ownerCookie,
    method: 'PUT',
    body: { active: false },
  });
  assert.equal(disableRes.status, 200);
  assert.equal((await disableRes.json()).user.active, false);
  assert.equal((await call('/api/account', { cookie: mariaNewLogin.cookie })).status, 401);
  assert.equal((await login('caja.maria', 'clave-maria-nueva')).status, 401);

  // Reactivar usuario: vuelve a poder entrar
  const enableRes = await call('/api/usuarios/' + maria.id, {
    cookie: ownerCookie,
    method: 'PUT',
    body: { active: true },
  });
  assert.equal(enableRes.status, 200);
  assert.equal((await enableRes.json()).user.active, true);
  assert.equal((await login('caja.maria', 'clave-maria-nueva')).status, 200);
});

test('API /api/usuarios sin SUPABASE_SECRET_KEY informa no disponible sin romper', async t => {
  const { call, ownerCookie } = await httpFixture(t, { admin: false });
  const listRes = await call('/api/usuarios', { cookie: ownerCookie });
  assert.equal(listRes.status, 200);
  const data = await listRes.json();
  assert.equal(data.available, false);
  assert.deepEqual(data.users, []);
  assert.match(data.reason, /SUPABASE_SECRET_KEY/);

  assert.equal((await call('/api/usuarios', {
    cookie: ownerCookie,
    body: { username: 'caja1', password: 'clave-valida', role: 'cajero' },
  })).status, 503);
});

test('Windows desktop/server.js reenvía /api/usuarios en línea, bloquea cajero y degrada limpio sin conexión', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-desktop-users-'));
  const ledger = new DesktopLedger(dir);
  const engine = new DesktopEngine(ledger);

  let online = true;
  let activeRole = 'dueno';
  const calls = [];
  const remote = {
    cookie: 'remote-cookie',
    clear() { this.cookie = ''; },
    async request(path, options = {}) {
      calls.push({ path, method: options.method || 'GET', body: options.body });
      if (!online) throw Object.assign(new Error('Sin conexión'), { status: 503 });
      if (path === '/login') return { redirect: '/ventas' };
      if (path === '/api/account') return { id: 'u-1', username: activeRole, role: activeRole };
      if (path === '/api/sync/bootstrap') {
        return {
          snapshot: { databaseId: '11111111-1111-4111-8111-111111111111', revision: 1, state: { productos: [] } },
          backup: null,
        };
      }
      if (path === '/api/usuarios' && (!options.method || options.method === 'GET')) {
        return { available: true, users: [{ id: 'u-1', username: 'felix', displayName: '', role: 'dueno', active: true, isSelf: true }] };
      }
      if (path === '/api/usuarios' && options.method === 'POST') {
        return { user: { id: 'u-2', username: options.body.username, displayName: options.body.displayName || '', role: options.body.role, active: true, isSelf: false } };
      }
      if (path === '/api/usuarios/u-2' && options.method === 'PUT') {
        return { user: { id: 'u-2', username: 'caja1', displayName: 'Caja 1', role: 'cajero', active: false, isSelf: false } };
      }
      throw Object.assign(new Error('No encontrado'), { status: 404 });
    },
  };
  engine.adopt = async () => { engine.pool = { end: async () => {} }; };
  engine.synchronize = async () => engine.status();

  const srv = desktopServer(engine, remote, dir);
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise(done => srv.close(done));
    await engine.close?.();
    await rm(dir, { recursive: true, force: true });
  });

  const localOrigin = 'http://127.0.0.1:' + srv.address().port;
  const req = (path, { method = 'GET', body, cookie = '' } = {}) => fetch(localOrigin + path, {
    method,
    headers: {
      Origin: localOrigin,
      Cookie: cookie,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const loginRes = await req('/login', { method: 'POST', body: { username: 'felix', password: ownerPassword } });
  assert.equal(loginRes.status, 200);
  const ownerCookie = loginRes.headers.get('set-cookie').split(';')[0];

  // Dueño en línea
  const listOnline = await req('/api/usuarios', { cookie: ownerCookie });
  assert.equal(listOnline.status, 200);
  assert.equal((await listOnline.json()).users.length, 1);

  const postOnline = await req('/api/usuarios', {
    method: 'POST',
    cookie: ownerCookie,
    body: { username: 'caja1', displayName: 'Caja 1', password: 'clave-valida', role: 'cajero' },
  });
  assert.equal(postOnline.status, 201);

  const putOnline = await req('/api/usuarios/u-2', {
    method: 'PUT',
    cookie: ownerCookie,
    body: { active: false },
  });
  assert.equal(putOnline.status, 200);

  // Dueño sin conexión
  online = false;
  const listOffline = await req('/api/usuarios', { cookie: ownerCookie });
  assert.equal(listOffline.status, 200);
  const offlineBody = await listOffline.json();
  assert.equal(offlineBody.available, false);
  assert.equal(offlineBody.offline, true);

  const postOffline = await req('/api/usuarios', {
    method: 'POST',
    cookie: ownerCookie,
    body: { username: 'caja2', password: 'clave-valida', role: 'cajero' },
  });
  assert.equal(postOffline.status, 503);

  // Cajero bloqueado con 403
  online = true;
  activeRole = 'cajero';
  const cajeroLogin = await req('/login', { method: 'POST', body: { username: 'cajero', password: ownerPassword } });
  const cajeroCookie = cajeroLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await req('/api/usuarios', { cookie: cajeroCookie })).status, 403);
});

test('E2E navegador: pestaña Usuarios en Configuración (crear, editar, clave, desactivar/reactivar, móvil 390px y bloqueo cajero)', { timeout: 180000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-users-ui-'));
    await buildOperational(directory);
    server = await createApp(pool, {
      hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
      assetsDirectory: pathToFileURL(directory + sep),
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const appOrigin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'msedge', headless: true });

    // 1. Dueño en escritorio 1440×1000
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO' });
    const loginRes = await context.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'felix', password: ownerPassword },
    });
    assert.equal(loginRes.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(appOrigin + '/configuracion');
    await page.getByRole('heading', { name: 'Configuración', exact: true }).waitFor();
    const usersTab = page.getByRole('tab', { name: 'Usuarios', exact: true });
    assert.equal(await usersTab.count(), 1);
    await usersTab.click();
    await page.getByRole('heading', { name: 'Usuarios del sistema', exact: true }).waitFor();

    // Verifica que aparece felix con badge Tú y botón Desactivar deshabilitado
    const felixRow = page.locator('tbody tr', { hasText: 'felix' });
    await felixRow.waitFor();
    assert.equal(await felixRow.getByRole('button', { name: 'Desactivar', exact: true }).isDisabled(), true);

    // Crear usuario nuevo (maria, Cajero)
    await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Usuario', { exact: true }).fill('maria');
    await createDialog.getByLabel('Nombre visible (opcional)', { exact: true }).fill('María López');
    await createDialog.getByLabel('Contraseña inicial', { exact: true }).fill('clave-maria-123');
    await createDialog.getByLabel('Confirmar contraseña', { exact: true }).fill('clave-maria-123');
    await createDialog.getByRole('button', { name: 'Crear usuario', exact: true }).click();
    await createDialog.waitFor({ state: 'hidden' });

    const mariaRow = page.locator('tbody tr', { hasText: 'maria' });
    await mariaRow.waitFor();
    assert.match(await mariaRow.innerText(), /María López/);
    assert.match(await mariaRow.innerText(), /Cajero/);
    assert.match(await mariaRow.innerText(), /Activo/);

    // Editar nombre visible de maria
    await mariaRow.getByRole('button', { name: 'Editar', exact: true }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Nombre visible (opcional)', { exact: true }).fill('María Pérez');
    await editDialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await editDialog.waitFor({ state: 'hidden' });
    assert.match(await mariaRow.innerText(), /María Pérez/);

    // Restablecer contraseña de maria
    await mariaRow.getByRole('button', { name: 'Clave', exact: true }).click();
    const resetDialog = page.getByRole('dialog');
    await resetDialog.getByLabel('Nueva contraseña', { exact: true }).fill('clave-maria-456');
    await resetDialog.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('clave-maria-456');
    await resetDialog.getByRole('button', { name: 'Actualizar contraseña', exact: true }).click();
    await resetDialog.waitFor({ state: 'hidden' });

    // Desactivar y reactivar maria
    await mariaRow.getByRole('button', { name: 'Desactivar', exact: true }).click();
    const disableDialog = page.getByRole('dialog');
    await disableDialog.getByRole('button', { name: 'Desactivar acceso', exact: true }).click();
    await disableDialog.waitFor({ state: 'hidden' });
    assert.match(await mariaRow.innerText(), /Desactivado/);

    const evidence = resolve('dist/verification/usuarios');
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'usuarios-1440-light.png'), fullPage: true });

    // Reactivar maria para probar inicio de sesión como cajero
    await mariaRow.getByRole('button', { name: 'Reactivar', exact: true }).click();
    const enableDialog = page.getByRole('dialog');
    await enableDialog.getByRole('button', { name: 'Reactivar acceso', exact: true }).click();
    await enableDialog.waitFor({ state: 'hidden' });
    assert.match(await mariaRow.innerText(), /Activo/);

    // Tema oscuro + móvil 390×844 sin desbordamiento horizontal
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `Desbordamiento horizontal en 390px: ${overflow}px`);
    await page.screenshot({ path: join(evidence, 'usuarios-390-dark.png'), fullPage: true });

    await context.close();

    // 2. Cajero (maria con su nueva contraseña) NO ve la pestaña Usuarios
    const cashierCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-DO' });
    const cashierLogin = await cashierCtx.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'maria', password: 'clave-maria-456' },
    });
    assert.equal(cashierLogin.status(), 200);
    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto(appOrigin + '/configuracion');
    await cashierPage.getByRole('heading', { name: 'Configuración', exact: true }).waitFor();
    assert.equal(await cashierPage.getByRole('tab', { name: 'Usuarios', exact: true }).count(), 0);
    assert.equal(await cashierPage.getByRole('tab', { name: 'Mi cuenta', exact: true }).count(), 1);
    await cashierCtx.close();

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    await auth?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    await pool?.end();
    await database?.stop();
  }
});
