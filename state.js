export const initialState = {
  empresa: 'REPUESTOS FELIX', itbisRate: 0.18,
  productos: [
    { codigo: 'BUJ-01', nombre: 'Bujía NGK C7HSA', costo: 100, stock: 50, precio1: 150, precio2: 135, precio3: 120 },
    { codigo: 'BUJ-02', nombre: 'Bujía NGK C5HSA', costo: 100, stock: 50, precio1: 150, precio2: 135, precio3: 120 },
  ],
  clientes: [{ nombre: 'Cliente Contado', rnc: '000000000', tel: '', deuda: 0 }],
  suplidores: [
    { nombre: 'Super Gato', rnc: '', tel: '' },
    { nombre: 'Almonte & Asociados', rnc: '', tel: '' },
    { nombre: 'Importadora Masotti', rnc: '', tel: '' },
    { nombre: 'Arias', rnc: '101038561', tel: '809-412-4737' },
  ],
  facturas: [], compras: [],
};

function text(value, field, required = false) {
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) {
    throw new Error(`Revisa el campo ${field}.`);
  }
  return value;
}

function number(value, field, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12 ||
      (integer && !Number.isSafeInteger(value))) throw new Error(`Revisa el campo ${field}.`);
  return value;
}

function collection(value, field) {
  // Firebase omite las listas vacías cuando se exporta su árbol de datos.
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} debe ser una lista.`);
  return value;
}

function item(value, purchase = false) {
  const result = {
    codigo: text(value.codigo, 'código', true), nombre: text(value.nombre, 'descripción', true),
    cant: number(value.cant, 'cantidad', true), subtotal: number(value.subtotal, 'subtotal'),
  };
  if (result.cant < 1) throw new Error('La cantidad debe ser mayor que cero.');
  for (const key of purchase ? ['costo', 'p1', 'p2', 'p3'] : ['precio', 'itbis']) {
    result[key] = number(value[key], key);
  }
  return result;
}

export function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respaldo inválido.');
  const result = {
    empresa: text(value.empresa, 'empresa', true), itbisRate: number(value.itbisRate, 'ITBIS'),
    productos: collection(value.productos, 'Productos').map((p) => {
      const product = { codigo: text(p.codigo, 'código', true), nombre: text(p.nombre, 'descripción', true) };
      for (const key of ['costo', 'stock', 'precio1', 'precio2', 'precio3']) {
        product[key] = number(p[key], key, key === 'stock');
      }
      return product;
    }),
    clientes: collection(value.clientes, 'Clientes').map((c) => ({
      nombre: text(c.nombre, 'cliente', true), rnc: text(c.rnc ?? '', 'RNC'),
      tel: text(c.tel ?? '', 'teléfono'), deuda: number(c.deuda, 'balance'),
    })),
    suplidores: collection(value.suplidores, 'Suplidores').map((s) => ({
      nombre: text(s.nombre, 'suplidor', true), rnc: text(s.rnc ?? '', 'RNC'), tel: text(s.tel ?? '', 'teléfono'),
    })),
    facturas: collection(value.facturas, 'Facturas').map((f) => {
      if (!['Contado', 'Credito'].includes(f.condicion)) throw new Error('Condición de factura inválida.');
      return {
        id: number(f.id, 'número de factura', true), fecha: text(f.fecha, 'fecha', true),
        cliente: text(f.cliente, 'cliente', true), ncf: text(f.ncf, 'NCF', true), condicion: f.condicion,
        items: collection(f.items, 'Detalle de factura').map((i) => item(i)), total: number(f.total, 'total'),
      };
    }),
    compras: collection(value.compras, 'Compras').map((c) => ({
      id: number(c.id, 'número de compra', true), fecha: text(c.fecha, 'fecha', true),
      suplidor: text(c.suplidor, 'suplidor', true), numero: text(c.numero, 'factura de compra', true),
      items: collection(c.items, 'Detalle de compra').map((i) => item(i, true)), total: number(c.total, 'total'),
    })),
  };
  if (result.itbisRate > 1) throw new Error('El ITBIS debe estar entre 0 y 100%.');
  const codes = result.productos.map((p) => p.codigo.toLowerCase());
  if (new Set(codes).size !== codes.length) throw new Error('Hay códigos de productos duplicados.');
  for (const entries of [result.facturas, result.compras]) {
    if (entries.some((entry) => entry.id < 1 || !entry.items.length) ||
        new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw new Error('Hay documentos sin detalle o con números inválidos o duplicados.');
    }
  }
  return result;
}
