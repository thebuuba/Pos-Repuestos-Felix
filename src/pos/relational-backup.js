import { cents, fail, integer, text } from './operation-fields.js';
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
export const tables = {
  configuracion: [...v3.configuracion, 'rnc', 'tel', 'correo', 'direccion', 'redondeo', 'nivel_precio_predeterminado', 'formato_impresion', 'pie_ticket', 'permitir_stock_negativo'],
  clientes: [...v3.clientes, 'correo', 'direccion', 'limite_credito', 'es_contado'],
  formulas_precios: ['id', 'nombre', 'factor_costo', 'recargo1', 'recargo2', 'recargo3', 'activo', 'version', 'creado_en', 'actualizado_en'],
  suplidores: [...v3.suplidores, 'correo', 'contacto', 'dias_credito', 'formula_id'],
  productos: v3.productos, ventas: v3.ventas, venta_detalles: v3.venta_detalles,
  compras: v3.compras, compra_detalles: v3.compra_detalles, movimientos_inventario: v3.movimientos_inventario,
};
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const preferenceFields = { redondeo: 'redondeo', nivel_precio_predeterminado: 'nivelPrecioPredeterminado',
  formato_impresion: 'formatoImpresion', permitir_stock_negativo: 'permitirStockNegativo' };
const moneyColumns = new Set(['costo', 'precio', 'precio1', 'precio2', 'precio3', 'base', 'itbis', 'total']);
function validateBackupRow(table, row, columns) {
  if (!exactKeys(row, columns)) fail(`Fila inválida en ${table}.`);
  if (table === 'formulas_precios') formulaValues(row.factor_costo, row.recargo1, row.recargo2, row.recargo3);
  for (const key of columns) {
    const value = row[key];
    if (key === 'id' || key === 'version' || key.endsWith('_id')) {
      if (value === null && ['venta_detalle_id', 'compra_detalle_id', 'formula_id'].includes(key)) continue;
      if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`Identificador inválido en ${table}.`);
    } else if (table === 'formulas_precios' && ['factor_costo', 'recargo1', 'recargo2', 'recargo3'].includes(key)) continue;
    else if (Object.hasOwn(preferenceFields, key)) settingValue(preferenceFields[key], value);
    else if (key === 'dias_credito') { if (value !== null) integer(value, key, 0); }
    else if (key === 'limite_credito') { if (value !== null) cents(value, key); }
    else if (moneyColumns.has(key)) cents(value, key);
    else if (key === 'saldo_apertura') {
      if (!['string', 'number'].includes(typeof value)) fail('Saldo de apertura inválido.');
      cents(String(value).replace(/^-/, ''), key);
    } else if (key === 'tasa_itbis') {
      if (!['string', 'number'].includes(typeof value) || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(String(value))) fail('Tasa ITBIS inválida.');
    } else if (['stock', 'cantidad', 'existencia_posterior', 'stock_minimo'].includes(key)) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail(`Cantidad inválida en ${table}.`);
      if (key === 'stock_minimo' && value < 0) fail('Existencia mínima inválida.');
    } else if (['activo', 'gravado', 'es_contado'].includes(key)) { if (typeof value !== 'boolean') fail(`Estado inválido en ${table}.`); }
    else if (key === 'fecha') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('Fecha documental inválida.');
    } else if (key.endsWith('_en')) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Fecha de registro inválida.');
    } else if (!(key === 'ncf' && value === null)) text(value, key, !['rnc', 'tel', 'cliente_rnc', 'motivo', 'correo', 'direccion', 'contacto', 'pie_ticket', 'marca', 'categoria', 'ubicacion'].includes(key));
  }
}

export async function rows(client, table) {
  const columns = tables[table].map(key => key === 'fecha' ? 'fecha::text AS fecha' : key).join(',');
  return (await client.query(`SELECT ${columns} FROM public.${table} ORDER BY id`)).rows;
}
export async function exportBackup(client) {
  const data = {};
  for (const table of Object.keys(tables)) data[table] = await rows(client, table);
  return { version: 4, format: 'repuestos-felix-relacional', exportedAt: new Date().toISOString(), tables: data };
}

// Devuelve exclusivamente columnas de nuestra versión. INSERT usa los defaults SQL
// para los atributos ausentes de v2/v3; nunca toma identificadores del archivo.
export function backupLayout(backup) {
  const layout = backup.version === 4 ? tables : backup.version === 3 ? v3 : backup.version === 2 ? v2 : null;
  if (!layout || backup.format !== 'repuestos-felix-relacional' || !exactKeys(backup.tables, Object.keys(layout)))
    fail('Formato de respaldo inválido.');
  for (const [table, columns] of Object.entries(layout)) {
    const entries = backup.tables[table];
    if (!Array.isArray(entries) || entries.length > 100000) fail(`Revisa la tabla ${table}.`);
    for (const row of entries) validateBackupRow(table, row, columns);
  }
  if (backup.tables.configuracion.length !== 1 || Number(backup.tables.configuracion[0].id) !== 1) fail('Configuración de respaldo inválida.');
  if (backup.version === 4) {
    const marked = backup.tables.clientes.filter(c => c.es_contado);
    if (marked.length > 1 || marked.some(c => !c.activo)) fail('Identidad de contado inválida.');
    const active = new Set(backup.tables.formulas_precios.filter(f => f.activo).map(f => Number(f.id)));
    if (backup.tables.suplidores.some(s => s.formula_id !== null && !active.has(Number(s.formula_id))))
      fail('El respaldo contiene una referencia a una fórmula inexistente o inactiva.');
  }
  return layout;
}
