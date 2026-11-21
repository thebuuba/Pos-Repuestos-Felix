import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';

test('an unsupported deeply nested request cannot strand a checked-out database connection', async t => {
  const database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  let pool, server;
  const leases = new Set();
  t.mock.method(console, 'error', () => {});
  try {
    await migrateDatabase(admin);
    pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', max: 1, connectionTimeoutMillis: 200 });
    const observedPool = {
      async connect() {
        const client = await pool.connect();
        leases.add(client);
        return {
          query: (...args) => client.query(...args),
          release(error) { leases.delete(client); client.release(error); },
        };
      },
    };
    server = await createApp(observedPool);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const initial = await (await fetch(origin + '/api/state')).json();
    const body = `{"databaseId":"${initial.databaseId}","unsupported":${'['.repeat(20_000)}0${']'.repeat(20_000)}}`;
    const rejected = await fetch(origin + '/api/productos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body });
    assert.ok(rejected.status >= 400);
    await rejected.arrayBuffer();
    const current = await fetch(origin + '/api/state');
    assert.equal(current.status, 200, 'the next real request must still obtain the single pool connection');
    assert.deepEqual(await current.json(), initial);
    assert.equal(leases.size, 0);
    assert.equal(pool.idleCount, pool.totalCount);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Ensure a deliberately reproduced leak does not prevent test cleanup.
    for (const client of leases) client.release(true);
    await pool?.end();
    await admin.end();
    await database.stop();
  }
});
