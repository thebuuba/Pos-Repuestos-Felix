import { normalizeFormula } from '../domain/pricing.js';
import { cents, fail, id, integer, money, text } from './operation-fields.js';

const optionalText = value => text(value, 'el texto', false);
const nullable = validate => value => value === null ? null : validate(value);
const oneOf = (value, options, field) => {
  if (!options.includes(value)) fail(`Revisa ${field}.`);
  return value;
};

export function formulaValues(factor, p1, p2, p3) {
  try {
    const { costFactor, margins } = normalizeFormula({ costFactor: factor, margins: { p1, p2, p3 } });
    return [costFactor, margins.p1, margins.p2, margins.p3];
  } catch (error) {
    if (error instanceof RangeError) fail(error.message);
    throw error;
  }
}

function taxRate(percent) {
  if (!['number', 'string'].includes(typeof percent) || !/^\d{1,3}(?:\.\d{1,4})?$/.test(String(percent)) || Number(percent) > 100)
    fail('ITBIS debe estar entre 0 y 100% con hasta cuatro decimales.');
  return (Number(percent) / 100).toFixed(6);
}
const settings = {
  empresa: ['empresa', value => text(value, 'la empresa')],
  rnc: ['rnc', optionalText], tel: ['tel', optionalText], correo: ['correo', optionalText], direccion: ['direccion', optionalText],
  itbisPorcentaje: ['tasa_itbis', taxRate],
  redondeo: ['redondeo', value => oneOf(value, [0, 1, 5, 10, 25], 'el redondeo')],
  nivelPrecioPredeterminado: ['nivel_precio_predeterminado', value => oneOf(value, [null, 'p1', 'p2', 'p3'], 'el nivel de precio')],
  formatoImpresion: ['formato_impresion', value => oneOf(value, [null, 'Térmica 80 mm', 'Térmica 58 mm', 'Carta (8.5 x 11)'], 'el formato de impresión')],
  pieTicket: ['pie_ticket', optionalText],
  permitirStockNegativo: ['permitir_stock_negativo', value => oneOf(value, [false], 'el control de existencias')],
  metaDiaria: ['meta_diaria', nullable(value => money(cents(value, 'la meta diaria')))],
};
export const settingValue = (field, value) => settings[field][1](value);

function allowedKeys(body, mutable, existing) {
  const allowed = new Set(['databaseId', ...mutable]);
  if (existing) allowed.add('version');
  if (Object.keys(body).some(key => !allowed.has(key))) fail('El formulario contiene campos no admitidos.');
}
export async function settingsOperation(client, body) {
  allowedKeys(body, Object.keys(settings), true);
  const changes = Object.entries(settings).filter(([field]) => Object.hasOwn(body, field));
  if (!changes.length) fail('Indica los datos de configuración que deseas guardar.');
  const values = changes.map(([field]) => settingValue(field, body[field]));
  const assignments = changes.map(([, [column]], index) => column + '=$' + (index + 2));
  const result = await client.query(`UPDATE configuracion SET ${assignments.join(',')},version=version+1,actualizado_en=now()
    WHERE id=1 AND version=$1 RETURNING id`, [id(body.version, 'la versión'), ...values]);
  if (!result.rowCount) fail('La configuración cambió. Actualiza antes de guardar.', 409);
  return { id: 1 };
}

const common = { nombre: ['nombre', value => text(value, 'el nombre')], rnc: ['rnc', optionalText],
  tel: ['tel', optionalText], correo: ['correo', optionalText] };
const customer = { ...common, direccion: ['direccion', optionalText],
  limiteCredito: ['limite_credito', nullable(value => money(cents(value, 'el límite de crédito')))] };
const supplier = { ...common, contacto: ['contacto', optionalText],
  diasCredito: ['dias_credito', nullable(value => integer(value, 'los días de crédito', 0))],
  formulaId: ['formula_id', nullable(value => id(value, 'la fórmula'))] };
const formulaFields = ['nombre', 'factorCosto', 'recargo1', 'recargo2', 'recargo3'];

async function refuseUsedRecord(client, table, recordId) {
  if (table === 'clientes') {
    const result = await client.query(`SELECT 1 FROM clientes c WHERE c.id=$1 AND
      c.saldo_apertura
      + COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN ventas v ON v.id=a.venta_id WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)<>0`, [recordId]);
    if (result.rowCount) fail('El cliente tiene saldo pendiente.', 409);
  }
  if (table === 'suplidores') {
    const result = await client.query(`SELECT 1 FROM suplidores s WHERE s.id=$1 AND
      COALESCE((SELECT sum(c.total) FROM compras c WHERE c.suplidor_id=s.id AND c.condicion='Credito' AND c.estado='activa'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN compras c ON c.id=a.compra_id WHERE c.suplidor_id=s.id AND c.condicion='Credito' AND c.estado='activa'),0)<>0`, [recordId]);
    if (result.rowCount) fail('El suplidor tiene saldo pendiente.', 409);
  }
  if (table === 'formulas_precios') {
    const used = await client.query('SELECT 1 FROM suplidores WHERE formula_id=$1 AND activo LIMIT 1', [recordId]);
    if (used.rowCount) fail('La fórmula está asignada a un suplidor.', 409);
  }
}

export async function contactOperation(client, resource, method, recordId, body) {
  const isFormula = resource === 'formulas';
  const table = isFormula ? 'formulas_precios' : resource === 'clientes' ? 'clientes' : 'suplidores';
  const fields = table === 'clientes' ? customer : supplier;
  const keys = isFormula ? formulaFields : Object.keys(fields);
  allowedKeys(body, method === 'DELETE' ? [] : keys, recordId !== null);

  // La asignación y la baja adquieren primero el mismo bloqueo de fórmula.
  if (table === 'suplidores' && body.formulaId != null) {
    const formula = await client.query('SELECT activo FROM formulas_precios WHERE id=$1 FOR SHARE', [id(body.formulaId, 'la fórmula')]);
    if (!formula.rows[0]?.activo) fail('Selecciona una fórmula activa.');
  }
  if (recordId !== null) {
    const version = id(body.version, 'la versión');
    const previous = (await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [recordId])).rows[0];
    if (!previous?.activo || Number(previous.version) !== version) fail('El registro cambió. Actualiza antes de guardar.', 409);
    if (previous.es_contado) fail('El cliente de contado está protegido.', 409);
  }
  if (method === 'DELETE') {
    await refuseUsedRecord(client, table, recordId);
    if (table === 'formulas_precios') {
      await client.query('UPDATE suplidores SET formula_id=NULL WHERE formula_id=$1 AND NOT activo', [recordId]);
    }
    const extra = table === 'suplidores' ? ',formula_id=NULL' : '';
    await client.query(`UPDATE ${table} SET activo=false${extra},version=version+1,actualizado_en=now() WHERE id=$1`, [recordId]);
    return { id: recordId };
  }
  let columns, values;
  if (isFormula) {
    columns = ['nombre', 'factor_costo', 'recargo1', 'recargo2', 'recargo3'];
    values = [text(body.nombre, 'el nombre'), ...formulaValues(body.factorCosto, body.recargo1, body.recargo2, body.recargo3)];
  } else {
    // Omitir un campo conserva su valor exacto; en altas, PostgreSQL aplica el default.
    const changes = Object.entries(fields).filter(([key]) => key === 'nombre' || Object.hasOwn(body, key));
    columns = changes.map(([, [column]]) => column);
    values = changes.map(([field, [, validate]]) => {
      // El alta anterior aceptaba null para RNC/teléfono y guardaba texto vacío.
      const legacyEmpty = method === 'POST' && (field === 'rnc' || field === 'tel') && body[field] === null;
      return validate(legacyEmpty ? '' : body[field]);
    });
  }
  const parameters = columns.map((_, i) => '$' + (i + 1));
  const result = recordId === null
    ? await client.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${parameters.join(',')}) RETURNING id`, values)
    : await client.query(`UPDATE ${table} SET ${columns.map((col, i) => col + '=' + parameters[i]).join(',')},version=version+1,actualizado_en=now()
        WHERE id=$${values.length + 1} RETURNING id`, [...values, recordId]);
  return { id: Number(result.rows[0].id) };
}
