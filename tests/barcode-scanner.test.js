import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { buildOperational } from '../scripts/build-operational.mjs';
import { serveDesign } from '../scripts/serve-design.mjs';

let browser, server, directory;
const product = {
  id: 1, version: 1, codigo: '0012345678905', nombre: 'Repuesto sintético', marca: '',
  categoria: '', ubicacion: '', costo: 1, precio1: 10, precio2: 9, precio3: 8,
  stock: 3, stockMinimo: 0, gravado: false, activo: true,
};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'felix-scanner-'));
  await buildOperational(directory);
  server = await serveDesign(directory, 0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-scanner-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function openSale(t, products = [product]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const writes = [];
  const databaseId = randomUUID();
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: 'Escritura deshabilitada en esta prueba' } });
  });
  await page.route('**/api/state', route => route.fulfill({ json: {
    databaseId, databaseLabel: 'Prueba aislada', revision: 1,
    state: {
      empresa: 'Negocio', itbisRate: 0.18, configuracionVersion: 1,
      configuracion: { version: 1, empresa: 'Negocio', rnc: '', tel: '', correo: '', direccion: '',
        itbisPorcentaje: 18, redondeo: 0, nivelPrecioPredeterminado: 'p1', formatoImpresion: null,
        pieTicket: '', permitirStockNegativo: false },
      productos: products,
      clientes: [{ id: 1, version: 1, nombre: 'Contado', rnc: '', tel: '', correo: '', direccion: '', limiteCredito: null, esContado: true, deuda: 0 }],
      suplidores: [], formulas: [], facturas: [], compras: [], movimientos: [],
      caja: { session: { open: true, id: 1, version: 1, openedAt: '2026-11-22T12:00:00Z', cashier: 'Prueba', openingAmount: 0 },
        summary: { opening: 0, cashSales: 0, cardSales: 0, transferSales: 0, creditSales: 0, entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 0, invoices: 0 },
        movements: [], closures: [] },
    },
  } }));
  await page.goto(server.origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe… ej. BUJ-C7HSA');
  await search.waitFor();
  return { page, search, writes };
}

test('Enter exige un código literal; nunca vende la primera coincidencia parcial', async t => {
  const { page, search, writes } = await openSale(t);
  await search.fill('12345678905');
  await search.press('Enter');
  assert.equal(await page.getByRole('row').filter({ hasText: product.nombre }).count(), 0);
  await page.getByRole('alert').filter({ hasText: /código exacto/i }).waitFor({ timeout: 1500 });
  await search.fill(product.codigo);
  await search.press('Enter');
  await page.getByRole('row').filter({ hasText: product.nombre }).waitFor();
  assert.equal(await search.inputValue(), '');
  assert.equal(await search.evaluate(input => input === document.activeElement), true);
  assert.deepEqual(writes, []);
});

test('lecturas USB rápidas suman el mismo artículo y respetan existencias', async t => {
  const { page, search, writes } = await openSale(t);
  for (let index = 0; index < 4; index++) {
    await search.pressSequentially(product.codigo);
    await search.press('Enter');
  }
  const row = page.getByRole('row').filter({ hasText: product.nombre });
  assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '3');
  await page.getByText(/Existencias insuficientes/).waitFor();
  assert.deepEqual(writes, []);
});

test('varios Enter antes del siguiente render conservan todas las lecturas', async t => {
  const { page, search } = await openSale(t);
  await search.evaluate((input, code) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (let index = 0; index < 3; index++) {
      setValue.call(input, code);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }, product.codigo);
  assert.equal((await page.getByRole('row').filter({ hasText: product.nombre }).getByRole('cell').nth(1).innerText()).trim(), '3');
});

test('la lectura no modifica una venta mientras su confirmación está pendiente', async t => {
  const { page, search, writes } = await openSale(t);
  const response = Promise.withResolvers();
  await page.route('**/api/ventas', async route => {
    writes.push(route.request().postDataJSON());
    await response.promise;
    await route.fulfill({ status: 503, json: { error: 'Confirmación no disponible' } });
  });
  await search.fill(product.codigo);
  await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByRole('status').filter({ hasText: 'Confirmando la venta…' }).waitFor();
  assert.equal(await search.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Escanear con cámara' }).isDisabled(), true);
  await search.evaluate((input, code) => {
    input.value = code;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, product.codigo);
  assert.equal((await page.getByRole('row').filter({ hasText: product.nombre }).getByRole('cell').nth(1).innerText()).trim(), '1');
  response.resolve();
  await page.getByRole('button', { name: 'Reintentar venta', exact: true }).waitFor();
  assert.equal(await search.isDisabled(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].items[0].cantidad, '1.00');
});

test('códigos ambiguos se rechazan y escribir en otra entrada no agrega productos', async t => {
  const { page, search, writes } = await openSale(t, [{ ...product, codigo: 'ABC' }, { ...product, id: 2, codigo: 'abc', nombre: 'Otro artículo' }]);
  await search.fill('Abc');
  await search.press('Enter');
  assert.equal(await page.getByRole('row').filter({ hasText: product.nombre }).count(), 0);
  await page.getByRole('alert').filter({ hasText: /varios artículos/ }).waitFor({ timeout: 1500 });
  await page.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('2');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('row').filter({ hasText: product.nombre }).count(), 0);
  assert.deepEqual(writes, []);
});

test('la cámara solicita permiso sólo al abrir y muestra el rechazo en español', async t => {
  const { page, writes } = await openSale(t);
  await page.evaluate(() => {
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraRequests++;
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click({ timeout: 1500 });
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: /permiso/ }).waitFor();
  assert.equal(await page.evaluate(() => window.cameraRequests), 1);
  await page.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
  assert.equal(await searchVisible(page), true);
  await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder')?.startsWith('Escanea o escribe'));
  assert.deepEqual(writes, []);
});

async function searchVisible(page) {
  return page.getByPlaceholder('Escanea o escribe… ej. BUJ-C7HSA').isVisible();
}

// Independent EAN-13 fixture: 0012345678905, with its check digit 5.
const eanBits = '101' + ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001'].join('') +
  '01010' + ['1010000', '1000100', '1001000', '1110100', '1110010', '1001110'].join('') + '101';

async function mockCamera(page, bits = '', torch = false) {
  await page.evaluate(({ bits, torch }) => {
    window.cameraStreams = [];
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.cameraRequests++;
      window.cameraConstraints = constraints;
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      context.fillStyle = 'white'; context.fillRect(0, 0, 640, 360);
      context.fillStyle = 'black';
      for (let index = 0; index < bits.length; index++) if (bits[index] === '1') context.fillRect(80 + index * 5, 70, 5, 220);
      const stream = canvas.captureStream(5);
      if (torch) {
        const track = stream.getVideoTracks()[0];
        track.getCapabilities = () => ({ torch: true });
        track.applyConstraints = async () => { if (track.readyState === 'ended') throw new DOMException('Track ended', 'InvalidStateError'); };
      }
      window.cameraStreams.push(stream);
      return stream;
    };
  }, { bits, torch });
}

test('la cámara decodifica barras reales, conserva ceros y se detiene después de una lectura', async t => {
  const { page, writes } = await openSale(t);
  await mockCamera(page, eanBits);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  const row = page.getByRole('row').filter({ hasText: product.nombre });
  await row.waitFor({ timeout: 7000 });
  assert.match(await row.innerText(), /0012345678905/);
  assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '1');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder')?.startsWith('Escanea o escribe'));
  assert.deepEqual(await page.evaluate(() => window.cameraStreams.flatMap(stream => stream.getTracks().map(track => track.readyState))), ['ended']);
  assert.equal(await page.evaluate(() => window.cameraConstraints.audio), false);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  await page.waitForFunction(() => document.querySelector('tbody tr td:nth-child(2)')?.textContent.trim() === '2');
  assert.deepEqual(writes, []);
});

test('cerrar, pasar al fondo y navegar detienen todas las pistas de cámara', async t => {
  const { page } = await openSale(t);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockCamera(page, '', true);
  for (const action of ['close', 'background', 'navigate']) {
    await page.getByRole('button', { name: 'Escanear con cámara' }).click();
    await page.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
    if (action === 'close') await page.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
    if (action === 'background') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });
    if (action === 'navigate') await page.evaluate(() => {
      history.pushState(null, '', '/inventario');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForFunction(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  }
  assert.deepEqual(errors, []);
});

test('el permiso tardío no deja encendida la cámara después de cerrar', async t => {
  const { page } = await openSale(t);
  await mockCamera(page);
  await page.evaluate(() => {
    const getStream = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.allowCamera = () => getStream({ audio: false, video: true }).then(resolve);
    });
  });
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  await page.waitForFunction(() => window.allowCamera);
  await page.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
  await page.evaluate(() => window.allowCamera());
  await page.waitForFunction(() => window.cameraStreams.length === 1 && window.cameraStreams[0].getTracks()[0].readyState === 'ended');
  assert.equal(await page.getByRole('dialog').count(), 0);
});

test('el diálogo cabe en móvil y escritorio en ambos temas', async t => {
  const { page } = await openSale(t);
  await mockCamera(page);
  const evidence = process.env.FELIX_SCANNER_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    const height = width === 320 ? 600 : width === 390 ? 844 : width === 768 ? 1024 : 1000;
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.style.colorScheme = theme;
      }, theme);
      await page.getByRole('button', { name: 'Escanear con cámara' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
      await dialog.evaluate(async element => { await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      const bounds = await dialog.boundingBox();
      assert.ok(Math.abs(bounds.width - Math.min(width - 32, 512)) < 1, 'El diálogo aprovecha el ancho disponible hasta 512 px.');
      assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= width - 15, 'El diálogo conserva márgenes laterales.');
      assert.ok(bounds.y >= 15 && bounds.y + bounds.height <= height - 15, 'El diálogo cabe en la altura disponible.');
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      if (evidence) await page.screenshot({ path: path.join(evidence, `camera-${width}-${theme}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
    }
  }
});
