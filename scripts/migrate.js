import pg from 'pg';
import { databaseConfig } from '../src/db/config.js';
import { migrateDatabase } from '../src/db/migrations.js';

const pool = new pg.Pool(databaseConfig({ ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL }));
try {
  const applied = await migrateDatabase(pool);
  console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base de datos está actualizada.');
} catch (error) {
  console.error('No se pudo migrar la base:', error.code || error.name);
  process.exitCode = 1;
} finally { await pool.end(); }
