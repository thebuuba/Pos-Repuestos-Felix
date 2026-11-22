import { randomUUID } from 'node:crypto';
import { readSnapshot, writeOperation } from '../../src/pos/store.js';

// Explicit test setup only; the application never opens a cash turn automatically.
export async function openTestCash(pool) {
  let snapshot = await readSnapshot(pool, 'Pruebas');
  if (!snapshot.state.caja.session.open) {
    try {
      snapshot = await writeOperation(pool, 'POST', '/api/caja/abrir', { databaseId: snapshot.databaseId, monto: 0 }, randomUUID(), 'Pruebas');
    } catch (error) {
      if (error.status !== 409) throw error;
      snapshot = await readSnapshot(pool, 'Pruebas');
      if (!snapshot.state.caja.session.open) throw error;
    }
  }
  return snapshot.state.caja.session.id;
}
