import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { CURRENT_BACKUP_VERSION } from '../src/pos/relational-backup.js';
import { temporaryPostgres } from './postgres.js';
import { testAuthService } from './fixtures/supabase-auth.js';

let database, pool, adminPool, auth, assets, server, origin, browser, databaseId, customerId, supplierId, productId;

before(async () => {
  database = await temporaryPostgres();
  adminPool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(adminPool);
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  auth = await testAuthService();
  assets = await mkdtemp(path.join(tmpdir(), 'felix-reminders-'));
  await buildOperational(assets);
  server = await createApp(pool, {
    hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
    assetsDirectory: pathToFileURL(assets + path.sep),
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // Login as owner to seed customer, supplier, product, and cashier user
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
  const loginRes = await ctx.request.post(origin + '/login', {
    headers: { Origin: origin },
    data: { username: 'felix', password: 'clave-navegador-sintetica-12345' },
  });
  assert.equal(loginRes.status(), 200);
  const state0 = await (await ctx.request.get(origin + '/api/state')).json();
  databaseId = state0.databaseId;

  const post = async (resource, body) => {
    const res = await ctx.request.post(origin + '/api/' + resource, {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: { databaseId, ...body },
    });
    assert.equal(res.status(), 200, await res.text());
    return res.json();
  };
  customerId = (await post('clientes', { nombre: 'Taller Don Julio', tel: '809-555-1111' })).result.id;
  supplierId = (await post('suplidores', { nombre: 'Importadora Cibao SRL', tel: '809-555-2222', diasCredito: 15 })).result.id;
  productId = (await post('productos', {
    codigo: 'REM-001', nombre: 'Goma Trasera 2.75-18', costo: '100', precio1: '200', precio2: '180', precio3: '180', stock: '5',
  })).result.id;
  const cashierRes = await ctx.request.post(origin + '/api/usuarios', {
    headers: { Origin: origin },
    data: { username: 'cajerorem', displayName: 'Carlos Cajero', password: 'clave-cajero-123', role: 'cajero' },
  });
  assert.equal(cashierRes.status(), 201);
  await ctx.close();
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  await auth?.close();
  await pool?.end();
  await adminPool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    await rm(assets, { recursive: true, force: true });
  }
});

test('Recordatorios E2E: API idempotente, concurrencia, permisos cajero/dueño, respaldo v11/v10, offline SQLite y UI + campana', { timeout: 120000 }, async (t) => {
  const ownerCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
  const cashierCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
  t.after(async () => {
    await ownerCtx.close();
    await cashierCtx.close();
  });

  await ownerCtx.request.post(origin + '/login', {
    headers: { Origin: origin },
    data: { username: 'felix', password: 'clave-navegador-sintetica-12345' },
  });
  await cashierCtx.request.post(origin + '/login', {
    headers: { Origin: origin },
    data: { username: 'cajerorem', password: 'clave-cajero-123' },
  });

  // 1. Cajero puede crear, editar, completar y eliminar recordatorios compartidos
  const idemKey = randomUUID();
  const createRes = await cashierCtx.request.post(origin + '/api/recordatorios', {
    headers: { Origin: origin, 'Idempotency-Key': idemKey },
    data: {
      databaseId,
      titulo: 'Llamar a Taller Don Julio por goma',
      nota: 'Confirmar si pasa antes de las 5pm',
      fechaLimite: '2026-10-01',
      horaLimite: '09:30',
      prioridad: 'alta',
      clienteId: customerId,
      productoId: productId,
    },
  });
  assert.equal(createRes.status(), 200, await createRes.text());
  const created = await createRes.json();
  const remId = created.result.id;
  assert.equal(created.state.recordatorios.length, 1);
  assert.equal(created.state.recordatorios[0].creadoPor, 'cajerorem');

  // Reintento idempotente con la misma clave devuelve el mismo registro sin duplicar
  const replayRes = await cashierCtx.request.post(origin + '/api/recordatorios', {
    headers: { Origin: origin, 'Idempotency-Key': idemKey },
    data: {
      databaseId,
      titulo: 'Llamar a Taller Don Julio por goma',
      nota: 'Confirmar si pasa antes de las 5pm',
      fechaLimite: '2026-10-01',
      horaLimite: '09:30',
      prioridad: 'alta',
      clienteId: customerId,
      productoId: productId,
    },
  });
  assert.equal(replayRes.status(), 200);
  assert.equal((await replayRes.json()).result.id, remId);

  // Concurrencia optimista: versión incorrecta devuelve 409
  const conflictRes = await ownerCtx.request.put(origin + '/api/recordatorios/' + remId, {
    headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
    data: { databaseId, version: 99, estado: 'completado' },
  });
  assert.equal(conflictRes.status(), 409);

  // 2. Respaldo v11 incluye recordatorios y negociación v10 sigue funcionando para clientes Windows anteriores
  const backupV11 = await (await ownerCtx.request.get(origin + '/api/backup')).json();
  assert.equal(backupV11.version, CURRENT_BACKUP_VERSION);
  assert.equal(backupV11.version, 11);
  assert.equal(backupV11.tables.recordatorios.length, 1);
  const bootV10 = await readSyncBootstrap(adminPool, 'Nube', undefined, { backupVersion: 10 });
  assert.equal(bootV10.backup.version, 10);
  assert.equal(bootV10.backup.tables.recordatorios, undefined);

  // 3. Offline SQLite en Windows: crear y completar recordatorio sin internet y sincronizar sin duplicados
  const dir = await mkdtemp(path.join(tmpdir(), 'felix-desktop-rem-'));
  const actor = { id: randomUUID(), name: 'Dueño Desktop' };
  const remote = (reqPath, opts) => reqPath === '/api/sync/bootstrap'
    ? readSyncBootstrap(adminPool, 'Nube')
    : writeSyncOperation(adminPool, opts.body, 'Nube', actor);
  const engine = new DesktopEngine(new DesktopLedger(dir));
  t.after(async () => {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  });
  await engine.adopt(await remote('/api/sync/bootstrap'));
  const snapLocal = await engine.snapshot();
  assert.equal(snapLocal.state.recordatorios.length, 1);
  const offCreate = await engine.write('POST', '/api/recordatorios', {
    databaseId: snapLocal.databaseId,
    titulo: 'Pedir gomas a Importadora Cibao',
    nota: 'Cotizar 10 unidades 2.75-18',
    fechaLimite: '2026-12-30',
    horaLimite: '',
    prioridad: 'media',
    suplidorId: supplierId,
  }, randomUUID(), actor);
  await engine.write('PUT', '/api/recordatorios/' + offCreate.result.id, {
    databaseId: snapLocal.databaseId,
    version: 1,
    estado: 'completado',
  }, randomUUID(), actor);
  const syncResult = await engine.synchronize(remote, actor);
  assert.equal(syncResult.pending, 0, JSON.stringify(syncResult));
  assert.equal(syncResult.conflict, null);

  // 4. UI en navegador (dueño): ver aviso vencido en campana, navegar a /recordatorios, crear, completar y eliminar
  const page = await ownerCtx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/');
  await page.getByRole('heading', { name: 'Panel', exact: true }).waitFor();

  // Abrir campana superior y comprobar alerta de recordatorio vencido
  await page.getByRole('button', { name: /Notificaciones/i }).click();
  await page.getByText(/1 recordatorio vencido/i).waitFor();
  await page.getByRole('button', { name: 'Ver recordatorios' }).click();
  await page.getByRole('heading', { name: 'Recordatorios', exact: true }).waitFor();
  await page.getByText('Llamar a Taller Don Julio por goma').waitFor();
  await page.getByRole('link', { name: 'Taller Don Julio' }).waitFor();
  await page.getByRole('link', { name: /REM-001/ }).waitFor();

  // Crear un nuevo recordatorio desde el Sheet vinculado a un suplidor
  await page.getByRole('button', { name: 'Nuevo recordatorio' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Título').fill('Revisar factura pendiente');
  await sheet.getByLabel('Nota o detalle').fill('Verificar precios de lista antes de pagar');
  await sheet.getByRole('button', { name: 'Alta', exact: true }).click();
  await sheet.getByRole('button', { name: 'Hoy', exact: true }).click();
  await sheet.getByRole('button', { name: 'Suplidor', exact: true }).click();
  await sheet.getByRole('button', { name: /Importadora Cibao SRL/ }).click();
  await sheet.getByRole('button', { name: 'Crear recordatorio' }).click();
  await sheet.waitFor({ state: 'hidden' });

  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Pendientes', exact: true }).click();
  await main.getByText('Revisar factura pendiente').waitFor();

  // Marcar completado de 1 clic y comprobar que aparece en Completados
  await main.getByRole('button', { name: 'Marcar completado: Revisar factura pendiente' }).click();
  await main.getByRole('button', { name: 'Completados', exact: true }).click();
  await main.getByText('Revisar factura pendiente').waitFor();
  await main.getByText('Pedir gomas a Importadora Cibao').waitFor();

  // Eliminar recordatorio y confirmar desaparición
  await main.getByRole('button', { name: 'Eliminar Revisar factura pendiente' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Confirmar|Eliminar/i }).click();
  await main.getByText('Revisar factura pendiente').waitFor({ state: 'hidden' });

  assert.deepEqual(errors, []);
});
