import { cents, costUnits, fail, integer, productCode, quantityUnits, text } from './operation-fields.js';
import { formulaValues, settingValue } from './contact-operations.js';

// Fixed column lists are shared by export/import; no names come from uploaded SQL.
const v3 = {
  configuracion: ['id', 'empresa', 'tasa_itbis', 'version', 'actualizado_en'],
  clientes: ['id', 'nombre', 'rnc', 'tel', 'saldo_apertura', 'activo', 'version', 'creado_en', 'actualizado_en'],
  suplidores: ['id', 'nombre', 'rnc', 'tel', 'activo', 'version', 'creado_en', 'actualizado_en'],
  productos: ['id', 'codigo', 'nombre', 'costo', 'precio1', 'precio2', 'precio3', 'stock', 'activo', 'version', 'creado_en', 'actualizado_en', 'marca', 'categoria', 'ubicacion', 'stock_minimo', 'gravado'],
  ventas: ['id', 'cliente_id', 'cliente_nombre', 'cliente_rnc', 'fecha', 'creado_en', 'tipo_comprobante', 'ncf', 'condicion', 'base', 'itbis', 'total'],
  venta_detalles: ['id', 'venta_id', 'producto_id', 'codigo', 'nombre', 'cantidad', 'nivel_precio', 'precio', 'base', 'itbis', 'total'],
  compras: ['id', 'suplidor_id', 'suplidor_nombre', 'numero', 'fecha', 'creado_en', 'total'],
  compra_detalles: ['id', 'compra_id', 'producto_id', 'codigo', 'nombre', 'cantidad', 'costo', 'precio1', 'precio2', 'precio3', 'total'],
  movimientos_inventario: ['id', 'producto_id', 'venta_detalle_id', 'compra_detalle_id', 'tipo', 'cantidad', 'existencia_posterior', 'motivo', 'creado_en'],
};

const v2 = { ...v3, productos: v3.productos.filter(col => !['marca', 'categoria', 'ubicacion', 'stock_minimo', 'gravado'].includes(col)) };
const v4 = {
  configuracion: [...v3.configuracion, 'rnc', 'tel', 'correo', 'direccion', 'redondeo', 'nivel_precio_predeterminado', 'formato_impresion', 'pie_ticket', 'permitir_stock_negativo'],
  clientes: [...v3.clientes, 'correo', 'direccion', 'limite_credito', 'es_contado'],
  formulas_precios: ['id', 'nombre', 'factor_costo', 'recargo1', 'recargo2', 'recargo3', 'activo', 'version', 'creado_en', 'actualizado_en'],
  suplidores: [...v3.suplidores, 'correo', 'contacto', 'dias_credito', 'formula_id'],
  productos: v3.productos, ventas: v3.ventas, venta_detalles: v3.venta_detalles,
  compras: v3.compras, compra_detalles: v3.compra_detalles, movimientos_inventario: v3.movimientos_inventario,
};
const v5 = { ...v4, productos: [...v4.productos, 'notificar_minimo'] };
const v6 = {
  turnos_caja: ['id','usuario','cajero','fondo','abierto_en','cerrado_en','cerrado_por','esperado','contado','ventas','version'],
  ...v5,
  ventas: [...v5.ventas, 'caja_id', 'metodo_pago'],
  movimientos_caja: ['id','caja_id','tipo','monto','concepto','usuario','creado_en'],
};
// Parent rows precede children; reverse order is safe for transactional restore.
export const tables = {
  turnos_caja: v6.turnos_caja,
  configuracion: [...v6.configuracion, 'meta_diaria'],
  secuencias_ncf: ['id','tipo','prefijo','inicio','fin','actual','vencimiento','activa','version','actualizado_en'],
  clientes: v6.clientes,
  formulas_precios: v6.formulas_precios,
  suplidores: v6.suplidores,
  productos: v6.productos,
  productos_codigos: ['id','producto_id','codigo','creado_en'],
  ventas: [...v6.ventas, 'descuento_porcentaje','descuento','estado','anulada_en','anulada_por','motivo_anulacion','vencimiento','version'],
  venta_detalles: v6.venta_detalles,
  compras: [...v6.compras, 'condicion','vencimiento','version'],
  compra_detalles: v6.compra_detalles,
  movimientos_inventario: v6.movimientos_inventario,
  movimientos_caja: v6.movimientos_caja,
  abonos_cuentas: ['id','tipo','venta_id','compra_id','caja_id','metodo_pago','monto','referencia','nota','usuario','creado_en'],
};
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validIsoDate(value, label = 'Fecha documental inválida.') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    fail(label);
  }
}
const preferenceFields = { redondeo: 'redondeo', nivel_precio_predeterminado: 'nivelPrecioPredeterminado',
  formato_impresion: 'formatoImpresion', permitir_stock_negativo: 'permitirStockNegativo' };
const moneyColumns = new Set(['costo', 'precio', 'precio1', 'precio2', 'precio3', 'base', 'itbis', 'total','fondo','esperado','contado','ventas','monto','descuento']);
const optionalTextColumns = new Set(['rnc', 'tel', 'cliente_rnc', 'motivo', 'correo', 'direccion', 'contacto', 'pie_ticket', 'marca', 'categoria', 'ubicacion', 'referencia', 'nota']);
function validateBackupRow(table, row, columns, version) {
  if (!exactKeys(row, columns)) fail(`Fila inválida en ${table}.`);
  if (table === 'formulas_precios') formulaValues(row.factor_costo, row.recargo1, row.recargo2, row.recargo3);
  for (const key of columns) {
    const value = row[key];
    if (value === null && ((table === 'turnos_caja' && ['cerrado_en','cerrado_por','esperado','contado','ventas'].includes(key)) ||
      (table === 'ventas' && ['caja_id','metodo_pago','anulada_en','anulada_por','motivo_anulacion','vencimiento'].includes(key)) ||
      (table === 'compras' && key === 'vencimiento') ||
      (table === 'configuracion' && key === 'meta_diaria') ||
      (table === 'abonos_cuentas' && ['venta_id','compra_id','caja_id'].includes(key)))) continue;
    if (key === 'id' || key === 'version' || key.endsWith('_id')) {
      if (value === null && ['venta_detalle_id', 'compra_detalle_id', 'formula_id'].includes(key)) continue;
      if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`Identificador inválido en ${table}.`);
    } else if (table === 'formulas_precios' && ['factor_costo', 'recargo1', 'recargo2', 'recargo3'].includes(key)) continue;
    else if (table === 'secuencias_ncf' && ['inicio', 'fin', 'actual'].includes(key)) {
      const n = Number(value);
      if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(n) || n < 0 || n > 99999999) fail('Secuencia NCF inválida.');
    } else if (Object.hasOwn(preferenceFields, key)) settingValue(preferenceFields[key], value);
    else if (key === 'dias_credito') { if (value !== null) integer(value, key, 0); }
    else if (key === 'limite_credito' || key === 'meta_diaria') { if (value !== null) cents(value, key); }
    else if (key === 'descuento_porcentaje') {
      const pct = cents(value, key);
      if (pct > 10000n) fail('Porcentaje de descuento inválido.');
    } else if (key === 'codigo' && version >= 5) productCode(value);
    else if (version >= 5 && ['costo','precio','precio1','precio2','precio3'].includes(key)) costUnits(value, key);
    else if (moneyColumns.has(key)) cents(value, key);
    else if (key === 'saldo_apertura') {
      if (!['string', 'number'].includes(typeof value)) fail('Saldo de apertura inválido.');
      cents(String(value).replace(/^-/, ''), key);
    } else if (key === 'tasa_itbis') {
      if (!['string', 'number'].includes(typeof value) || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(String(value))) fail('Tasa ITBIS inválida.');
    } else if (['stock', 'cantidad', 'existencia_posterior', 'stock_minimo'].includes(key)) {
      if (version >= 5) {
        const signed = table === 'movimientos_inventario' && key === 'cantidad';
        const raw = signed && ['string', 'number'].includes(typeof value) ? String(value).replace(/^-/, '') : value;
        quantityUnits(raw, key, key === 'cantidad' ? 0.01 : 0);
      } else {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail(`Cantidad inválida en ${table}.`);
        if (key === 'stock_minimo' && value < 0) fail('Existencia mínima inválida.');
      }
    } else if (['activo', 'gravado', 'es_contado', 'notificar_minimo', 'activa'].includes(key)) { if (typeof value !== 'boolean') fail(`Estado inválido en ${table}.`); }
    else if (key === 'fecha' || key === 'vencimiento') {
      validIsoDate(value);
    } else if (key.endsWith('_en')) {
      const timestamp = version >= 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      if (typeof value !== 'string' || !timestamp.test(value) || !Number.isFinite(Date.parse(value))) fail('Fecha de registro inválida.');
    } else if (!(key === 'ncf' && value === null)) text(value, key, !optionalTextColumns.has(key));
  }
}

export async function rows(client, table, preciseDates = false, filter) {
  const columns = tables[table].map(key => (key === 'fecha' || key === 'vencimiento') ? `${key}::text AS ${key}` : preciseDates && key.endsWith('_en')
    ? `to_char(${key} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${key}` : key).join(',');
  return (await client.query(`SELECT ${columns} FROM public.${table}${filter ? ' WHERE ' + filter.sql : ''} ORDER BY id`, filter?.values)).rows;
}
export async function exportBackup(client) {
  const data = {};
  for (const table of Object.keys(tables)) data[table] = await rows(client, table, true);
  return { version: 7, format: 'repuestos-felix-relacional', exportedAt: new Date().toISOString(), tables: data };
}

// INSERT usa los valores predeterminados de SQL para las columnas ausentes.
export function backupLayout(backup) {
  const layout = backup.version === 7 ? tables : backup.version === 6 ? v6 : backup.version === 5 ? v5 : backup.version === 4 ? v4 : backup.version === 3 ? v3 : backup.version === 2 ? v2 : null;
  if (!layout || backup.format !== 'repuestos-felix-relacional' || !exactKeys(backup.tables, Object.keys(layout)))
    fail('Formato de respaldo inválido.');
  for (const [table, columns] of Object.entries(layout)) {
    const entries = backup.tables[table];
    if (!Array.isArray(entries) || entries.length > 100000) fail(`Revisa la tabla ${table}.`);
    for (const row of entries) validateBackupRow(table, row, columns, backup.version);
  }
  if (backup.tables.configuracion.length !== 1 || Number(backup.tables.configuracion[0].id) !== 1) fail('Configuración de respaldo inválida.');
  if (backup.version >= 4) {
    const marked = backup.tables.clientes.filter(c => c.es_contado);
    if (marked.length > 1 || marked.some(c => !c.activo)) fail('Identidad de contado inválida.');
    const active = new Set(backup.tables.formulas_precios.filter(f => f.activo).map(f => Number(f.id)));
    if (backup.tables.suplidores.some(s => s.formula_id !== null && !active.has(Number(s.formula_id))))
      fail('El respaldo contiene una referencia a una fórmula inexistente o inactiva.');
  }
  return layout;
}
