import { createHash, randomUUID } from 'node:crypto';
import { validateState } from './legacy-state.js';

const maintenanceLock = 74198232;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxCents = 99999999999999n;
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, label, required = true) {
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) fail(`Revisa ${label}.`);
  return value.trim();
}
function integer(value, label, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > 2147483647) fail(`Revisa ${label}.`);
  return value;
}
function id(value, label = 'el identificador') {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Revisa ${label}.`);
  return value;
}
function cents(value, label = 'el importe') {
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))) fail(`Revisa ${label}: usa hasta dos decimales.`);
  const [whole, fraction = ''] = String(value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > maxCents) fail(`El importe de ${label} es demasiado alto.`);
  return result;
}
function money(value) {
  if (value < 0n || value > maxCents) fail('El importe excede el límite permitido.');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function prices(body) { return ['costo', 'precio1', 'precio2', 'precio3'].map(key => money(cents(body[key], key))); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const number = value => {
  const result = Number(value);
  if (!Number.isFinite(result) || (typeof value === 'string' && /^\d+$/.test(value) && !Number.isSafeInteger(result))) fail('Identificador fuera del límite admitido.', 503);
  return result;
};
const date = value => String(value).slice(0, 10);
const displayDate = value => { const [year, month, day] = date(value).split('-'); return `${Number(day)}/${Number(month)}/${year}`; };

// Fixed column lists are shared by export/import; no names come from uploaded SQL.
const tables = {
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
const catalogDefaults = { marca: '', categoria: '', ubicacion: '', stock_minimo: 0, gravado: true };
const v2Tables = { ...tables, productos: tables.productos.filter(column => !(column in catalogDefaults)) };
const moneyColumns = new Set(['costo', 'precio', 'precio1', 'precio2', 'precio3', 'base', 'itbis', 'total']);
function validateBackupRow(table, row, columns) {
  if (!row || Object.keys(row).sort().join() !== [...columns].sort().join()) fail(`Fila inválida en ${table}.`);
  for (const key of columns) {
    const value = row[key];
    if (key === 'id' || key === 'version' || key.endsWith('_id')) {
      if (value === null && ['venta_detalle_id', 'compra_detalle_id'].includes(key)) continue;
      if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`Identificador inválido en ${table}.`);
    } else if (moneyColumns.has(key)) cents(value, key);
    else if (key === 'saldo_apertura') {
      if (!['string', 'number'].includes(typeof value)) fail('Saldo de apertura inválido.');
      cents(String(value).replace(/^-/, ''), key);
    } else if (key === 'tasa_itbis') {
      if (!['string', 'number'].includes(typeof value) || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(String(value))) fail('Tasa ITBIS inválida.');
    } else if (['stock', 'cantidad', 'existencia_posterior', 'stock_minimo'].includes(key)) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail(`Cantidad inválida en ${table}.`);
      if (key === 'stock_minimo' && value < 0) fail('Existencia mínima inválida.');
    } else if (['activo', 'gravado'].includes(key)) { if (typeof value !== 'boolean') fail(`Estado inválido en ${table}.`); }
    else if (key === 'fecha') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('Fecha documental inválida.');
    } else if (key.endsWith('_en')) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Fecha de registro inválida.');
    } else if (!(key === 'ncf' && value === null)) text(value, key, !['rnc', 'tel', 'cliente_rnc', 'motivo', 'marca', 'categoria', 'ubicacion'].includes(key));
  }
}

async function rows(client, table) {
  const columns = tables[table].map(key => key === 'fecha' ? 'fecha::text AS fecha' : key).join(',');
  return (await client.query(`SELECT ${columns} FROM public.${table} ORDER BY id`)).rows;
}
async function exportBackup(client) {
  const data = {};
  for (const table of Object.keys(tables)) data[table] = await rows(client, table);
  return { version: 3, format: 'repuestos-felix-relacional', exportedAt: new Date().toISOString(), tables: data };
}
async function snapshotVersion(client, databaseLabel) {
  const system = (await client.query('SELECT database_id,revision FROM pos_privado.sistema WHERE id=1')).rows[0];
  if (!system) fail('Ejecuta las migraciones de la base antes de iniciar.', 503);
  return { databaseId: system.database_id, revision: number(system.revision), databaseLabel };
}
async function snapshot(client, databaseLabel) {
  const version = await snapshotVersion(client, databaseLabel);
  const data = {};
  for (const table of Object.keys(tables)) data[table] = await rows(client, table);
  const config = data.configuracion[0];
  if (!config) fail('La configuración de la base está incompleta.', 503);
  const saleItems = row => data.venta_detalles.filter(d => d.venta_id === row.id).map(d => ({ id: number(d.id), productoId: number(d.producto_id), codigo: d.codigo, nombre: d.nombre, cant: d.cantidad, precio: Number(d.precio), base: Number(d.base), itbis: Number(d.itbis), subtotal: Number(d.total) }));
  const purchaseItems = row => data.compra_detalles.filter(d => d.compra_id === row.id).map(d => ({ id: number(d.id), productoId: number(d.producto_id), codigo: d.codigo, nombre: d.nombre, cant: d.cantidad, costo: Number(d.costo), p1: Number(d.precio1), p2: Number(d.precio2), p3: Number(d.precio3), subtotal: Number(d.total) }));
  const balances = (await client.query(`SELECT c.id,(c.saldo_apertura+COALESCE(sum(v.total) FILTER(WHERE v.condicion='Credito'),0))::text AS deuda
    FROM clientes c LEFT JOIN ventas v ON v.cliente_id=c.id GROUP BY c.id`)).rows;
  return {
    ...version,
    state: {
      empresa: config.empresa, itbisRate: Number(config.tasa_itbis), configuracionVersion: number(config.version),
      productos: data.productos.filter(p => p.activo).map(p => ({ ...p, id: number(p.id), version: number(p.version), stockMinimo: p.stock_minimo, costo: Number(p.costo), precio1: Number(p.precio1), precio2: Number(p.precio2), precio3: Number(p.precio3) })),
      clientes: data.clientes.filter(c => c.activo).map(c => ({ id: number(c.id), version: number(c.version), nombre: c.nombre, rnc: c.rnc, tel: c.tel, deuda: Number(balances.find(b => b.id === c.id).deuda) })),
      suplidores: data.suplidores.filter(s => s.activo).map(s => ({ id: number(s.id), version: number(s.version), nombre: s.nombre, rnc: s.rnc, tel: s.tel })),
      facturas: data.ventas.map(v => ({ id: number(v.id), clienteId: number(v.cliente_id), cliente: v.cliente_nombre, clienteRnc: v.cliente_rnc, ncf: v.ncf, tipoComprobante: v.tipo_comprobante, fecha: displayDate(v.fecha), fechaISO: date(v.fecha), condicion: v.condicion, base: Number(v.base), itbis: Number(v.itbis), total: Number(v.total), items: saleItems(v) })),
      compras: data.compras.map(c => ({ id: number(c.id), suplidorId: number(c.suplidor_id), suplidor: c.suplidor_nombre, numero: c.numero, fecha: displayDate(c.fecha), fechaISO: date(c.fecha), total: Number(c.total), items: purchaseItems(c) })),
      movimientos: data.movimientos_inventario.map(m => ({ ...m, id: number(m.id), productoId: number(m.producto_id) })),
    },
  };
}
export async function readSnapshot(pool, databaseLabel, backup = false, matchesVersion) {
  const client = await pool.connect();
  try {
    if (!backup && matchesVersion) {
      const version = await snapshotVersion(client, databaseLabel);
      if (matchesVersion(version)) return { notModified: version };
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await client.query('SELECT pg_advisory_xact_lock_shared($1)', [maintenanceLock]);
      const result = backup ? await exportBackup(client) : await snapshot(client, databaseLabel);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { client.release(); }
}
async function movement(client, productId, quantity, stock, type, detailId = null, reason = '') {
  if (!quantity) return;
  await client.query(`INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [productId, quantity, stock, type, type === 'venta' ? detailId : null, type === 'compra' ? detailId : null, reason]);
}
async function productOperation(client, method, productId, body) {
  let code, name, stock, amounts;
  if (method !== 'DELETE') {
    code = text(body.codigo, 'el código'); name = text(body.nombre, 'la descripción');
    stock = integer(body.stock, 'las existencias', 0); amounts = prices(body);
    const oldCode = productId ? (await client.query('SELECT codigo FROM productos WHERE id=$1', [productId])).rows[0]?.codigo : null;
    for (const lockCode of [...new Set([code, oldCode].filter(Boolean).map(value => value.toLowerCase()))].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['producto:' + lockCode]);
    }
  }
  let previous;
  if (productId) {
    previous = (await client.query('SELECT * FROM productos WHERE id=$1 FOR UPDATE', [productId])).rows[0];
    if (!previous || !previous.activo || number(previous.version) !== id(body.version, 'la versión')) fail('El producto cambió. Actualiza los datos antes de editar.', 409);
  }
  if (method === 'DELETE') {
    await client.query('UPDATE productos SET activo=false,version=version+1,actualizado_en=now() WHERE id=$1', [productId]);
    return { id: productId };
  }
  const attribute = (key, fallback) => body[key] === undefined ? previous?.[key] ?? fallback : body[key];
  const attributeText = (key, label = key) => body[key] === undefined ? previous?.[key] ?? '' : text(body[key], label, false);
  const metadata = ['marca', 'categoria'].map(key => attributeText(key));
  metadata.push(integer(body.stockMinimo === undefined ? previous?.stock_minimo ?? 0 : body.stockMinimo, 'la existencia mínima', 0));
  const taxable = attribute('gravado', true);
  if (typeof taxable !== 'boolean') fail('La gravabilidad debe ser booleana.');
  metadata.push(taxable, attributeText('ubicacion', 'la ubicación'));
  // Code locks precede row locks, matching purchases and protecting new codes.
  const result = productId
    ? await client.query(`UPDATE productos SET codigo=$2,nombre=$3,costo=$4,precio1=$5,precio2=$6,precio3=$7,stock=$8,marca=$9,categoria=$10,stock_minimo=$11,gravado=$12,ubicacion=$13,version=version+1,actualizado_en=now() WHERE id=$1 RETURNING id`, [productId, code, name, ...amounts, stock, ...metadata])
    : await client.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock,marca,categoria,stock_minimo,gravado,ubicacion) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [code, name, ...amounts, stock, ...metadata]);
  const savedId = number(result.rows[0].id);
  await movement(client, savedId, stock - (previous?.stock || 0), stock, previous ? 'ajuste' : 'apertura', null, previous ? 'Ajuste desde catálogo' : 'Existencia inicial');
  return { id: savedId };
}
async function sale(client, body) {
  const customer = (await client.query('SELECT * FROM clientes WHERE id=$1 AND activo FOR SHARE', [id(body.clienteId)])).rows[0];
  if (!customer) fail('Selecciona un cliente activo.');
  if (!['Contado', 'Credito'].includes(body.condicion) || !['B01', 'B02', 'B14'].includes(body.tipoComprobante)) fail('Condición o tipo de comprobante inválido.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000) fail('La venta debe tener entre 1 y 1000 líneas.');
  const quantities = new Map();
  for (const item of body.items) {
    id(item.productoId); integer(item.cantidad, 'la cantidad');
    if (!['precio1', 'precio2', 'precio3'].includes(item.nivelPrecio)) fail('Nivel de precio inválido.');
    quantities.set(item.productoId, integer((quantities.get(item.productoId) || 0) + item.cantidad, 'la cantidad total'));
  }
  const products = (await client.query('SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[...quantities.keys()].sort((a, b) => a - b)])).rows;
  for (const [productId, quantity] of quantities) {
    const p = products.find(p => number(p.id) === productId);
    if (!p?.activo || p.stock < quantity) fail('Producto no disponible o existencias insuficientes. Actualiza el carrito.', 409);
  }
  const config = (await client.query('SELECT tasa_itbis FROM configuracion WHERE id=1 FOR SHARE')).rows[0];
  const rate = BigInt(Math.round(Number(config.tasa_itbis) * 1000000));
  const lines = body.items.map(item => {
    const p = products.find(p => number(p.id) === item.productoId);
    const price = cents(p[item.nivelPrecio]); const total = price * BigInt(item.cantidad); money(total);
    const divisor = 1000000n + (p.gravado ? rate : 0n); const base = (total * 1000000n + divisor / 2n) / divisor;
    return { item, p, price, total, base, tax: total - base };
  });
  const totals = lines.reduce((sum, line) => ({ base: sum.base + line.base, tax: sum.tax + line.tax, total: sum.total + line.total }), { base: 0n, tax: 0n, total: 0n });
  const header = (await client.query(`INSERT INTO ventas(cliente_id,cliente_nombre,cliente_rnc,condicion,tipo_comprobante,base,itbis,total)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [customer.id, customer.nombre, customer.rnc, body.condicion, body.tipoComprobante, money(totals.base), money(totals.tax), money(totals.total)])).rows[0];
  for (const line of lines) {
    const { item, p } = line;
    const detail = (await client.query(`INSERT INTO venta_detalles(venta_id,producto_id,codigo,nombre,cantidad,nivel_precio,precio,base,itbis,total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [header.id, p.id, p.codigo, p.nombre, item.cantidad, item.nivelPrecio, money(line.price), money(line.base), money(line.tax), money(line.total)])).rows[0];
    p.stock -= item.cantidad;
    await client.query('UPDATE productos SET stock=$2,version=version+1,actualizado_en=now() WHERE id=$1', [p.id, p.stock]);
    await movement(client, p.id, -item.cantidad, p.stock, 'venta', detail.id);
  }
  return { id: number(header.id) };
}
async function purchase(client, body) {
  const supplier = (await client.query('SELECT * FROM suplidores WHERE id=$1 AND activo FOR SHARE', [id(body.suplidorId)])).rows[0];
  if (!supplier) fail('Selecciona un suplidor activo.');
  const invoice = text(body.numero, 'la factura del suplidor');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000) fail('La compra debe tener entre 1 y 1000 líneas.');
  const lines = body.items.map(item => ({ code: text(item.codigo, 'el código'), name: text(item.nombre, 'la descripción'), quantity: integer(item.cantidad, 'la cantidad'), amounts: prices(item) }));
  const codes = [...new Set(lines.map(line => line.code.toLowerCase()))].sort();
  for (const code of codes) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['producto:' + code]);
  // Lock existing products by id (same order as sales and catalog edits).
  await client.query('SELECT id FROM productos WHERE lower(codigo)=ANY($1::text[]) ORDER BY id FOR UPDATE', [codes]);
  const total = lines.reduce((sum, line) => sum + cents(line.amounts[0]) * BigInt(line.quantity), 0n);
  const header = (await client.query(`INSERT INTO compras(suplidor_id,suplidor_nombre,numero,fecha,total)
    VALUES($1,$2,$3,(now() AT TIME ZONE 'America/Santo_Domingo')::date,$4) RETURNING id`, [supplier.id, supplier.nombre, invoice, money(total)])).rows[0];
  for (const line of lines) {
    const product = (await client.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (lower(codigo)) DO UPDATE SET nombre=EXCLUDED.nombre,costo=EXCLUDED.costo,precio1=EXCLUDED.precio1,precio2=EXCLUDED.precio2,precio3=EXCLUDED.precio3,
      stock=productos.stock+EXCLUDED.stock,activo=true,version=productos.version+1,actualizado_en=now() RETURNING id,stock`, [line.code, line.name, ...line.amounts, line.quantity])).rows[0];
    const detail = (await client.query(`INSERT INTO compra_detalles(compra_id,producto_id,codigo,nombre,cantidad,costo,precio1,precio2,precio3,total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [header.id, product.id, line.code, line.name, line.quantity, ...line.amounts, money(cents(line.amounts[0]) * BigInt(line.quantity))])).rows[0];
    await movement(client, product.id, line.quantity, product.stock, 'compra', detail.id);
  }
  return { id: number(header.id) };
}

async function restore(client, body) {
  const current = (await client.query('SELECT revision FROM pos_privado.sistema WHERE id=1 FOR UPDATE')).rows[0];
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Revisión inválida.');
  if (number(current.revision) !== body.revision) fail('La base cambió. Exporta o actualiza antes de restaurar.', 409);
  const backup = body.backup;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) fail('Respaldo inválido.');
  let legacy, restoredTables;
  if (![2, 3].includes(backup.version)) { try { legacy = validateState(backup); } catch (error) { fail(error.message); } }
  else {
    if (backup.format !== 'repuestos-felix-relacional' || !backup.tables || Object.keys(backup.tables).sort().join() !== Object.keys(tables).sort().join()) fail('Formato de respaldo inválido.');
    const expectedTables = backup.version === 2 ? v2Tables : tables;
    for (const [table, columns] of Object.entries(expectedTables)) {
      const entries = backup.tables[table];
      if (!Array.isArray(entries) || entries.length > 100000) fail(`Revisa la tabla ${table}.`);
      for (const row of entries) validateBackupRow(table, row, columns);
    }
    if (backup.tables.configuracion.length !== 1 || Number(backup.tables.configuracion[0].id) !== 1) fail('Configuración de respaldo inválida.');
    restoredTables = backup.version === 2
      ? { ...backup.tables, productos: backup.tables.productos.map(row => ({ ...row, ...catalogDefaults })) }
      : backup.tables;
  }
  await client.query('INSERT INTO pos_privado.respaldos(motivo,datos) VALUES($1,$2)', ['Antes de restaurar', await exportBackup(client)]);
  for (const table of Object.keys(tables).reverse()) await client.query(`DELETE FROM public.${table}`);
  if (legacy) await client.query('SELECT pos_privado.importar_estado_legacy($1::jsonb)', [legacy]);
  else {
    for (const [table, columns] of Object.entries(tables)) {
      for (const row of restoredTables[table]) {
        await client.query(`INSERT INTO public.${table}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      }
    }
    const invalid = await client.query(`SELECT 1 FROM ventas v LEFT JOIN venta_detalles d ON d.venta_id=v.id GROUP BY v.id
      HAVING count(d.id)=0 OR v.total<>sum(d.total) OR v.base<>sum(d.base) OR v.itbis<>sum(d.itbis)
      UNION ALL SELECT 1 FROM compras c LEFT JOIN compra_detalles d ON d.compra_id=c.id GROUP BY c.id HAVING count(d.id)=0 OR c.total<>sum(d.total)
      UNION ALL SELECT 1 FROM productos p LEFT JOIN LATERAL (SELECT existencia_posterior FROM movimientos_inventario m WHERE m.producto_id=p.id ORDER BY id DESC LIMIT 1) m ON true WHERE p.stock<>COALESCE(m.existencia_posterior,0)
      UNION ALL SELECT 1 FROM (SELECT cantidad,existencia_posterior,lag(existencia_posterior,1,0) OVER(PARTITION BY producto_id ORDER BY id) previa FROM movimientos_inventario) m WHERE existencia_posterior<>previa+cantidad
      UNION ALL SELECT 1 FROM movimientos_inventario m JOIN venta_detalles d ON d.id=m.venta_detalle_id WHERE m.producto_id<>d.producto_id OR m.cantidad<>-d.cantidad
      UNION ALL SELECT 1 FROM movimientos_inventario m JOIN compra_detalles d ON d.id=m.compra_detalle_id WHERE m.producto_id<>d.producto_id OR m.cantidad<>d.cantidad LIMIT 1`);
    if (invalid.rowCount) fail('El respaldo contiene totales o movimientos inconsistentes.');
    for (const table of Object.keys(tables).filter(table => table !== 'configuracion')) await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),COALESCE((SELECT max(id) FROM public.${table}),1),(SELECT count(*)>0 FROM public.${table}))`);
  }
  const databaseId = randomUUID();
  await client.query('UPDATE pos_privado.sistema SET database_id=$1 WHERE id=1', [databaseId]);
  return { id: databaseId };
}

async function execute(client, method, path, body) {
  const productMatch = path.match(/^\/api\/productos\/(\d+)$/);
  if ((path === '/api/productos' && method === 'POST') || (productMatch && ['PUT', 'DELETE'].includes(method))) return productOperation(client, method, productMatch ? id(Number(productMatch[1])) : null, body);
  if (method === 'POST' && ['/api/clientes', '/api/suplidores'].includes(path)) {
    const table = path.endsWith('clientes') ? 'clientes' : 'suplidores';
    const row = (await client.query(`INSERT INTO ${table}(nombre,rnc,tel) VALUES($1,$2,$3) RETURNING id`, [text(body.nombre, 'el nombre'), text(body.rnc ?? '', 'el RNC', false), text(body.tel ?? '', 'el teléfono', false)])).rows[0];
    return { id: number(row.id) };
  }
  if (method === 'PUT' && path === '/api/configuracion') {
    const company = text(body.empresa, 'la empresa'); const percent = Number(body.itbisPorcentaje);
    if (!['string', 'number'].includes(typeof body.itbisPorcentaje) || !/^\d{1,3}(?:\.\d{1,4})?$/.test(String(body.itbisPorcentaje)) || percent > 100) fail('ITBIS debe estar entre 0 y 100%.');
    const result = await client.query('UPDATE configuracion SET empresa=$1,tasa_itbis=$2,version=version+1,actualizado_en=now() WHERE id=1 AND version=$3 RETURNING id', [company, (percent / 100).toFixed(6), id(body.version, 'la versión')]);
    if (!result.rowCount) fail('La configuración cambió. Actualiza antes de guardar.', 409);
    return { id: 1 };
  }
  if (method === 'POST' && path === '/api/ventas') return sale(client, body);
  if (method === 'POST' && path === '/api/compras') return purchase(client, body);
  if (method === 'POST' && path === '/api/restore') return restore(client, body);
  fail('Ruta de operación no encontrada.', 404);
}
export async function writeOperation(pool, method, path, body, key, databaseLabel) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !uuid.test(body.databaseId) || !uuid.test(key || '')) fail('Se requiere databaseId e Idempotency-Key UUID válidos.');
  const client = await pool.connect();
  const type = method + ' ' + path;
  const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
  try {
    await client.query('BEGIN');
    await client.query(`SELECT ${path === '/api/restore' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}($1)`, [maintenanceLock]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['solicitud:' + key]);
    const system = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1')).rows[0];
    const previous = (await client.query('SELECT tipo,huella,resultado FROM pos_privado.solicitudes WHERE clave=$1', [key])).rows[0];
    let result;
    if (previous) {
      if (previous.tipo !== type || previous.huella !== fingerprint) fail('Esta clave ya se usó para otra operación.', 409);
      // Ordinary writes hold this row through COMMIT. A replay must likewise
      // freeze committed revisions while reading the multi-table response.
      const replaySystem = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1 FOR SHARE')).rows[0];
      if (previous.resultado.databaseId !== replaySystem.database_id) fail('La base fue restaurada. Actualiza antes de continuar.', 409);
      result = previous.resultado.result;
    } else {
      if (body.databaseId !== system.database_id) fail('La base cambió. Actualiza los datos antes de guardar.', 409);
      result = await execute(client, method, path, body);
      await client.query('UPDATE pos_privado.sistema SET revision=revision+1 WHERE id=1');
      const identity = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1')).rows[0].database_id;
      await client.query('INSERT INTO pos_privado.solicitudes(clave,tipo,huella,resultado) VALUES($1,$2,$3,$4)', [key, type, fingerprint, { result, databaseId: identity }]);
    }
    const response = { ...await snapshot(client, databaseLabel), result };
    await client.query('COMMIT'); return response;
  } catch (error) {
    await client.query('ROLLBACK');
    if (!error.status && ['23502', '23503', '23514', '22003', '22023', '22P02', '22007', '22008', 'P0001'].includes(error.code)) fail('Los datos no cumplen las reglas de integridad. Revisa el formulario o respaldo.');
    if (error.code === '23505') fail('Ya existe un registro con ese código o número de factura.', 409);
    if (['40P01', '40001'].includes(error.code)) fail('Otra caja está usando estos datos. Reintenta la misma operación.', 409);
    throw error;
  } finally { client.release(); }
}
