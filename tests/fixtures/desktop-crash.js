import { DesktopLedger } from '../../src/desktop/ledger.js';
import { DesktopEngine } from '../../src/desktop/engine.js';
import { randomUUID } from 'node:crypto';

process.once('message', async ({ directory, actor }) => {
  const engine = new DesktopEngine(new DesktopLedger(directory));
  await engine.rebuild();
  const snapshot = await engine.snapshot();
  const result = await engine.write('POST', '/api/caja/movimiento', { databaseId: snapshot.databaseId,
    cajaId: snapshot.state.caja.session.id, version: snapshot.state.caja.session.version,
    tipo: 'entrada', monto: '1', concepto: 'Confirmada antes del cierre abrupto' }, randomUUID(), actor);
  process.send({ expected: result.state.caja.summary.expected });
  // The parent deliberately terminates this process without closing the database.
  setInterval(() => {}, 1000);
});
