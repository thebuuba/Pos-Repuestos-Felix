import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { temporaryPostgres } from './postgres.js';

const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));

async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function runEntry({ cwd, databaseUrl, args = [], port }) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, HOST: '127.0.0.1', PORT: port, DATABASE_URL: databaseUrl },
  });
  let stdout = '', stderr = '';
  const closed = new Promise(resolve => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  };
  const started = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('El proceso de prueba no confirmó el inicio. ' + stderr)), 12_000);
    child.stdout.setEncoding('utf8').on('data', text => {
      stdout += text;
      if (stdout.includes('POS disponible en ')) resolve(true);
    });
    child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
    child.once('error', reject);
    child.once('close', () => resolve(false));
    closed.then(() => clearTimeout(timeout));
  }).catch(async error => { await stop(); throw error; });
  return { started, exitCode: child.exitCode, stderr, origin: `http://127.0.0.1:${port}`, stop };
}

test('la entrada operativa requiere un puerto explícito separado del puerto heredado', async () => {
  for (const port of [undefined, 3000]) {
    const result = await runEntry({ args: ['--operational'], port });
    await result.stop();
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /PORT.*(?:nuevo|distinto)/);
  }
});

test('el arranque selecciona activos y se niega a abrir datos incompatibles con la interfaz heredada', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'felix-operational-entry-'));
  let database, admin;
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(child => child.stop()));
    await admin?.end();
    await database?.stop();
    await rm(directory, { recursive: true, force: true });
  });
  database = await temporaryPostgres();
  admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin);
  await admin.query('CREATE ROLE entry_probe LOGIN; GRANT pos_app TO entry_probe');
  const databaseUrl = new URL(database.connectionString);
  databaseUrl.username = 'entry_probe';
  const start = async args => {
    const child = await runEntry({ cwd: directory, databaseUrl: databaseUrl.href, args, port: await freePort() });
    children.push(child);
    return child;
  };
  const rejectLegacy = async label => {
    const legacy = await start();
    await legacy.stop();
    assert.equal(legacy.started, false, label);
    assert.equal(legacy.exitCode, 1, label);
    assert.match(legacy.stderr, /start:operational/, label);
  };

  const missingAssets = await start(['--operational']);
  await missingAssets.stop();
  assert.equal(missingAssets.started, false);
  assert.match(missingAssets.stderr, /pnpm build/);

  await buildOperational(join(directory, 'dist', 'operational'));
  const read = backup => readSnapshot(admin, 'Prueba', backup);
  await writeOperation(admin, 'POST', '/api/productos', {
    databaseId: (await read()).databaseId, codigo: 'RF-1', nombre: 'Control',
    stock: 10, stockMinimo: 2, costo: '999999999999.99', precio1: 15.25, precio2: 0, precio3: 15,
  }, randomUUID(), 'Prueba');
  const compatible = await start();
  assert.equal(compatible.started, true, compatible.stderr);
  assert.match(await (await fetch(compatible.origin + '/')).text(), /\/manifest\.webmanifest/);
  assert.equal((await fetch(compatible.origin + '/sw.js')).status, 200);
  await compatible.stop();

  assert.equal((await read()).state.catalogo.importada, false);
  for (const [label, update, undo] of [
    ['existencia fraccionada', 'stock=10.25', 'stock=10'],
    ['mínimo fraccionado', 'stock_minimo=2.25', 'stock_minimo=2'],
    ['costo subcentavo en el límite', 'costo=999999999999.9898', 'costo=999999999999.99'],
    ['tarifa subcentavo', 'precio2=15.001', 'precio2=0'],
    ['código con espacios', "codigo='RF 1'", "codigo='RF-1'"],
  ]) {
    await admin.query('UPDATE productos SET ' + update);
    await rejectLegacy(label);
    await admin.query('UPDATE productos SET ' + undo);
  }
  await admin.query("INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3) VALUES ('rf-1','Otro',0,0,0,0)");
  await rejectLegacy('colisión por mayúsculas');
  await admin.query("DELETE FROM productos WHERE codigo='rf-1'");

  await admin.query(`INSERT INTO pos_privado.netpos_importaciones (huella,database_id,categorias,marcas,ubicaciones,unidades)
    SELECT repeat('a',64),database_id,'{}','{}','{}','{}' FROM pos_privado.sistema`);
  assert.equal((await read()).state.catalogo.importada, true);
  await rejectLegacy('generación importada con números compatibles');

  const operational = await start(['--operational']);
  assert.equal(operational.started, true, operational.stderr);
  const html = await (await fetch(operational.origin + '/inventario')).text();
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /type="module" src="\/app\.js"/);
  assert.equal((await fetch(operational.origin + '/app.js')).status, 200);
  assert.equal((await fetch(operational.origin + '/sw.js')).status, 404);
  assert.equal((await (await fetch(operational.origin + '/api/state')).json()).state.catalogo.importada, true);
  await operational.stop();

  await admin.query("UPDATE productos SET stock_minimo=2.50,codigo='RF-1 '");
  const backup = JSON.parse(JSON.stringify(await read(true)));
  assert.equal(backup.version, 5);
  const { databaseId, revision } = await read();
  const restored = await writeOperation(admin, 'POST', '/api/restore', { databaseId, revision, backup }, randomUUID(), 'Prueba');
  assert.notEqual(restored.databaseId, databaseId);
  assert.equal(restored.state.catalogo.importada, false);
  assert.deepEqual(restored.state.productos.map(p => [p.codigo, p.stockMinimo]), [['RF-1 ', 2.5]]);
  await rejectLegacy('respaldo v5 incompatible restaurado a otra generación');
});
