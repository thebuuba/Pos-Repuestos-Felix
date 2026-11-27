import { cents, decimalUnits, money, wholePesos, roundPesoCents, id, text, fail } from './operation-fields.js';

const emptySummary = () => ({ opening: 0, cashSales: 0, cardSales: 0, transferSales: 0, creditSales: 0,
  entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 0, roundingAdjustment: 0, invoices: 0 });
const iso = date => date instanceof Date ? date.toISOString() : date;
const closure = row => ({ id: Number(row.id), openedAt: iso(row.abierto_en), closedAt: iso(row.cerrado_en),
  cashier: row.cajero, opening: Number(row.fondo), expected: Number(row.esperado), counted: Number(row.contado), sales: Number(row.ventas) });

function totals(turn, sales, movements, payments = [], closedAt = null) {
  const closedMs = closedAt ? new Date(closedAt).getTime() : null;
  const activeSales = sales.filter(row => row.estado !== 'anulada' ||
    (closedMs !== null && row.anulada_en && new Date(row.anulada_en).getTime() > closedMs));
  const sum = predicate => activeSales.filter(predicate).reduce((total, row) => total + cents(row.total), 0n);
  const moved = type => movements.filter(row => row.tipo === type).reduce((total, row) => total + cents(row.monto), 0n);
  const paid = type => payments.filter(row => row.tipo === type && row.metodo_pago === 'efectivo').reduce((total, row) => total + cents(row.monto), 0n);
  const cash = sum(row => row.metodo_pago === 'efectivo');
  const incoming = moved('entrada'), outgoing = moved('salida');
  const cobros = paid('cobro'), pagos = paid('pago');
  const rawExpected = cents(turn.fondo) + cash + incoming + cobros - outgoing - pagos;
  const expected = roundPesoCents(rawExpected);
  const roundingAdjustment = expected - rawExpected;
  return { rawExpected, expected, roundingAdjustment, sales: sum(() => true), summary: {
    ...emptySummary(), opening: Number(turn.fondo), cashSales: Number(money(cash)),
    cardSales: Number(money(sum(row => row.metodo_pago === 'tarjeta'))),
    transferSales: Number(money(sum(row => row.metodo_pago === 'transferencia'))),
    creditSales: Number(money(sum(row => row.metodo_pago === 'credito'))),
    entradas: Number(money(incoming)), salidas: Number(money(outgoing)),
    cobros: Number(money(cobros)), pagos: Number(money(pagos)),
    expected: expected >= 0n ? Number(money(expected)) : Number(decimalUnits(expected, 2)),
    roundingAdjustment: Number(decimalUnits(roundingAdjustment, 2)),
    invoices: activeSales.length,
  } };
}
export function cashPresentation(data) {
  const turn = data.turnos_caja.find(row => row.cerrado_en === null);
  const movements = turn ? data.movimientos_caja.filter(row => row.caja_id === turn.id) : [];
  const payments = turn ? (data.abonos_cuentas || []).filter(row => row.caja_id === turn.id) : [];
  return {
    session: turn ? { id: Number(turn.id), version: Number(turn.version), open: true, openedAt: iso(turn.abierto_en),
      cashier: turn.cajero, openingAmount: Number(turn.fondo) } : { id: null, version: null, open: false, openedAt: '', cashier: '' },
    summary: turn ? totals(turn, data.ventas.filter(row => row.caja_id === turn.id), movements, payments).summary : emptySummary(),
    movements: movements.map(row => ({ id: Number(row.id), sessionId: Number(row.caja_id), type: row.tipo,
      amount: Number(row.monto), description: row.concepto, date: iso(row.creado_en) })).reverse(),
    closures: data.turnos_caja
      .filter(row => row.cerrado_en !== null)
      .map(closure)
      .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '') || (b.openedAt || '').localeCompare(a.openedAt || '') || b.id - a.id),
  };
}
export async function turnTotals(client, turn, { atClose = false } = {}) {
  const closedAt = atClose ? turn.cerrado_en : null;
  const sales = closedAt
    ? (await client.query(
        "SELECT total,metodo_pago,estado,anulada_en FROM ventas WHERE caja_id=$1 AND (estado='activa' OR (estado='anulada' AND anulada_en>$2::timestamptz))",
        [turn.id, closedAt],
      )).rows
    : (await client.query("SELECT total,metodo_pago,estado FROM ventas WHERE caja_id=$1 AND estado='activa'", [turn.id])).rows;
  const movements = (await client.query('SELECT tipo,monto FROM movimientos_caja WHERE caja_id=$1', [turn.id])).rows;
  const payments = (await client.query('SELECT tipo,metodo_pago,monto FROM abonos_cuentas WHERE caja_id=$1', [turn.id])).rows;
  return totals(turn, sales, movements, payments, closedAt);
}
// Shared order for sales, movements and closing prevents a sale from entering a closed turn.
export async function lockCash(client, cajaId, version, occurredAt = null) {
  await client.query('SELECT pg_advisory_xact_lock(74198233)');
  const turn = (await client.query('SELECT * FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE')).rows[0];
  if (!turn || Number(turn.id) !== id(cajaId, 'el turno de caja')) fail('La caja está cerrada o cambió de turno. Actualiza los datos y abre la caja para vender.', 409);
  if (version !== undefined && Number(turn.version) !== id(version, 'la versión de caja')) fail('La caja cambió. Revisa los movimientos y el efectivo esperado antes de continuar.', 409);
  if (occurredAt && new Date(occurredAt).getTime() < new Date(turn.abierto_en).getTime()) {
    fail('La fecha del equipo es anterior a la apertura de caja. Revisa la hora del equipo.', 409);
  }
  return turn;
}
export async function cashOperation(client, path, body, actor, occurredAt = null) {
  const user = text(actor.id, 'el usuario de caja');
  if (path === '/api/caja/abrir') {
    const amount = money(wholePesos(body.monto, 'el fondo inicial'));
    await client.query('SELECT pg_advisory_xact_lock(74198233)');
    if ((await client.query('SELECT 1 FROM turnos_caja WHERE cerrado_en IS NULL')).rowCount) fail('Ya hay un turno de caja abierto. Actualiza los datos.', 409);
    if (occurredAt) {
      const last = (await client.query('SELECT cerrado_en FROM turnos_caja ORDER BY abierto_en DESC, id DESC LIMIT 1')).rows[0];
      if (last?.cerrado_en && new Date(occurredAt).getTime() < new Date(last.cerrado_en).getTime()) {
        fail('La fecha del equipo es anterior al último cierre de caja. Revisa la hora del equipo.', 409);
      }
    }
    const row = (await client.query('INSERT INTO turnos_caja(usuario,cajero,fondo,abierto_en) VALUES($1,$2,$3,COALESCE($4::timestamptz,clock_timestamp())) RETURNING id',
      [user, text(actor.name, 'el cajero'), amount, occurredAt])).rows[0];
    return { id: Number(row.id) };
  }
  const turn = await lockCash(client, body.cajaId, id(body.version, 'la versión de caja'), occurredAt);
  const summary = await turnTotals(client, turn);
  if (path === '/api/caja/movimiento') {
    if (!['entrada', 'salida'].includes(body.tipo)) fail('Selecciona entrada o salida.');
    const amount = wholePesos(body.monto, 'el monto');
    if (!amount) fail('El movimiento debe ser mayor que cero.');
    if (body.tipo === 'salida' && amount > summary.rawExpected) fail('La salida supera el efectivo esperado en caja.', 409);
    // Validate resulting balance before committing, including the numeric upper bound.
    money(summary.rawExpected + (body.tipo === 'entrada' ? amount : -amount));
    const row = (await client.query('INSERT INTO movimientos_caja(caja_id,tipo,monto,concepto,usuario,creado_en) VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz,clock_timestamp())) RETURNING id',
      [turn.id, body.tipo, money(amount), text(body.concepto, 'el concepto'), user, occurredAt])).rows[0];
    await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
    return { id: Number(row.id) };
  }
  const counted = wholePesos(body.conteo, 'el conteo');
  const row = (await client.query(`UPDATE turnos_caja SET cerrado_en=COALESCE($6::timestamptz,clock_timestamp()),cerrado_por=$2,esperado=$3,contado=$4,ventas=$5,version=version+1
    WHERE id=$1 RETURNING *`, [turn.id, user, money(summary.expected), money(counted), money(summary.sales), occurredAt])).rows[0];
  return closure(row);
}

export async function validateCashRestore(client) {
  const turns = (await client.query('SELECT * FROM turnos_caja')).rows;
  if (turns.length) {
    // 3 consultas fijas agrupadas por caja_id en lugar de 3*N consultas por turno.
    const [allSales, allMovements, allPayments] = await Promise.all([
      client.query('SELECT caja_id,total,metodo_pago,estado,anulada_en FROM ventas WHERE caja_id IS NOT NULL'),
      client.query('SELECT caja_id,tipo,monto FROM movimientos_caja'),
      client.query('SELECT caja_id,tipo,metodo_pago,monto FROM abonos_cuentas WHERE caja_id IS NOT NULL'),
    ]);
    const groupByTurn = list => {
      const map = new Map();
      for (const row of list) {
        const key = String(row.caja_id);
        let bucket = map.get(key);
        if (!bucket) { bucket = []; map.set(key, bucket); }
        bucket.push(row);
      }
      return map;
    };
    const salesByTurn = groupByTurn(allSales.rows);
    const movementsByTurn = groupByTurn(allMovements.rows);
    const paymentsByTurn = groupByTurn(allPayments.rows);
    for (const turn of turns) {
      const key = String(turn.id);
      const closedAt = turn.cerrado_en || null;
      const summary = totals(
        turn,
        salesByTurn.get(key) || [],
        movementsByTurn.get(key) || [],
        paymentsByTurn.get(key) || [],
        closedAt,
      );
      if (turn.cerrado_en) {
        const savedExpected = cents(turn.esperado);
        const validExpected = savedExpected === summary.rawExpected || savedExpected === summary.expected;
        if (!validExpected || cents(turn.ventas) !== summary.sales) {
          fail('El respaldo contiene un cierre de caja que no coincide con sus ventas y movimientos.');
        }
      }
    }
  }
  const invalid = await client.query(`SELECT 1 FROM ventas v JOIN turnos_caja c ON c.id=v.caja_id
    WHERE v.creado_en<c.abierto_en OR (c.cerrado_en IS NOT NULL AND v.creado_en>c.cerrado_en)
    UNION ALL SELECT 1 FROM movimientos_caja m JOIN turnos_caja c ON c.id=m.caja_id
    WHERE m.creado_en<c.abierto_en OR (c.cerrado_en IS NOT NULL AND m.creado_en>c.cerrado_en)
    UNION ALL SELECT 1 FROM abonos_cuentas a JOIN turnos_caja c ON c.id=a.caja_id
    WHERE a.creado_en<c.abierto_en OR (c.cerrado_en IS NOT NULL AND a.creado_en>c.cerrado_en) LIMIT 1`);
  if (invalid.rowCount) fail('El respaldo contiene operaciones fuera de su turno de caja.');
  const overlapping = await client.query(`SELECT 1 FROM (
    SELECT abierto_en,lag(COALESCE(cerrado_en,'infinity'::timestamptz)) OVER(ORDER BY abierto_en,id) AS cierre_anterior
    FROM turnos_caja
  ) turnos WHERE abierto_en<cierre_anterior LIMIT 1`);
  if (overlapping.rowCount) fail('El respaldo contiene turnos de caja superpuestos.');
  const negative = await client.query(`WITH eventos AS (
    SELECT caja_id,creado_en AS instante,total AS cambio,0 AS origen,id FROM ventas WHERE metodo_pago='efectivo'
    UNION ALL SELECT caja_id,anulada_en AS instante,-total AS cambio,3 AS origen,id FROM ventas WHERE metodo_pago='efectivo' AND estado='anulada'
    UNION ALL SELECT caja_id,creado_en AS instante,CASE WHEN tipo='entrada' THEN monto ELSE -monto END,1,id FROM movimientos_caja
    UNION ALL SELECT caja_id,creado_en AS instante,CASE WHEN tipo='cobro' THEN monto ELSE -monto END,2,id FROM abonos_cuentas WHERE metodo_pago='efectivo'
  ), saldos AS (
    SELECT c.fondo+sum(e.cambio) OVER(PARTITION BY e.caja_id ORDER BY e.instante,(e.cambio<0),e.origen,e.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo
    FROM eventos e JOIN turnos_caja c ON c.id=e.caja_id
  ) SELECT 1 FROM saldos WHERE saldo<0 LIMIT 1`);
  if (negative.rowCount) fail('El respaldo contiene un saldo de caja negativo entre operaciones.');
}
