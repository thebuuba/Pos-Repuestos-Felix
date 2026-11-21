import { initialState, validateState } from './state.js';

const $ = (id) => document.getElementById(id);
const h = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const money = (value) => value.toFixed(2);
const today = () => new Date().toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo' });
const nextId = (records) => records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
let revision = null;
let sessionId = null;
let ready = false;
let saving = false;
let carrito = [];
let carritoCompra = [];
window.db = { ...structuredClone(initialState), productos: [], clientes: [], suplidores: [] };

function status(text, ok = false) {
  $('database-status').textContent = text;
  $('database-status').style.background = ok ? '#287b3c' : '#a32936';
}

async function request(method, body) {
  const response = await fetch('/api/state', {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'No se confirmó la operación.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function applyState(result) {
  window.db = validateState(result.state);
  revision = result.revision;
  sessionId = result.sessionId;
  ready = true;
  status(`Conectado: ${result.databaseLabel}`, true);
  actualizarVistas();
}

async function cargarDatos() {
  try { applyState(await request('GET')); return true; }
  catch {
    ready = false;
    status('Sin conexión. Pulsa Actualizar datos para reintentar.');
    return false;
  }
}

window.actualizarDatos = async function () {
  if (saving) return;
  if (!await cargarDatos()) alert('No se pudo conectar con la base de datos. Revisa que el servidor esté iniciado.');
};

async function guardarCambio(change) {
  if (saving) return false;
  if (!ready) { alert('Actualiza los datos antes de guardar.'); return false; }
  let candidate;
  try {
    candidate = structuredClone(window.db);
    change(candidate);
    candidate = validateState(candidate);
  } catch (error) { alert(error.message); return false; }
  saving = true;
  document.body.inert = true;
  status('Guardando…');
  try {
    applyState(await request('PUT', { state: candidate, revision, sessionId }));
    return true;
  } catch (error) {
    if (error.status === 409) {
      await cargarDatos();
      alert('Otra sesión cambió los datos o el servidor cambió de base. Se actualizaron los datos disponibles; conserva y revisa tu operación antes de reintentar.');
    } else if (error.status === 400 || error.status === 413) {
      status('No se guardó la operación. Revisa los datos.');
      alert(error.message);
    } else {
      ready = false;
      status('Guardado sin confirmar. Actualiza los datos.');
      alert('No se confirmó el guardado. Conservamos el formulario y el carrito. Actualiza los datos y revisa los reportes antes de reintentar para evitar duplicar una operación.');
    }
    return false;
  } finally { saving = false; document.body.inert = false; }
}

function numeric(id, label, integer = false) {
  const raw = $(id).value.trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`Escribe un valor válido para ${label}.`);
  }
  return value;
}

function clear(ids) { ids.forEach((id) => { $(id).value = ''; }); }

window.abrirVentana = function (id) {
  document.querySelectorAll('.ventana').forEach((view) => view.classList.remove('activa'));
  $(id)?.classList.add('activa');
  if (id === 'win-config') {
    $('cfg-empresa').value = window.db.empresa;
    $('cfg-itbis').value = window.db.itbisRate * 100;
  }
  actualizarVistas();
};

window.calcularPreciosAutomaticos = function () {
  const cost = Number($('prod-costo').value) || 0;
  ['prod-p1', 'prod-p2', 'prod-p3'].forEach((id, i) => { $(id).value = money(cost * [1.35, 1.25, 1.15][i]); });
};

window.editarProducto = function (code) {
  const p = window.db.productos.find((entry) => entry.codigo === code);
  if (!p) return;
  for (const [field, key] of Object.entries({ codigo: 'codigo', nombre: 'nombre', costo: 'costo', stock: 'stock', p1: 'precio1', p2: 'precio2', p3: 'precio3' })) {
    $(`prod-${field}`).value = p[key];
  }
};

window.guardarProducto = async function () {
  try {
    const product = {
      codigo: $('prod-codigo').value.trim(), nombre: $('prod-nombre').value.trim(),
      costo: numeric('prod-costo', 'costo'), stock: numeric('prod-stock', 'existencia', true),
      precio1: numeric('prod-p1', 'precio 1'), precio2: numeric('prod-p2', 'precio 2'), precio3: numeric('prod-p3', 'precio 3'),
    };
    if (await guardarCambio((data) => {
      const existing = data.productos.find((p) => p.codigo.toLowerCase() === product.codigo.toLowerCase());
      if (existing) Object.assign(existing, { ...product, codigo: existing.codigo });
      else data.productos.push(product);
    })) {
      clear(['prod-codigo', 'prod-nombre', 'prod-costo', 'prod-stock', 'prod-p1', 'prod-p2', 'prod-p3']);
      alert('Artículo guardado.');
    }
  } catch (error) { alert(error.message); }
};

window.eliminarProducto = async function (code) {
  if (confirm('¿Eliminar artículo?')) await guardarCambio((data) => { data.productos = data.productos.filter((p) => p.codigo !== code); });
};

window.autocompletarCompra = function () {
  const code = $('comp-codigo').value.trim().toLowerCase();
  const p = window.db.productos.find((entry) => entry.codigo.toLowerCase() === code);
  if (p) { $('comp-nombre').value = p.nombre; $('comp-costo').value = p.costo; window.recalcularLineaCompra(); }
};

window.recalcularLineaCompra = function () {
  const cost = Number($('comp-costo').value) || 0;
  const rule = $('comp-regla-suplidor').value;
  let prices;
  const factors = { supergato: 1.062, arias: 1.12, almonte_ast: 1.18, masotti: 1 };
  if (Object.hasOwn(factors, rule)) {
    const p1 = cost * factors[rule];
    prices = [p1, p1 * 1.13, p1 * 1.13 * 1.15];
  } else prices = [cost * 1.35, cost * 1.25, cost * 1.15];
  ['comp-p1', 'comp-p2', 'comp-p3'].forEach((id, i) => { $(id).value = money(prices[i]); });
};

window.agregarLineaCompra = function () {
  try {
    const line = {
      codigo: $('comp-codigo').value.trim(), nombre: $('comp-nombre').value.trim(),
      cant: numeric('comp-cantidad', 'cantidad', true), costo: numeric('comp-costo', 'costo'),
      p1: numeric('comp-p1', 'precio 1'), p2: numeric('comp-p2', 'precio 2'), p3: numeric('comp-p3', 'precio 3'),
    };
    if (!line.codigo || !line.nombre || line.cant < 1) throw new Error('Completa código, descripción y cantidad mayor que cero.');
    line.subtotal = line.cant * line.costo;
    carritoCompra.push(line);
    clear(['comp-codigo', 'comp-nombre', 'comp-costo', 'comp-p1', 'comp-p2', 'comp-p3']);
    $('comp-cantidad').value = 1;
    renderizarCarritoCompra();
  } catch (error) { alert(error.message); }
};

window.quitarLineaCompra = function (index) { carritoCompra.splice(index, 1); renderizarCarritoCompra(); };
function renderizarCarritoCompra() {
  $('tabla-detalle-compra').innerHTML = carritoCompra.map((item, index) => `<tr>
    <td>${h(item.codigo)}</td><td>${h(item.nombre)}</td><td>${item.cant}</td><td>${money(item.costo)}</td>
    <td>${money(item.p1)}</td><td>${money(item.p2)}</td><td>${money(item.p3)}</td><td>${money(item.subtotal)}</td>
    <td><button class="btn-peligro" onclick="quitarLineaCompra(${index})" aria-label="Quitar línea">X</button></td></tr>`).join('');
  $('comp-total').textContent = money(carritoCompra.reduce((sum, item) => sum + item.subtotal, 0));
}

window.procesarFacturaCompra = async function () {
  if (!carritoCompra.length) return alert('Agrega artículos primero.');
  const supplier = $('comp-suplidor').value;
  const invoice = $('comp-num-factura').value.trim();
  if (!supplier || !invoice) return alert('Selecciona el suplidor y escribe el número de factura.');
  if (await guardarCambio((data) => {
    if (!data.suplidores.some((s) => s.nombre === supplier)) throw new Error('El suplidor ya no está disponible.');
    if (data.compras.some((c) => c.suplidor === supplier && c.numero.toLowerCase() === invoice.toLowerCase())) {
      throw new Error('Esta factura de compra ya fue registrada para el suplidor.');
    }
    for (const item of carritoCompra) {
      const existing = data.productos.find((p) => p.codigo.toLowerCase() === item.codigo.toLowerCase());
      if (existing) Object.assign(existing, {
        stock: existing.stock + item.cant, costo: item.costo, precio1: item.p1, precio2: item.p2, precio3: item.p3,
      });
      else data.productos.push({
        codigo: item.codigo, nombre: item.nombre, stock: item.cant, costo: item.costo,
        precio1: item.p1, precio2: item.p2, precio3: item.p3,
      });
    }
    data.compras.push({
      id: nextId(data.compras), fecha: today(), suplidor: supplier, numero: invoice,
      items: structuredClone(carritoCompra), total: carritoCompra.reduce((sum, item) => sum + item.subtotal, 0),
    });
  })) {
    carritoCompra = []; $('comp-num-factura').value = ''; renderizarCarritoCompra();
    alert('Compra guardada e inventario actualizado.');
  }
};

window.guardarCliente = async function () {
  const customer = { nombre: $('cli-nombre').value.trim(), rnc: $('cli-rnc').value.trim(), tel: $('cli-tel').value.trim(), deuda: 0 };
  if (await guardarCambio((data) => { data.clientes.push(customer); })) clear(['cli-nombre', 'cli-rnc', 'cli-tel']);
};
window.guardarSuplidor = async function () {
  const supplier = { nombre: $('sup-nombre').value.trim(), rnc: $('sup-rnc').value.trim(), tel: $('sup-tel').value.trim() };
  if (await guardarCambio((data) => { data.suplidores.push(supplier); })) clear(['sup-nombre', 'sup-rnc', 'sup-tel']);
};
window.guardarConfig = async function () {
  try {
    const empresa = $('cfg-empresa').value.trim();
    const rate = numeric('cfg-itbis', 'ITBIS') / 100;
    if (carrito.length && rate !== window.db.itbisRate) throw new Error('Vacía el carrito de ventas antes de cambiar el ITBIS.');
    if (await guardarCambio((data) => { data.empresa = empresa; data.itbisRate = rate; })) alert('Configuración guardada.');
  } catch (error) { alert(error.message); }
};

window.agregarLineaFactura = function () {
  if (!ready) return alert('Actualiza los datos antes de agregar productos.');
  try {
    const search = $('fac-buscar-prod').value.trim().toLowerCase();
    const quantity = numeric('fac-cantidad', 'cantidad', true);
    if (!search || quantity < 1) throw new Error('Escribe el producto y una cantidad mayor que cero.');
    const p = window.db.productos.find((entry) => entry.codigo.toLowerCase() === search) ||
      window.db.productos.find((entry) => entry.nombre.toLowerCase().includes(search));
    if (!p) throw new Error('Producto no encontrado.');
    const reserved = carrito.filter((item) => item.codigo === p.codigo).reduce((sum, item) => sum + item.cant, 0);
    if (reserved + quantity > p.stock) throw new Error(`Stock insuficiente. Disponible: ${p.stock - reserved}.`);
    const price = p[$('fac-nivel-precio').value];
    const subtotal = price * quantity;
    carrito.push({
      codigo: p.codigo, nombre: p.nombre, cant: quantity, precio: price,
      itbis: subtotal - subtotal / (1 + window.db.itbisRate), subtotal,
    });
    $('fac-buscar-prod').value = ''; $('fac-cantidad').value = 1;
    renderizarCarrito();
  } catch (error) { alert(error.message); }
};

window.quitarLineaFactura = function (index) { carrito.splice(index, 1); renderizarCarrito(); };
function renderizarCarrito() {
  $('tabla-detalle-factura').innerHTML = carrito.map((item, index) => `<tr>
    <td>${h(item.codigo)}</td><td>${h(item.nombre)}</td><td>${item.cant}</td>
    <td>${money(item.precio)}</td><td>${money(item.itbis)}</td><td>${money(item.subtotal)}</td>
    <td><button class="btn-peligro" onclick="quitarLineaFactura(${index})" aria-label="Quitar línea">X</button></td></tr>`).join('');
  const total = carrito.reduce((sum, item) => sum + item.subtotal, 0);
  const tax = carrito.reduce((sum, item) => sum + item.itbis, 0);
  $('fac-subtotal').textContent = money(total - tax);
  $('fac-itbis').textContent = money(tax);
  $('fac-total').textContent = money(total);
}

window.procesarFactura = async function () {
  if (!carrito.length) return alert('Agrega artículos primero.');
  let invoice;
  const customer = $('fac-cliente').value;
  const ncf = $('fac-ncf').value;
  const condition = $('fac-condicion').value;
  if (await guardarCambio((data) => {
    const client = data.clientes.find((c) => c.nombre === customer);
    if (!client) throw new Error('Selecciona un cliente válido.');
    for (const item of carrito) {
      const p = data.productos.find((entry) => entry.codigo === item.codigo);
      if (!p || p.stock < item.cant) throw new Error(`Revisa la existencia de ${item.codigo}.`);
      p.stock -= item.cant;
    }
    const id = nextId(data.facturas);
    const items = carrito.map((item) => ({ ...item, itbis: item.subtotal - item.subtotal / (1 + data.itbisRate) }));
    invoice = {
      id, fecha: today(), cliente: customer, ncf: `${ncf}-${String(id).padStart(8, '0')}`,
      condicion: condition, items, total: Number(money(items.reduce((sum, item) => sum + item.subtotal, 0))),
    };
    if (condition === 'Credito') client.deuda = Number(money(client.deuda + invoice.total));
    data.facturas.push(invoice);
  })) {
    carrito = []; renderizarCarrito(); window.imprimirTicket(invoice);
  }
};

window.imprimirTicket = function (invoice) {
  const popup = window.open('', '', 'width=350,height=600');
  if (!popup) { alert('La factura está guardada. Permite ventanas emergentes o reimprímela desde Reportes.'); return; }
  popup.document.write(`<!doctype html><html lang="es"><meta charset="UTF-8"><title>Factura ${invoice.id}</title>
    <body style="font-family:monospace;width:280px;font-size:12px"><h3>${h(window.db.empresa)}</h3>
    <p>Factura #${invoice.id}<br>Fecha: ${h(invoice.fecha)}<br>NCF: ${h(invoice.ncf)}<br>Cliente: ${h(invoice.cliente)}</p>
    <hr>${invoice.items.map((item) => `${item.cant} x ${h(item.nombre)} - RD$ ${money(item.subtotal)}`).join('<br>')}
    <hr><h4>TOTAL: RD$ ${money(invoice.total)}</h4><p>¡Gracias por su compra!</p></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
};

window.exportarRespaldo = function () {
  if (!ready) return alert('Actualiza los datos antes de exportar el respaldo.');
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(window.db, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'respaldo_repuestos_felix.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.importarRespaldo = async function (event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('El respaldo supera 10 MB.');
    const restored = validateState(JSON.parse(await file.text()));
    if (!confirm('¿Reemplazar todos los datos de la base seleccionada con este respaldo?')) return;
    if (await guardarCambio((data) => { Object.assign(data, restored); })) {
      carrito = []; carritoCompra = []; renderizarCarrito(); renderizarCarritoCompra();
      alert('Respaldo restaurado en la base seleccionada.');
    }
  } catch (error) { alert(`No se pudo restaurar: ${error.message}`); }
  finally { event.target.value = ''; }
};

window.reiniciarSistema = async function () {
  if (!confirm('¿Reemplazar todos los datos de la base seleccionada por los datos de ejemplo?')) return;
  if (await guardarCambio((data) => { Object.assign(data, structuredClone(initialState)); })) {
    carrito = []; carritoCompra = []; renderizarCarrito(); renderizarCarritoCompra();
  }
};

function options(id, records) {
  const selected = $(id).value;
  $(id).innerHTML = records.map((record) => `<option value="${h(record.nombre)}">${h(record.nombre)}</option>`).join('');
  if (records.some((record) => record.nombre === selected)) $(id).value = selected;
}

function actualizarVistas() {
  const data = window.db;
  $('nombre-negocio').textContent = data.empresa;
  $('fac-itbis-label').textContent = `ITBIS (${Number((data.itbisRate * 100).toFixed(2))}%): RD$ `;
  $('lista-productos').innerHTML = data.productos.map((p) => `<option value="${h(p.codigo)}">${h(p.nombre)} (Stock: ${p.stock})</option>`).join('');
  $('tabla-inventario').innerHTML = data.productos.map((p) => `<tr>
    <td>${h(p.codigo)}</td><td>${h(p.nombre)}</td><td>${p.stock}</td><td>${money(p.costo)}</td>
    <td>${money(p.precio1)}</td><td>${money(p.precio2)}</td><td>${money(p.precio3)}</td>
    <td><button class="btn-azul" data-edit="${h(p.codigo)}">Editar</button>
    <button class="btn-peligro" data-delete="${h(p.codigo)}" aria-label="Eliminar artículo">X</button></td></tr>`).join('');
  options('fac-cliente', data.clientes); options('comp-suplidor', data.suplidores);
  $('tabla-clientes').innerHTML = data.clientes.map((c) => `<tr><td>${h(c.nombre)}</td><td>${h(c.rnc)}</td><td>${h(c.tel)}</td><td>RD$ ${money(c.deuda)}</td></tr>`).join('');
  $('tabla-suplidores').innerHTML = data.suplidores.map((s) => `<tr><td>${h(s.nombre)}</td><td>${h(s.rnc)}</td><td>${h(s.tel)}</td></tr>`).join('');
  $('tabla-compras').innerHTML = data.compras.map((c) => `<tr><td>#${c.id}</td><td>${h(c.fecha)}</td><td>${h(c.suplidor)}</td><td>${h(c.numero)}</td><td>RD$ ${money(c.total)}</td></tr>`).join('');
  $('tabla-facturas').innerHTML = data.facturas.map((f) => `<tr>
    <td>#${f.id}</td><td>${h(f.fecha)}</td><td>${h(f.cliente)}</td><td>${h(f.ncf)}</td><td>${h(f.condicion)}</td>
    <td>RD$ ${money(f.total)}</td><td><button data-print="${f.id}" aria-label="Reimprimir factura">🖨️</button></td></tr>`).join('');
  const cash = data.facturas.filter((f) => f.condicion === 'Contado').reduce((sum, f) => sum + f.total, 0);
  const credit = data.facturas.filter((f) => f.condicion === 'Credito').reduce((sum, f) => sum + f.total, 0);
  $('resumen-caja').innerHTML = `<p><strong>Contado:</strong> RD$ ${money(cash)}</p><p><strong>Crédito:</strong> RD$ ${money(credit)}</p><p><strong>Total:</strong> RD$ ${money(cash + credit)}</p>`;
}

$('tabla-inventario').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.dataset.edit !== undefined) window.editarProducto(button.dataset.edit);
  if (button?.dataset.delete !== undefined) window.eliminarProducto(button.dataset.delete);
});
$('tabla-facturas').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-print]');
  const invoice = window.db.facturas.find((f) => f.id === Number(button?.dataset.print));
  if (invoice) window.imprimirTicket(invoice);
});
const updateClock = () => { $('fecha-hora').textContent = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' }); };
updateClock(); setInterval(updateClock, 1000);
actualizarVistas();
await cargarDatos();
