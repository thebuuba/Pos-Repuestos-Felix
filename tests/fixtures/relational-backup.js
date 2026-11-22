import assert from 'node:assert/strict';

function integralQuantity(value) {
  assert.match(value, /^-?\d+\.00$/);
  return Number(value);
}

function centCost(value) {
  assert.match(value, /^\d+\.\d{2}00$/);
  return value.slice(0, -2);
}

export function historicalBackup(backup, version) {
  assert.equal(backup.version, 5);
  assert.ok([2, 3, 4].includes(version));
  const historical = structuredClone(backup);
  historical.version = version;
  const { tables } = historical;
  for (const row of tables.productos) {
    delete row.notificar_minimo;
    row.stock = integralQuantity(row.stock);
    row.stock_minimo = integralQuantity(row.stock_minimo);
    row.costo = centCost(row.costo);
  }
  for (const row of tables.venta_detalles) row.cantidad = integralQuantity(row.cantidad);
  for (const row of tables.compra_detalles) {
    row.cantidad = integralQuantity(row.cantidad);
    row.costo = centCost(row.costo);
  }
  for (const row of tables.movimientos_inventario) {
    row.cantidad = integralQuantity(row.cantidad);
    row.existencia_posterior = integralQuantity(row.existencia_posterior);
  }

  if (version < 4) {
    delete tables.formulas_precios;
    const addedInV4 = {
      configuracion: ['rnc', 'tel', 'correo', 'direccion', 'redondeo', 'nivel_precio_predeterminado', 'formato_impresion', 'pie_ticket', 'permitir_stock_negativo'],
      clientes: ['correo', 'direccion', 'limite_credito', 'es_contado'],
      suplidores: ['correo', 'contacto', 'dias_credito', 'formula_id'],
    };
    for (const [table, columns] of Object.entries(addedInV4))
      for (const row of tables[table]) for (const column of columns) delete row[column];
  }
  if (version === 2) {
    for (const row of tables.productos)
      for (const column of ['marca', 'categoria', 'ubicacion', 'stock_minimo', 'gravado']) delete row[column];
  }
  return historical;
}
