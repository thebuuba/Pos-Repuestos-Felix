import { PGlite } from '@electric-sql/pglite';

// PGlite is an in-memory executor only. SQLite is the durable authority.
// Hold the sole connection until release, including multi-query transactions.
export async function memoryPool() {
  const database = await PGlite.create({ parsers: { 20: value => value, 1700: value => value } });
  let tail = Promise.resolve();
  return {
    async connect() {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      let released = false;
      return {
        async query(sql, values) {
          if (released) throw new Error('Conexión local cerrada.');
          const result = values ? await database.query(sql, values) : (await database.exec(sql)).at(-1);
          return { ...result, rows: result?.rows || [], rowCount: result?.rows?.length || result?.affectedRows || 0 };
        },
        release() { if (!released) { released = true; unlock(); } },
      };
    },
    async end() { await tail; await database.close(); },
  };
}
