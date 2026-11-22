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
  for (const [args, port] of [[[], undefined], [[], 3000], [['--operational'], undefined], [['--operational'], 3000]]) {
    const result = await runEntry({ args, port });
    await result.stop();
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /PORT.*(?:nuevo|distinto)/);
  }
});

test('ambas entradas sirven solo Polymet y conservan códigos literales tras restaurar v5', { timeout: 60_000 }, async t => {
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
  const missingAssets = await start();
  await missingAssets.stop();
  assert.equal(missingAssets.started, false);
  assert.match(missingAssets.stderr, /pnpm build/);

  await buildOperational(join(directory, 'dist', 'operational'));
  for (const args of [[], ['--operational']]) {
    const child = await start(args);
    assert.equal(child.started, true, child.stderr);
    for (const path of ['/', '/inventario']) {
      const html = await (await fetch(child.origin + path)).text();
      assert.match(html, /<div id="root"><\/div>/);
      assert.match(html, /type="module" src="\/app\.js"/);
    }
    assert.equal((await fetch(child.origin + '/app.js')).status, 200);
    assert.equal((await fetch(child.origin + '/sw.js')).status, 404);
    if (args.length) continue;
    const get = async path => (await fetch(child.origin + path)).json();
    const post = async (path, body, key = randomUUID()) => {
      const response = await fetch(child.origin + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const { databaseId } = await get('/api/state');
    const draft = { databaseId, nombre: 'Control', stock: 1, costo: 1, precio1: 1, precio2: 1, precio3: 1 };
    for (const codigo of ['RF-1', 'rf-1', 'RF-1 ']) await post('/api/productos', { ...draft, codigo });
    const backup = await get('/api/backup');
    assert.equal(backup.version, 5);
    const { revision } = await get('/api/state');
    const key = randomUUID();
    const body = { databaseId, revision, backup };
    const restored = await post('/api/restore', body, key);
    const replay = await post('/api/restore', body, key);
    assert.equal(replay.databaseId, restored.databaseId);
    assert.equal(replay.confirmation.replayed, true);
    assert.equal(replay.revision, restored.revision);
    assert.deepEqual((await get('/api/state')).state.productos.map(p => p.codigo).sort(), ['RF-1', 'RF-1 ', 'rf-1']);
    await child.stop();
  }
});
