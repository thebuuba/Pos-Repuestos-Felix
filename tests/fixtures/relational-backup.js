import assert from 'node:assert/strict';

function integralQuantity(value) {
  assert.match(value, /^-?\d+\.00$/);
  return Number(value);
}

function centAmount(value) {
  assert.match(value, /^\d+\.\d{2}00$/);
  return value.slice(0, -2);
}

export function historicalBackup(backup, version) {
  assert.equal(backup.version, 10);
  assert.ok([2, 3, 4, 5, 6, 7, 8, 9].includes(version));
  const historical = structuredClone(backup);
  historical.version = version;
  const { tables } = historical;
  if (version < 10) {
    for (const row of tables.productos) delete row.referencia;
  }
  if (version === 9) return historical;
  if (version < 9) {
    for (const row of tables.compras) {
      for (const col of ['estado', 'anulada_en', 'anulada_por', 'motivo_anulacion']) delete row[col];
    }
  }
  if (version === 8) return historical;
  if (version < 8) {
    delete tables.cuentas_taller;
    delete tables.cuentas_taller_items;
  }
  if (version === 7) return historical;
  if (version < 7) {
    delete tables.secuencias_ncf;
    delete tables.productos_codigos;
    delete tables.abonos_cuentas;
    for (const row of tables.configuracion) delete row.meta_diaria;
    for (const row of tables.ventas) {
      for (const col of ['descuento_porcentaje', 'descuento', 'estado', 'anulada_en', 'anulada_por', 'motivo_anulacion', 'vencimiento', 'version']) delete row[col];
    }
    for (const row of tables.compras) {
      for (const col of ['condicion', 'vencimiento', 'version']) delete row[col];
    }
  }
  if (version === 6) return historical;
  delete tables.turnos_caja;
  delete tables.movimientos_caja;
  for (const row of tables.ventas) { delete row.caja_id; delete row.metodo_pago; }
  for (const entries of Object.values(tables)) for (const row of entries) for (const key of Object.keys(row))
    if (key.endsWith('_en') && row[key] !== null) row[key] = new Date(row[key]).toISOString();
  if (version === 5) return historical;
  for (const row of tables.productos) {
    delete row.notificar_minimo;
    row.stock = integralQuantity(row.stock);
    row.stock_minimo = integralQuantity(row.stock_minimo);
    for (const col of ['costo','precio1','precio2','precio3']) row[col] = centAmount(row[col]);
  }
  for (const row of tables.venta_detalles) {
    row.cantidad = integralQuantity(row.cantidad);
    row.precio = centAmount(row.precio);
  }
  for (const row of tables.compra_detalles) {
    row.cantidad = integralQuantity(row.cantidad);
    for (const col of ['costo','precio1','precio2','precio3']) row[col] = centAmount(row[col]);
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
