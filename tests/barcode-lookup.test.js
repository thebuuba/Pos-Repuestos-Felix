import { test } from 'node:test';
import assert from 'node:assert/strict';

test('la lectura literal conserva ceros, espacios y distingue mayúsculas', async () => {
  const { productForBarcode } = await import('../frontend/src/data/barcode-scanner.js');
  const products = [{ id: 1, code: '00123' }, { id: 2, code: 'ABC ' }, { id: 3, code: 'abc' }];
  assert.equal(productForBarcode(products, '00123').id, 1);
  assert.equal(productForBarcode(products, 'ABC ').id, 2);
  assert.throws(() => productForBarcode(products, '123'), /código exacto/);
  assert.throws(() => productForBarcode(products, 'ABC'), /código exacto/);
});

test('UPC-A y EAN-13 sólo son equivalentes al decodificar ese formato; dos artículos son ambiguos', async () => {
  const { productForBarcode } = await import('../frontend/src/data/barcode-scanner.js');
  const products = [{ id: 1, code: '0012345678905' }];
  assert.equal(productForBarcode(products, '012345678905', 'UPC_A').id, 1);
  assert.throws(() => productForBarcode(products, '012345678905', 'CODE_128'), /código exacto/);
  products.push({ id: 2, code: '012345678905' });
  assert.throws(() => productForBarcode(products, '0012345678905', 'EAN_13'), /varios artículos/);
  assert.equal(productForBarcode(products, '012345678905').id, 2);
});
