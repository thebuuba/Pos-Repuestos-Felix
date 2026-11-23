import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteSale, saleRequest, receiptFromConfirmation, updateSaleLine } from '../frontend/src/data/operational-sales.js';

const product = { id: 19, version: 7, databaseId: 'catalog', taxable: true, stock: 3.02,
  pricesExact: { p1: '10.0030', p2: '1.0050' }, code: 'R', name: 'Repuesto' };
const second = { ...product, id: 20, taxable: false, pricesExact: { p1: '4.9999' } };
const settings = { version: 3, itbisRate: 18, databaseId: 'catalog' };

test('la venta identifica el turno y su medio de pago sin inventar métodos históricos', () => {
  const cart = updateSaleLine([], product, 'p1', 1);
  const cashSession = { id: 8, version: 2, open: true };
  for (const method of ['efectivo', 'tarjeta', 'transferencia']) {
    const dto = saleRequest(cart, settings, 9, 'contado', 'B02', cashSession, method);
    assert.equal(dto.cajaId, 8);
    assert.equal(dto.metodoPago, method);
  }
  assert.equal(saleRequest(cart, settings, 9, 'credito', 'B02', cashSession, 'efectivo').metodoPago, 'credito');
  assert.throws(() => saleRequest(cart, settings, 9, 'contado', 'B02', { open: false }, 'efectivo'), /caja/i);
});

test('los totales incluyen el ITBIS por línea y usan cuatro decimales de precio y centésimas de unidad', () => {
  let cart = updateSaleLine([], product, 'p1', '2.50');
  cart = updateSaleLine(cart, second, 'p1', '0.01');
  const quote = quoteSale(cart, 18);
  assert.deepEqual(quote.totals, { items: 2.51, subtotal: 21.24, grossTotal: 25.06, discount: 0, discountPercent: 0, itbis: 3.82, total: 25.06 });
  assert.equal(quote.lines[0].subtotal, 25.01);
  assert.equal(quote.lines[0].unitPrice, '10.0030');
  assert.deepEqual(saleRequest(cart, settings, 9, 'contado', 'B02'), {
    databaseId: 'catalog', clienteId: 9, condicion: 'Contado', tipoComprobante: 'B02', versionConfiguracion: 3,
    items: [{ productoId: 19, versionProducto: 7, nivelPrecio: 'precio1', cantidad: '2.50' },
      { productoId: 20, versionProducto: 7, nivelPrecio: 'precio1', cantidad: '0.01' }],
  });
});

test('la suma del stock abarca todos los precios y el carrito conserva la base y versión originales', () => {
  const first = updateSaleLine([], product, 'p1', '0.01');
  const accumulated = updateSaleLine(first, product, 'p1', '3.00');
  assert.equal(accumulated[0].quantity, 3.01);
  const cart = updateSaleLine(accumulated, product, 'p2', '0.01');
  assert.throws(() => updateSaleLine(cart, product, 'p2', '0.01'), /existencias/i);
  assert.throws(() => updateSaleLine(cart, { ...product, version: 8 }, 'p1', '0.01'), /cambió/);
  assert.throws(() => updateSaleLine([], product, 'p1', '1.001'), /cantidad/);
  assert.throws(() => saleRequest(cart, { ...settings, databaseId: 'otra' }, 9, 'contado', 'B02'), /base/);
});

test('el recibo usa el registro confirmado por el servidor, sin inventar tiempo, efectivo o NCF', () => {
  const doc = { id: 91, cliente: 'Cliente confirmado', clienteRnc: '', fechaISO: '2026-11-22',
    condicion: 'Contado', tipoComprobante: 'B02', ncf: null, base: 21.2, itbis: 3.81, total: 25.01,
    items: [{ id: 5, codigo: 'R', nombre: 'Nombre histórico', cant: 2.5, precioExacto: '10.0030', subtotal: 25.01 }] };
  const snapshot = { result: { id: 91 }, state: { facturas: [{ id: 90 }, doc] } };
  const receipt = receiptFromConfirmation(snapshot);
  assert.equal(receipt.invoiceNumber, 'Registro 91');
  assert.equal(receipt.dateOnly, '2026-11-22');
  assert.equal(receipt.customerName, 'Cliente confirmado');
  assert.deepEqual(receipt.totals, { subtotal: 21.2, discount: 0, discountPercent: 0, itbis: 3.81, total: 25.01 });
  assert.equal(receipt.lines[0].product.name, 'Nombre histórico');
  assert.equal(receipt.lines[0].unitPrice, '10.0030');
  assert.equal(receipt.ncf, null);
  assert.equal(receipt.received, undefined);
  assert.equal(receipt.paymentLabel, undefined);
  assert.equal(receiptFromConfirmation({ ...snapshot, state: { facturas: [{ ...doc, metodoPago: 'tarjeta' }] } }).paymentLabel, 'Tarjeta');
});

test('el descuento libre soporta cualquier porcentaje (0-100%) o monto fijo en RD$ con validación', () => {
  const cart = updateSaleLine([], { ...product, pricesExact: { p1: '500.0000', p2: '500.0000', p3: '500.0000' } }, 'p1', '1');
  const pct = quoteSale(cart, 18, { mode: 'percent', value: '22.5' });
  assert.equal(pct.discountError, null);
  assert.equal(pct.totals.discount, 112.5);
  assert.equal(pct.totals.total, 387.5);
  assert.equal(saleRequest(cart, settings, 9, 'contado', 'B02', undefined, undefined, { mode: 'percent', value: '22.5' }).descuentoPorcentaje, 22.5);

  const amt = quoteSale(cart, 18, { mode: 'amount', value: '75' });
  assert.equal(amt.discountError, null);
  assert.equal(amt.totals.discount, 75);
  assert.equal(amt.totals.discountPercent, 15);
  assert.equal(amt.totals.total, 425);
  assert.equal(saleRequest(cart, settings, 9, 'contado', 'B02', undefined, undefined, { mode: 'amount', value: '75' }).descuentoMonto, 75);

  const tooHighPct = quoteSale(cart, 18, { mode: 'percent', value: '120' });
  assert.match(tooHighPct.discountError, /100/);
  const tooHighAmt = quoteSale(cart, 18, { mode: 'amount', value: '600' });
  assert.match(tooHighAmt.discountError, /total/);
});

test('el recibo durable local conserva su referencia y no se presenta como confirmación fiscal remota', () => {
  const reference = '1a2b3c4d-0000-4000-8000-123456789abc';
  const receipt = receiptFromConfirmation({ localReceipt: reference, result: { id: 7 }, state: { facturas: [{
    id: 7, fechaISO: '2026-11-22', cliente: 'Contado', clienteRnc: '', condicion: 'Contado',
    tipoComprobante: 'B02', ncf: 'B0200000001', base: 10, itbis: 0, total: 10,
    items: [{ id: 1, nombre: 'Repuesto', cant: 1, precio: 10, subtotal: 10 }],
  }] } });
  assert.equal(receipt.invoiceNumber, 'Local 1a2b3c4d');
  assert.equal(receipt.localReference, reference);
  assert.equal(receipt.ncf, null);
});
