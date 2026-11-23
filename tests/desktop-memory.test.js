import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryPool } from '../src/desktop/memory-pool.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { randomUUID } from 'node:crypto';

test('el motor de Windows ejecuta las migraciones y reglas PostgreSQL compartidas con importes exactos', async t => {
  const pool = await memoryPool();
  t.after(() => pool.end());
  assert.equal((await migrateDatabase(pool)).length, 10);
  const initial = await readSnapshot(pool, 'Windows');
  const opened = await writeOperation(pool, 'POST', '/api/caja/abrir', { databaseId: initial.databaseId, monto: '0.01' }, randomUUID(), 'Windows');
  assert.equal(opened.state.caja.summary.expected, 0.01);
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT 99999999999999.9999::numeric AS precise, 9007199254740991::bigint AS identifier");
    assert.equal(result.rows[0].precise, '99999999999999.9999');
    assert.equal(result.rows[0].identifier, '9007199254740991');
  } finally { client.release(); }
});
