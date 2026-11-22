import { setupPWA } from './pwa.js';

const $ = (id) => document.getElementById(id);
const h = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const money = (value) => value.toFixed(2);
let revision = null;
let databaseId = null;
let ready = false;
let saving = false;
let pending = null;
let editingProduct = null;
let editingConfigurationVersion = null;
let editingConfigurationDatabaseId = null;
let cartDatabaseId = null;
let purchaseDatabaseId = null;
let carrito = [];
let carritoCompra = [];
window.db = { empresa: 'REPUESTOS FELIX', itbisRate: .18, productos: [], clientes: [], suplidores: [], facturas: [], compras: [] };

function status(text, ok = false) {
  $('database-status').textContent = text;
  $('database-status').style.background = ok ? '#287b3c' : '#a32936';
}

async function request(method, path = '/api/state', body, key) {
  const response = await fetch(path, {
    method, headers: body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), cache: 'no-store',
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
  const changedDatabase = databaseId && databaseId !== result.databaseId;
  window.db = result.state;
  revision = result.revision;
  databaseId = result.databaseId;
  ready = true;
  $('login-again').hidden = true;
  status(`Conectado: ${result.databaseLabel}`, true);
  actualizarVistas();
  if (changedDatabase) {
    $('fac-cliente').value = ''; $('comp-suplidor').value = '';
    alert('La base cambió o fue restaurada. Los borradores conservan su contenido como referencia. Vacía y reconstruye los carritos; vuelve a seleccionar los registros antes de editar.');
  }
}

async function cargarDatos() {
  try { applyState(await request('GET')); return true; }
  catch (error) {
    ready = false;
    $('login-again').hidden = error.status !== 401;
    status('Sin conexión. Pulsa Actualizar datos para reintentar.');
    return false;
  }
}

window.actualizarDatos = async function () {
  if (saving) return;
  if (!await cargarDatos()) alert('No se pudo conectar con la base de datos. Revisa que el servidor esté iniciado.');
};

function operacionPendiente() {
  if (!pending) return false;
  alert('Hay un guardado sin confirmar. Pulsa Reintentar operación pendiente antes de continuar.');
  return true;
}

function mostrarPendiente() {
  $('pending-operation').hidden = !pending;
  $('workspace').inert = Boolean(pending);
  $('input-respaldo').disabled = Boolean(pending);
}

async function guardarOperacion(method, path, payload, onSuccess = () => {}) {
  if (saving || operacionPendiente()) return;
  if (!ready) return alert('Actualiza los datos antes de guardar.');
  pending = { method, path, body: { ...payload, databaseId }, key: crypto.randomUUID(), onSuccess };
  await enviarPendiente();
}

async function enviarPendiente() {
  if (saving || !pending) return;
  const operation = pending;
  saving = true;
  document.body.inert = true;
  status('Guardando…');
  try {
    const result = await request(operation.method, operation.path, operation.body, operation.key);
    applyState(result);
    pending = null;
    mostrarPendiente();
    operation.onSuccess(result);
  } catch (error) {
    if (error.status >= 400 && error.status < 500) {
      if (![401, 403].includes(error.status) || !operation.uncertain) pending = null;
      if (error.status === 409) await cargarDatos();
      if (error.status === 401) {
        ready = false;
        $('login-again').hidden = false;
      }
      status('No se guardó la operación. Revisa los datos.');
      alert(error.message);
    } else {
      operation.uncertain = true;
      status('Guardado sin confirmar. Reintenta la operación pendiente.');
      alert('No se confirmó el guardado. Conservamos la solicitud y el carrito. Reintenta la operación pendiente: no se duplicará si ya fue guardada.');
    }
  } finally { saving = false; document.body.inert = false; mostrarPendiente(); }
}
window.reintentarOperacion = enviarPendiente;
window.addEventListener('beforeunload', (event) => {
  if (pending || carrito.length || carritoCompra.length) { event.preventDefault(); event.returnValue = ''; }
});

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
  document.querySelectorAll('.menu-item').forEach((menu) => { menu.open = false; });
  if (window.innerWidth <= 760) $('main-menu').open = false;
  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.screen === id));
  });
  if (id === 'win-config') {
    $('cfg-empresa').value = window.db.empresa;
    $('cfg-itbis').value = window.db.itbisRate * 100;
    editingConfigurationVersion = window.db.configuracionVersion;
    editingConfigurationDatabaseId = databaseId;
  }
  actualizarVistas();
};

window.calcularPreciosAutomaticos = function () {
  const cost = Number($('prod-costo').value) || 0;
  ['prod-p1', 'prod-p2', 'prod-p3'].forEach((id, i) => { $(id).value = money(cost * [1.35, 1.25, 1.15][i]); });
};

window.editarProducto = function (id) {
  if (operacionPendiente()) return;
  const p = window.db.productos.find((entry) => entry.id === Number(id));
  if (!p) return;
  editingProduct = { id: p.id, version: p.version, databaseId };
  $('product-edit-status').textContent = `Editando ${p.codigo}`;
  for (const [field, key] of Object.entries({ codigo: 'codigo', nombre: 'nombre', costo: 'costo', stock: 'stock', p1: 'precio1', p2: 'precio2', p3: 'precio3' })) {
    $(`prod-${field}`).value = p[key];
  }
};
window.cancelarEdicionProducto = function () {
  if (operacionPendiente()) return;
  editingProduct = null;
  $('product-edit-status').textContent = 'Nuevo artículo';
  clear(['prod-codigo', 'prod-nombre', 'prod-costo', 'prod-stock', 'prod-p1', 'prod-p2', 'prod-p3']);
};

window.guardarProducto = async function () {
  try {
    if (editingProduct && editingProduct.databaseId !== databaseId) throw new Error('La base cambió. Vuelve a seleccionar el artículo antes de editarlo.');
    const product = {
      codigo: $('prod-codigo').value.trim(), nombre: $('prod-nombre').value.trim(),
      costo: numeric('prod-costo', 'costo'), stock: numeric('prod-stock', 'existencia', true),
      precio1: numeric('prod-p1', 'precio 1'), precio2: numeric('prod-p2', 'precio 2'), precio3: numeric('prod-p3', 'precio 3'),
    };
    const edit = editingProduct;
    await guardarOperacion(edit ? 'PUT' : 'POST', edit ? `/api/productos/${edit.id}` : '/api/productos',
      edit ? { ...product, version: edit.version } : product, () => {
      window.cancelarEdicionProducto();
      alert('Artículo guardado.');
    });
  } catch (error) { alert(error.message); }
};

window.eliminarProducto = async function (id) {
  const product = window.db.productos.find((p) => p.id === Number(id));
  if (product && confirm('¿Dar de baja este artículo? Se conservará su historial.')) {
    await guardarOperacion('DELETE', `/api/productos/${product.id}`, { version: product.version });
  }
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
  if (operacionPendiente()) return;
  try {
    const line = {
      codigo: $('comp-codigo').value.trim(), nombre: $('comp-nombre').value.trim(),
      cant: numeric('comp-cantidad', 'cantidad', true), costo: numeric('comp-costo', 'costo'),
      p1: numeric('comp-p1', 'precio 1'), p2: numeric('comp-p2', 'precio 2'), p3: numeric('comp-p3', 'precio 3'),
    };
    if (!line.codigo || !line.nombre || line.cant < 1) throw new Error('Completa código, descripción y cantidad mayor que cero.');
    line.subtotal = line.cant * line.costo;
    if (!carritoCompra.length) purchaseDatabaseId = databaseId;
    if (purchaseDatabaseId !== databaseId) throw new Error('La base cambió. Vacía y reconstruye la compra.');
    carritoCompra.push(line);
    clear(['comp-codigo', 'comp-nombre', 'comp-costo', 'comp-p1', 'comp-p2', 'comp-p3']);
    $('comp-cantidad').value = 1;
    renderizarCarritoCompra();
  } catch (error) { alert(error.message); }
};

window.quitarLineaCompra = function (index) { if (!operacionPendiente()) { carritoCompra.splice(index, 1); renderizarCarritoCompra(); } };
function renderizarCarritoCompra() {
  $('tabla-detalle-compra').innerHTML = carritoCompra.map((item, index) => `<tr>
    <td>${h(item.codigo)}</td><td>${h(item.nombre)}</td><td>${item.cant}</td><td>${money(item.costo)}</td>
    <td>${money(item.p1)}</td><td>${money(item.p2)}</td><td>${money(item.p3)}</td><td>${money(item.subtotal)}</td>
    <td><button class="btn-peligro" onclick="quitarLineaCompra(${index})" aria-label="Quitar línea">X</button></td></tr>`).join('');
  $('comp-total').textContent = money(carritoCompra.reduce((sum, item) => sum + item.subtotal, 0));
}

window.procesarFacturaCompra = async function () {
  if (!carritoCompra.length) return alert('Agrega artículos primero.');
  if (purchaseDatabaseId !== databaseId) return alert('La base cambió. Vacía y reconstruye la compra antes de guardarla.');
  const supplier = Number($('comp-suplidor').value);
  const invoice = $('comp-num-factura').value.trim();
  if (!supplier || !invoice) return alert('Selecciona el suplidor y escribe el número de factura.');
  await guardarOperacion('POST', '/api/compras', {
    suplidorId: supplier, numero: invoice,
    items: carritoCompra.map((item) => ({ codigo: item.codigo, nombre: item.nombre, cantidad: item.cant,
      costo: item.costo, precio1: item.p1, precio2: item.p2, precio3: item.p3 })),
  }, () => {
    carritoCompra = []; $('comp-num-factura').value = ''; renderizarCarritoCompra();
    alert('Compra guardada e inventario actualizado.');
  });
};

window.guardarCliente = async function () {
  const customer = { nombre: $('cli-nombre').value.trim(), rnc: $('cli-rnc').value.trim(), tel: $('cli-tel').value.trim() };
  await guardarOperacion('POST', '/api/clientes', customer, () => clear(['cli-nombre', 'cli-rnc', 'cli-tel']));
};
window.guardarSuplidor = async function () {
  const supplier = { nombre: $('sup-nombre').value.trim(), rnc: $('sup-rnc').value.trim(), tel: $('sup-tel').value.trim() };
  await guardarOperacion('POST', '/api/suplidores', supplier, () => clear(['sup-nombre', 'sup-rnc', 'sup-tel']));
};
window.guardarConfig = async function () {
  try {
    if (editingConfigurationDatabaseId && editingConfigurationDatabaseId !== databaseId) throw new Error('La base cambió. Vuelve a abrir Configuración antes de editarla.');
    const empresa = $('cfg-empresa').value.trim();
    const rate = numeric('cfg-itbis', 'ITBIS') / 100;
    if (carrito.length && rate !== window.db.itbisRate) throw new Error('Vacía el carrito de ventas antes de cambiar el ITBIS.');
    await guardarOperacion('PUT', '/api/configuracion', { empresa, itbisPorcentaje: rate * 100,
      version: editingConfigurationVersion ?? window.db.configuracionVersion }, () => {
      editingConfigurationVersion = window.db.configuracionVersion;
      alert('Configuración guardada.');
    });
  } catch (error) { alert(error.message); }
};

window.agregarLineaFactura = function () {
  if (operacionPendiente()) return;
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
    const nivelPrecio = $('fac-nivel-precio').value;
    const price = p[nivelPrecio];
    const subtotal = price * quantity;
    if (!carrito.length) cartDatabaseId = databaseId;
    if (cartDatabaseId !== databaseId) throw new Error('La base cambió. Vacía y reconstruye la venta.');
    carrito.push({
      productoId: p.id, nivelPrecio, codigo: p.codigo, nombre: p.nombre, cant: quantity, precio: price,
      itbis: p.gravado === false ? 0 : subtotal - subtotal / (1 + window.db.itbisRate), subtotal,
    });
    $('fac-buscar-prod').value = ''; $('fac-cantidad').value = 1;
    renderizarCarrito();
  } catch (error) { alert(error.message); }
};

window.quitarLineaFactura = function (index) { if (!operacionPendiente()) { carrito.splice(index, 1); renderizarCarrito(); } };
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
  if (cartDatabaseId !== databaseId) return alert('La base cambió. Vacía y reconstruye la venta antes de guardarla.');
  await guardarOperacion('POST', '/api/ventas', {
    cajaId: window.db.caja?.session?.id, metodoPago: $('fac-condicion').value === 'Credito' ? 'credito' : 'efectivo',
    clienteId: Number($('fac-cliente').value), tipoComprobante: $('fac-ncf').value, condicion: $('fac-condicion').value,
    items: carrito.map((item) => ({ productoId: item.productoId, cantidad: item.cant, nivelPrecio: item.nivelPrecio })),
  }, (result) => {
    carrito = []; renderizarCarrito();
    const invoice = window.db.facturas.find((entry) => entry.id === result.result.id);
    if (invoice) window.imprimirTicket(invoice);
    else alert('Venta confirmada. Puedes reimprimirla desde Reportes.');
  });
};

window.imprimirTicket = function (invoice) {
  const popup = window.open('', '', 'width=350,height=600');
  if (!popup) { alert('La factura está guardada. Permite ventanas emergentes o reimprímela desde Reportes.'); return; }
  popup.document.write(`<!doctype html><html lang="es"><meta charset="UTF-8"><title>Factura ${invoice.id}</title>
    <body style="font-family:monospace;width:280px;font-size:12px"><h3>${h(window.db.empresa)}</h3>
    <p>Venta interna #${invoice.id}<br>Fecha: ${h(invoice.fecha)}<br>${invoice.ncf ? `NCF: ${h(invoice.ncf)}` : 'Sin NCF asignado'}<br>Cliente: ${h(invoice.cliente)}</p>
    <hr>${invoice.items.map((item) => `${item.cant} x ${h(item.nombre)} - RD$ ${money(item.subtotal)}`).join('<br>')}
    <hr><h4>TOTAL: RD$ ${money(invoice.total)}</h4><p>¡Gracias por su compra!</p></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
};

window.exportarRespaldo = async function () {
  if (!ready) return alert('Actualiza los datos antes de exportar el respaldo.');
  try {
  const backup = await request('GET', '/api/backup');
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'respaldo_repuestos_felix.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { alert(`No se pudo descargar el respaldo: ${error.message}`); }
};

window.importarRespaldo = async function (event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('El respaldo supera 10 MB.');
    const restored = JSON.parse(await file.text());
    if (!confirm('¿Reemplazar todos los datos de la base seleccionada con este respaldo?')) return;
    await guardarOperacion('POST', '/api/restore', { backup: restored, revision }, () => {
      carrito = []; carritoCompra = []; renderizarCarrito(); renderizarCarritoCompra();
      window.cancelarEdicionProducto();
      editingConfigurationVersion = null;
      alert('Respaldo restaurado en la base seleccionada.');
    });
  } catch (error) { alert(`No se pudo restaurar: ${error.message}`); }
  finally { event.target.value = ''; }
};

function options(id, records) {
  const selected = $(id).value;
  $(id).innerHTML = records.map((record) => `<option value="${record.id}">${h(record.nombre)}${record.rnc ? ` (${h(record.rnc)})` : ''}</option>`).join('');
  if (records.some((record) => String(record.id) === selected)) $(id).value = selected;
}

function actualizarVistas() {
  const data = window.db;
  $('nombre-negocio').textContent = data.empresa;
  $('fac-itbis-label').textContent = `ITBIS (${Number((data.itbisRate * 100).toFixed(2))}%): RD$ `;
  $('lista-productos').innerHTML = data.productos.map((p) => `<option value="${h(p.codigo)}">${h(p.nombre)} (Stock: ${p.stock})</option>`).join('');
  $('tabla-inventario').innerHTML = data.productos.map((p) => `<tr>
    <td>${h(p.codigo)}</td><td>${h(p.nombre)}</td><td>${p.stock}</td><td>${money(p.costo)}</td>
    <td>${money(p.precio1)}</td><td>${money(p.precio2)}</td><td>${money(p.precio3)}</td>
    <td><button class="btn-azul" data-edit="${p.id}">Editar</button>
    <button class="btn-peligro" data-delete="${p.id}" aria-label="Dar de baja artículo">X</button></td></tr>`).join('');
  options('fac-cliente', data.clientes); options('comp-suplidor', data.suplidores);
  $('tabla-clientes').innerHTML = data.clientes.map((c) => `<tr><td>${h(c.nombre)}</td><td>${h(c.rnc)}</td><td>${h(c.tel)}</td><td>RD$ ${money(c.deuda)}</td></tr>`).join('');
  $('tabla-suplidores').innerHTML = data.suplidores.map((s) => `<tr><td>${h(s.nombre)}</td><td>${h(s.rnc)}</td><td>${h(s.tel)}</td></tr>`).join('');
  $('tabla-compras').innerHTML = data.compras.map((c) => `<tr><td>#${c.id}</td><td>${h(c.fecha)}</td><td>${h(c.suplidor)}</td><td>${h(c.numero)}</td><td>RD$ ${money(c.total)}</td></tr>`).join('');
  $('tabla-facturas').innerHTML = data.facturas.map((f) => `<tr>
    <td>#${f.id}</td><td>${h(f.fecha)}</td><td>${h(f.cliente)}</td><td>${h(f.ncf ?? 'Sin NCF asignado')}</td><td>${h(f.condicion)}</td>
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
const mobile = window.matchMedia?.('(max-width: 760px)');
if (mobile) {
  $('main-menu').open = !mobile.matches;
  mobile.addEventListener('change', (event) => { $('main-menu').open = !event.matches; });
}
document.querySelectorAll('.menu-item').forEach((menu) => {
  menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('.menu-item').forEach((other) => { if (other !== menu) other.open = false; });
  });
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.navbar')) {
    document.querySelectorAll('.menu-item').forEach((menu) => { menu.open = false; });
    if (mobile?.matches) $('main-menu').open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const open = document.querySelector('.menu-item[open]');
    if (open) { open.open = false; open.querySelector('summary').focus(); }
    else if (mobile?.matches) { $('main-menu').open = false; $('main-menu').querySelector('summary').focus(); }
  }
});
setupPWA();
updateClock(); setInterval(updateClock, 1000);
actualizarVistas();
await cargarDatos();
