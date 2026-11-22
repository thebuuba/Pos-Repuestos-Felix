import { cents, money, id, text, fail } from './operation-fields.js';

const emptySummary = () => ({ opening: 0, cashSales: 0, cardSales: 0, transferSales: 0, creditSales: 0,
  entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 0, invoices: 0 });
const iso = date => date instanceof Date ? date.toISOString() : date;
const closure = row => ({ id: Number(row.id), openedAt: iso(row.abierto_en), closedAt: iso(row.cerrado_en),
  cashier: row.cajero, opening: Number(row.fondo), expected: Number(row.esperado), counted: Number(row.contado), sales: Number(row.ventas) });

function totals(turn, sales, movements) {
  const sum = predicate => sales.filter(predicate).reduce((total, row) => total + cents(row.total), 0n);
  const moved = type => movements.filter(row => row.tipo === type).reduce((total, row) => total + cents(row.monto), 0n);
  const cash = sum(row => row.metodo_pago === 'efectivo');
  const incoming = moved('entrada'), outgoing = moved('salida');
  const expected = cents(turn.fondo) + cash + incoming - outgoing;
  return { expected, sales: sum(() => true), summary: {
    ...emptySummary(), opening: Number(turn.fondo), cashSales: Number(money(cash)),
    cardSales: Number(money(sum(row => row.metodo_pago === 'tarjeta'))),
    transferSales: Number(money(sum(row => row.metodo_pago === 'transferencia'))),
    creditSales: Number(money(sum(row => row.metodo_pago === 'credito'))),
    entradas: Number(money(incoming)), salidas: Number(money(outgoing)), expected: Number(money(expected)), invoices: sales.length,
  } };
}
export function cashPresentation(data) {
  const turn = data.turnos_caja.find(row => row.cerrado_en === null);
  const movements = turn ? data.movimientos_caja.filter(row => row.caja_id === turn.id) : [];
  return {
    session: turn ? { id: Number(turn.id), version: Number(turn.version), open: true, openedAt: iso(turn.abierto_en),
      cashier: turn.cajero, openingAmount: Number(turn.fondo) } : { id: null, version: null, open: false, openedAt: '', cashier: '' },
    summary: turn ? totals(turn, data.ventas.filter(row => row.caja_id === turn.id), movements).summary : emptySummary(),
    movements: movements.map(row => ({ id: Number(row.id), sessionId: Number(row.caja_id), type: row.tipo,
      amount: Number(row.monto), description: row.concepto, date: iso(row.creado_en) })).reverse(),
    closures: data.turnos_caja.filter(row => row.cerrado_en !== null).map(closure).reverse(),
  };
}
async function turnTotals(client, turn) {
  const sales = (await client.query('SELECT total,metodo_pago FROM ventas WHERE caja_id=$1', [turn.id])).rows;
  const movements = (await client.query('SELECT tipo,monto FROM movimientos_caja WHERE caja_id=$1', [turn.id])).rows;
  return totals(turn, sales, movements);
}
// Shared order for sales, movements and closing prevents a sale from entering a closed turn.
export async function lockCash(client, cajaId, version) {
  await client.query('SELECT pg_advisory_xact_lock(74198233)');
  const turn = (await client.query('SELECT * FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE')).rows[0];
  if (!turn || Number(turn.id) !== id(cajaId, 'el turno de caja')) fail('La caja está cerrada o cambió de turno. Actualiza los datos y abre la caja para vender.', 409);
  if (version !== undefined && Number(turn.version) !== id(version, 'la versión de caja')) fail('La caja cambió. Revisa los movimientos y el efectivo esperado antes de continuar.', 409);
  return turn;
}
export async function cashOperation(client, path, body, actor) {
  const user = text(actor.id, 'el usuario de caja');
  if (path === '/api/caja/abrir') {
    const amount = money(cents(body.monto, 'el fondo inicial'));
    await client.query('SELECT pg_advisory_xact_lock(74198233)');
    if ((await client.query('SELECT 1 FROM turnos_caja WHERE cerrado_en IS NULL')).rowCount) fail('Ya hay un turno de caja abierto. Actualiza los datos.', 409);
    const row = (await client.query('INSERT INTO turnos_caja(usuario,cajero,fondo,abierto_en) VALUES($1,$2,$3,clock_timestamp()) RETURNING id',
      [user, text(actor.name, 'el cajero'), amount])).rows[0];
    return { id: Number(row.id) };
  }
  const turn = await lockCash(client, body.cajaId, id(body.version, 'la versión de caja'));
  const summary = await turnTotals(client, turn);
  if (path === '/api/caja/movimiento') {
    if (!['entrada', 'salida'].includes(body.tipo)) fail('Selecciona entrada o salida.');
    const amount = cents(body.monto, 'el monto');
    if (!amount) fail('El movimiento debe ser mayor que cero.');
    if (body.tipo === 'salida' && amount > summary.expected) fail('La salida supera el efectivo esperado en caja.', 409);
    // Validate resulting balance before committing, including the numeric upper bound.
    money(summary.expected + (body.tipo === 'entrada' ? amount : -amount));
    const row = (await client.query('INSERT INTO movimientos_caja(caja_id,tipo,monto,concepto,usuario,creado_en) VALUES($1,$2,$3,$4,$5,clock_timestamp()) RETURNING id',
      [turn.id, body.tipo, money(amount), text(body.concepto, 'el concepto'), user])).rows[0];
    await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
    return { id: Number(row.id) };
  }
  const row = (await client.query(`UPDATE turnos_caja SET cerrado_en=clock_timestamp(),cerrado_por=$2,esperado=$3,contado=$4,ventas=$5,version=version+1
    WHERE id=$1 RETURNING *`, [turn.id, user, money(summary.expected), money(cents(body.conteo, 'el conteo')), money(summary.sales)])).rows[0];
  return closure(row);
}

export async function validateCashRestore(client) {
  const turns = (await client.query('SELECT * FROM turnos_caja')).rows;
  for (const turn of turns) {
    const summary = await turnTotals(client, turn);
    if (turn.cerrado_en && (cents(turn.esperado) !== summary.expected || cents(turn.ventas) !== summary.sales))
      fail('El respaldo contiene un cierre de caja que no coincide con sus ventas y movimientos.');
  }
  const invalid = await client.query(`SELECT 1 FROM ventas v JOIN turnos_caja c ON c.id=v.caja_id
    WHERE v.creado_en<c.abierto_en OR (c.cerrado_en IS NOT NULL AND v.creado_en>c.cerrado_en)
    UNION ALL SELECT 1 FROM movimientos_caja m JOIN turnos_caja c ON c.id=m.caja_id
    WHERE m.creado_en<c.abierto_en OR (c.cerrado_en IS NOT NULL AND m.creado_en>c.cerrado_en) LIMIT 1`);
  if (invalid.rowCount) fail('El respaldo contiene operaciones fuera de su turno de caja.');
  const overlapping = await client.query(`SELECT 1 FROM (
    SELECT abierto_en,lag(COALESCE(cerrado_en,'infinity'::timestamptz)) OVER(ORDER BY abierto_en,id) AS cierre_anterior
    FROM turnos_caja
  ) turnos WHERE abierto_en<cierre_anterior LIMIT 1`);
  if (overlapping.rowCount) fail('El respaldo contiene turnos de caja superpuestos.');
  // ponytail: older millisecond backups cannot order events inside the same timestamp.
  // Positive entries first preserve valid exports; new exports retain microseconds.
  const negative = await client.query(`WITH eventos AS (
    SELECT caja_id,creado_en,total AS cambio,0 AS origen,id FROM ventas WHERE metodo_pago='efectivo'
    UNION ALL SELECT caja_id,creado_en,CASE WHEN tipo='entrada' THEN monto ELSE -monto END,1,id FROM movimientos_caja
  ), saldos AS (
    SELECT c.fondo+sum(e.cambio) OVER(PARTITION BY e.caja_id ORDER BY e.creado_en,(e.cambio<0),e.origen,e.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo
    FROM eventos e JOIN turnos_caja c ON c.id=e.caja_id
  ) SELECT 1 FROM saldos WHERE saldo<0 LIMIT 1`);
  if (negative.rowCount) fail('El respaldo contiene un saldo de caja negativo entre operaciones.');
}
