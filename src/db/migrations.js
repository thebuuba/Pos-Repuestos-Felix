import { readFile, readdir } from 'node:fs/promises';

// Migrations are an explicit administrative action, never server startup work.
export async function migrateDatabase(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock(74198231)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
      (version text PRIMARY KEY, statements text[], name text)`);
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    for (const filename of (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      const [, version, name] = filename.match(/^(\d+)_(.+)\.sql$/);
      if ((await client.query('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rowCount) continue;
      const sql = await readFile(new URL(filename, directory), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)', [version, name, [sql]]);
        await client.query('COMMIT');
        applied.push(version);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(74198231)').catch(() => {});
    client.release();
  }
}
