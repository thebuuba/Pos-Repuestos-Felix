import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { hostingConfig, sessionCookie } from '../src/hosting.js';

let database, pool, harness, root;
const authorization = sessionCookie(hostingConfig({ PUBLIC_ORIGIN:'https://pos.example', APP_USERNAME:'admin', APP_PASSWORD:'contrasena-runtime-ficticia-123' })).split(';')[0];
before(async () => {
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(pool);
  root = await mkdtemp(join(tmpdir(), 'felix-worker-test-'));
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const localDatabase = new URL(database.connectionString);
  localDatabase.password = 'contrasena-ficticia-runtime';
  const testConfig = { ...config,
    main: fileURLToPath(new URL('../src/worker.js', import.meta.url)),
    assets: { ...config.assets, directory: await buildOperational(join(root, 'operational')) },
    vars: { ...config.vars, PUBLIC_ORIGIN: 'https://pos.example', APP_USERNAME: 'admin' },
    // ID ficticio usado exclusivamente por el emulador local; no crea recursos.
    hyperdrive: [{ binding: 'HYPERDRIVE', id: '00000000000000000000000000000000', localConnectionString: localDatabase.toString() }],
  };
  const configPath = join(root, 'wrangler.jsonc');
  await writeFile(configPath, JSON.stringify(testConfig));
  harness = createTestHarness({ root, workers: [{ configPath, secrets: { APP_PASSWORD: 'contrasena-runtime-ficticia-123' } }] });
  await harness.listen();
});
after(async () => {
  await harness?.close();
  await pool?.end(); await database?.stop();
  if (root) {
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !absolute.startsWith(join(resolve(tmpdir()), 'felix-worker-test-'))) throw new Error('Ruta temporal inválida');
    await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
const call = (path, options = {}) => harness.getWorker().fetch('https://pos.example' + path, { ...options, headers: { Cookie: authorization, ...options.headers } });

test('el runtime Workers sirve el frontend y protege los datos con la configuración de producción', async () => {
  const html = await call('/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /type="module" src="\/app\.js"/);
  assert.match(await (await call('/inventario')).text(), /<div id="root"><\/div>/);
  assert.equal((await call('/app.js')).status, 200);
  assert.equal((await call('/sw.js')).status, 404);
  assert.equal((await call('/api/state', { headers: { Cookie: '' } })).status, 401);
  assert.equal((await call('/src/worker.js')).status, 404);
});

test('el runtime Workers ejecuta transacciones reales por Hyperdrive local y permite reintentos', async () => {
  const response = await call('/api/state');
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ databaseId: snapshot.databaseId, nombre: 'Cliente runtime' }) };
  const saved = await call('/api/clientes', options);
  assert.equal(saved.status, 200, await saved.clone().text());
  const replay = await call('/api/clientes', options);
  assert.equal(replay.status, 200);
  assert.equal((await saved.json()).result.id, (await replay.json()).result.id);
  const count = (await pool.query("SELECT count(*) FROM clientes WHERE nombre='Cliente runtime'")).rows[0].count;
  assert.equal(count, '1');
});

test('dos ventas concurrentes en Workers no duplican la última unidad y calculan ITBIS en el servidor', async () => {
  const current = await (await call('/api/state')).json();
  const write = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ databaseId: current.databaseId, ...body }) });
  const product = await write('/api/productos', { codigo: 'ULTIMA-WORKER', nombre: 'Pieza runtime', stock: 1, costo: 50, precio1: 118, precio2: 110, precio3: 100 });
  assert.equal(product.status, 200);
  const productId = (await product.json()).result.id;
  const sale = { clienteId: current.state.clientes[0].id, condicion: 'Credito', tipoComprobante: 'B02', total: 0,
    items: [{ productoId: productId, cantidad: 1, nivelPrecio: 'precio1', precio: 0 }] };
  const results = await Promise.all([write('/api/ventas', sale), write('/api/ventas', sale)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const latest = await (await call('/api/state')).json();
  assert.equal(latest.state.productos.find(p => p.id === productId).stock, 0);
  assert.equal(latest.state.facturas.length, 1);
  assert.equal(latest.state.facturas[0].total, 118);
  assert.equal(latest.state.facturas[0].itbis, 18);
  assert.equal(latest.state.clientes[0].deuda, 118);
});
