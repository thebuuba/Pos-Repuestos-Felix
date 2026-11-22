import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { buildOperational } from '../scripts/build-operational.mjs';
import { serveDesign } from '../scripts/serve-design.mjs';
import { observeScanAudio } from './fixtures/scan-audio.js';

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

async function openSale(t, products = [product], categories = [], engineBrowser = browser) {
  const context = await engineBrowser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', serviceWorkers: 'block', reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const writes = [];
  const databaseId = randomUUID();
  await context.route('**/api/**', route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: 'Escritura deshabilitada en esta prueba' } });
  });
  const snapshot = {
    databaseId, databaseLabel: 'Prueba aislada', revision: 1,
    state: {
      empresa: 'Negocio', itbisRate: 0.18, configuracionVersion: 1,
      configuracion: { version: 1, empresa: 'Negocio', rnc: '', tel: '', correo: '', direccion: '',
        itbisPorcentaje: 18, redondeo: 0, nivelPrecioPredeterminado: 'p1', formatoImpresion: null,
        pieTicket: '', permitirStockNegativo: false },
      productos: products,
      catalogo: { categorias: categories },
      clientes: [{ id: 1, version: 1, nombre: 'Contado', rnc: '', tel: '', correo: '', direccion: '', limiteCredito: null, esContado: true, deuda: 0 }],
      suplidores: [], formulas: [], facturas: [], compras: [], movimientos: [],
      caja: { session: { open: true, id: 1, version: 1, openedAt: '2026-11-22T12:00:00Z', cashier: 'Prueba', openingAmount: 0 },
        summary: { opening: 0, cashSales: 0, cardSales: 0, transferSales: 0, creditSales: 0, entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 0, invoices: 0 },
        movements: [], closures: [] },
    },
  };
  await context.route('**/api/state', route => route.fulfill({ json: snapshot }));
  await page.goto(server.origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe… ej. BUJ-C7HSA');
  await search.waitFor();
  return { page, search, writes, snapshot, context };
}

async function navigateModule(page, path) {
  await page.evaluate(path => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.locator('main [aria-busy="true"]').waitFor({ state: 'hidden' });
}
async function physicalScan(page, code = product.codigo, delay = 0) {
  await page.keyboard.type(code, { delay });
  await page.keyboard.press('Enter');
}

test('el lector global agrega fuera de Ventas y conserva el borrador sin cobrar', async t => {
  const { page, writes } = await openSale(t);
  await observeScanAudio(page);
  await navigateModule(page, '/inventario');
  await page.getByRole('main').getByRole('heading').first().click();
  await physicalScan(page);
  await page.getByText('Agregado a la venta', { exact: true }).waitFor();
  await page.locator('.scan-confirmation').hover();
  assert.equal(new URL(page.url()).pathname, '/inventario');
  await page.waitForFunction(() => window.scanAudio.beeps.length === 1 && window.scanAudio.beeps[0].ended);
  await page.getByRole('button', { name: 'Ver venta', exact: true }).click();
  const row = page.locator('.sale-cart tbody tr').filter({ hasText: product.nombre });
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await navigateModule(page, '/caja');
  await page.getByRole('heading').first().click();
  await physicalScan(page);
  await navigateModule(page, '/ventas');
  await row.waitFor();
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '2');
  assert.match(await page.getByRole('button', { name: 'Tarjeta', exact: true }).getAttribute('class'), /bg-card/);
  // A third read is accepted; a fourth exceeds the exact available stock.
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).click();
  await physicalScan(page);
  await page.waitForFunction(() => window.scanAudio.beeps.length === 3);
  await physicalScan(page);
  await page.getByText(/Existencias insuficientes/).waitFor();
  await physicalScan(page, 'DESCONOCIDO');
  await page.getByText(/No hay un artículo con el código exacto/).waitFor();
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '3');
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 3);
  assert.deepEqual(writes, []);
});

test('el lector global respeta formularios, diálogos, escritura lenta y su interruptor', async t => {
  const { page, search, writes } = await openSale(t);
  const toggle = page.getByRole('button', { name: 'Escáner de ventas', exact: true });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).click();
  await physicalScan(page);
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
  await toggle.click();
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).click();
  await physicalScan(page, product.codigo, 120);
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
  await navigateModule(page, '/inventario');
  const filter = page.getByRole('main').getByRole('textbox').first();
  await filter.click();
  await physicalScan(page);
  assert.equal(await filter.inputValue(), product.codigo);
  await navigateModule(page, '/ventas');
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
  await mockCamera(page);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  await page.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
  await physicalScan(page);
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
  await page.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
  // The existing focused search must still accept exactly once.
  await search.click();
  await physicalScan(page);
  const row = page.locator('.sale-cart tbody tr').filter({ hasText: product.nombre });
  await row.waitFor();
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  // A reader's Enter must never activate a focused checkout button.
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).focus();
  await physicalScan(page);
  for (const code of ['AB CD', ' ABCD', 'sint-7681 ']) await physicalScan(page, code);
  // A prefix can start above the final average threshold and still be valid.
  await page.evaluate(() => {
    const target = document.activeElement;
    let at = performance.now();
    for (const [key, gap] of [['A', 0], [' ', 60], ['B', 10], ['C', 10], ['D', 10], ['Enter', 10]]) {
      at += gap;
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'timeStamp', { value: at });
      target.dispatchEvent(event);
      if (key === ' ') window.scannerSpacePrevented = event.defaultPrevented;
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
    }
  });
  assert.equal(await page.evaluate(() => window.scannerSpacePrevented), true);
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  assert.deepEqual(writes, []);
  // Preserve accessible activation with a single human Space.
  await toggle.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Escáner de ventas"]').getAttribute('aria-pressed') === 'false');
});

test('el Enter del lector no cierra la cámara enfocada y un Enter manual conserva su acción', async t => {
  const { page, writes } = await openSale(t);
  await mockCamera(page);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
  const close = dialog.getByRole('button', { name: 'Cerrar cámara', exact: true });
  await close.focus();
  await page.evaluate(() => {
    window.scannerEvents = [];
    window.addEventListener('keydown', event => window.scannerEvents.push({ key: event.key, at: event.timeStamp,
      prevented: event.defaultPrevented, focused: document.activeElement?.textContent }), true);
  });
  await physicalScan(page);
  const events = await page.evaluate(() => window.scannerEvents);
  assert.equal(events.at(-1).key, 'Enter');
  assert.equal(events.at(-1).prevented, true, JSON.stringify(events));
  assert.equal(await dialog.count(), 1, 'El lector pausado no activa el botón de cierre');
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(writes, []);
});

test('el escáner se detiene al perder foco y el borrador se separa por base y sesión', async t => {
  const { page, snapshot, context, writes } = await openSale(t);
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).click();
  await physicalScan(page);
  const rows = page.locator('.sale-cart tbody tr');
  assert.equal(await rows.count(), 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await physicalScan(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  });
  await physicalScan(page);
  await page.evaluate(() => { delete document.hasFocus; });
  assert.equal((await rows.locator('td').nth(1).innerText()).trim(), '1');
  snapshot.databaseId = randomUUID();
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  await rows.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).click();
  await physicalScan(page);
  await rows.waitFor();
  assert.equal((await rows.locator('td').nth(1).innerText()).trim(), '1');
  await context.route('**/api/state', route => route.fulfill({ status: 401, json: { error: 'Sesión cerrada' } }));
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
  await physicalScan(page);
  assert.equal(await rows.count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Escáner de ventas' }).count(), 0);
  assert.deepEqual(writes, []);
});

test('el control global cabe en cabecera y el aviso permite volver a Ventas', async t => {
  const { page, writes } = await openSale(t);
  const evidence = path.resolve('dist/verification/global-scanner');
  await mkdir(evidence, { recursive: true });
  for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      const toggle = page.getByRole('button', { name: 'Escáner de ventas', exact: true });
      assert.equal(await toggle.isVisible(), true);
      const rect = await toggle.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(evidence, `cabecera-${width}-${theme}.png`), animations: 'disabled' });
    }
  }
  await navigateModule(page, '/inventario');
  await page.getByRole('main').getByRole('heading').first().click();
  await physicalScan(page);
  const notification = page.locator('.scan-confirmation');
  await notification.waitFor();
  await notification.hover();
  await page.screenshot({ path: path.join(evidence, 'agregado-desde-inventario.png'), animations: 'disabled' });
  await notification.getByRole('button', { name: 'Ver venta' }).click();
  await page.locator('.sale-cart tbody tr').waitFor();
  assert.deepEqual(writes, []);
});

test('el catálogo de venta omite filtros importados y pagina sin desplazamientos internos', async t => {
  const categories = ['ALIM./PAJARROS', 'ALIMENTOS', 'ANABOLICOS', 'ANTIBIOTICOS', 'ART/PERROS', 'BAÑOS PARA ANIMALES', 'CICATRIZANTE'];
  const products = Array.from({ length: 19 }, (_, index) => ({ ...product, id: index + 1,
    codigo: `TALLER-${String(index + 1).padStart(2, '0')}${index === 0 ? '-CODIGO-EXTENSO-12345678901234567890' : ''}`,
    nombre: `Repuesto del taller ${index + 1}${index === 0 ? ' con descripción extensa para comprobar su ajuste' : ''}`,
    categoria: index === 0 ? categories[0] : 'Repuestos', precio1: 12345.6789,
    preciosExactos: { p1: '12345.6789', p2: '9.0000', p3: '8.0000' },
  }));
  const webkitBrowser = await webkit.launch({ headless: true });
  t.after(() => webkitBrowser.close());
  for (const [engine, instance] of [['chromium', browser], ['webkit', webkitBrowser]]) {
  const { page, search, writes } = await openSale(t, products, categories, instance);
  assert.equal(await page.locator('.sale-search-input').getByRole('button', { name: 'Escanear con cámara' }).count(), 0,
    'La cámara tiene un botón independiente de la búsqueda');
  assert.equal(await page.getByText('Facturación / Punto de venta', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Agrega productos, revisa el detalle y registra la venta.', { exact: true }).count(), 0);
  const grid = page.locator('.sale-product-catalog');
  for (const category of categories)
    assert.equal(await grid.getByRole('button', { name: category, exact: true }).count(), 0, 'No aparecen las categorías importadas ajenas al taller');
  assert.equal(await grid.getByRole('button', { name: /Repuesto del taller/ }).count(), 8);
  const next = grid.getByRole('button', { name: 'Siguiente', exact: true });
  const previous = grid.getByRole('button', { name: 'Anterior', exact: true });
  assert.equal(await previous.isDisabled(), true);
  await next.click(); await next.click();
  assert.equal(await grid.getByRole('button', { name: /Repuesto del taller/ }).count(), 3);
  assert.equal(await next.isDisabled(), true);
  await grid.getByRole('button', { name: /Repuesto del taller 19/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'Repuesto del taller 19' });
  await row.waitFor();
  await previous.click(); await previous.click();
  await search.fill('TALLER-19'); await search.press('Enter');
  assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2', 'La búsqueda encuentra productos de cualquier página');
  await page.mouse.move(0, 0);
  await page.getByText('Agregado a la venta', { exact: true }).waitFor({ state: 'hidden' });
  const evidence = path.resolve('dist/verification/compact-camera');
  await mkdir(evidence, { recursive: true });
  for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1024, 1000], [1280, 1000], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    if (width < 1024) {
      const toggle = page.getByRole('button', { name: 'Ver catálogo de productos', exact: true });
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      const overflow = await grid.evaluate(element => [element, ...element.querySelectorAll('*')]
        .filter(node => {
          const css = getComputedStyle(node);
          return node.clientWidth && ((['auto', 'scroll'].includes(css.overflowX) && node.scrollWidth > node.clientWidth + 1)
            || (['auto', 'scroll'].includes(css.overflowY) && node.scrollHeight > node.clientHeight + 1));
        }).map(node => ({ tag: node.tagName, className: node.className })));
      assert.deepEqual(overflow, [], `El catálogo no necesita barras internas en ${width}px`);
      const horizontal = await page.locator('.pos-sale').evaluate(element => [...element.querySelectorAll('*')]
        .filter(node => node.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1)
        .map(node => ({ tag: node.tagName, className: node.className })));
      assert.deepEqual(horizontal, [], `La venta no necesita barras horizontales en ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `La página cabe en ${width}px`);
      const positions = await page.locator('.sale-items').evaluate(element => {
        const bounds = selector => element.querySelector(selector).getBoundingClientRect();
        const selection = bounds('.sale-selection'), cart = bounds('.sale-cart'), catalog = bounds('.sale-product-catalog');
        return { selectionBeforeCart: selection.bottom <= cart.top, cartBeforeCatalog: cart.bottom <= catalog.top,
          selectionFirst: element.firstElementChild.matches('.sale-selection') };
      });
      assert.deepEqual(positions, { selectionBeforeCart: true, cartBeforeCatalog: true, selectionFirst: true });
      const camera = page.getByRole('button', { name: 'Escanear con cámara' });
      const cameraBounds = await camera.boundingBox();
      assert.equal(cameraBounds.width, 44);
      assert.equal(cameraBounds.height, 44);
      assert.equal(await camera.innerText(), '');
      const icon = await camera.locator('svg').boundingBox();
      assert.equal(icon.width, 16); assert.equal(icon.height, 16);
      const searchBounds = await search.boundingBox();
      assert.ok(searchBounds.width >= 200, `La búsqueda conserva ancho útil en ${width}px`);
      assert.ok(Math.abs(cameraBounds.y - searchBounds.y) < 1, `Cámara y búsqueda comparten una fila: ${JSON.stringify({ width, cameraBounds, searchBounds })}`);
      assert.ok(cameraBounds.x >= searchBounds.x + searchBounds.width + 7, 'La cámara está separada a la derecha');
      const cards = grid.getByRole('button', { name: /Repuesto del taller/ });
      for (const card of await cards.all())
        assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `El texto cabe en ${width}px`);
      for (const control of [previous, next]) assert.ok((await control.boundingBox()).height >= 44);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${engine}-venta-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  assert.deepEqual(writes, []);
  }
});

test('el escaneo aceptado muestra producto y cantidad y emite un pitido; los rechazos no anuncian éxito', async t => {
  const { page, search, writes } = await openSale(t);
  await observeScanAudio(page);
  await page.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('2');
  await search.fill(product.codigo); await search.press('Enter');
  const notice = page.locator('[data-sonner-toast]').filter({ hasText: 'Agregado a la venta' });
  await notice.waitFor();
  assert.match(await notice.innerText(), /2 × Repuesto sintético/);
  const row = page.getByRole('row').filter({ hasText: product.nombre });
  assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2');
  await page.waitForFunction(() => window.scanAudio.peak > 0.01 && window.scanAudio.beeps[0]?.ended);
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 1);
  // A new invalid read must remove the preceding confirmation, not reuse it.
  await search.fill('NO-EXISTE'); await search.press('Enter');
  await page.getByRole('alert').filter({ hasText: /código exacto/ }).waitFor();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 1);
  await page.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('2');
  await search.fill(product.codigo); await search.press('Enter');
  await page.getByText(/Existencias insuficientes/).waitFor();
  assert.equal((await row.getByRole('cell').nth(1).innerText()).trim(), '2');
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 1);
  assert.equal(await notice.count(), 0);
  await page.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('1');
  await search.fill(product.codigo); await search.press('Enter');
  await notice.waitFor();
  assert.match(await notice.innerText(), /1 × Repuesto sintético/);
  await page.waitForFunction(() => window.scanAudio.beeps.length === 2 && window.scanAudio.beeps[1].ended);
  assert.equal(await page.evaluate(() => window.scanAudio.contexts.length), 1, 'Se reutiliza el contexto de audio');
  await page.locator('aside').getByRole('link', { name: 'Inventario', exact: true }).click();
  await page.waitForFunction(() => window.scanAudio.contexts.every(context => context.state === 'closed'));
  assert.deepEqual(writes, []);
});

test('un equipo sin audio conserva el agregado y su confirmación visual', async t => {
  for (const unavailable of ['unsupported', 'device-error']) {
    const { page, search, writes } = await openSale(t);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(mode => {
      window.AudioContext = mode === 'unsupported' ? undefined : class {
        constructor() { throw new DOMException('Sin salida de audio', 'NotSupportedError'); }
      };
      window.webkitAudioContext = undefined;
    }, unavailable);
    await search.fill(product.codigo); await search.press('Enter');
    await page.getByText('Agregado a la venta', { exact: true }).waitFor();
    assert.equal((await page.getByRole('row').filter({ hasText: product.nombre }).getByRole('cell').nth(1).innerText()).trim(), '1');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  }
});

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

test('tres pestañas permiten agregar productos mientras otra confirma su propia venta', async t => {
  const { page, search } = await openSale(t);
  const second = await page.context().newPage();
  const third = await page.context().newPage();
  await Promise.all([second.goto(server.origin + '/ventas'), third.goto(server.origin + '/ventas')]);
  const response = Promise.withResolvers();
  const sent = Promise.withResolvers();
  await page.route('**/api/ventas', async route => {
    sent.resolve(); await response.promise;
    await route.fulfill({ status: 503, json: { error: 'Respuesta pendiente en otra pestaña' } });
  });
  try {
    await search.fill(product.codigo); await search.press('Enter');
    await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
    await page.getByRole('button', { name: /Registrar venta/ }).click();
    await sent.promise;
    for (const other of [second, third]) {
      await other.getByText('Solicitud pendiente de confirmación', { exact: true }).waitFor();
      const input = other.getByLabel('Código o nombre del producto', { exact: true });
      assert.equal(await input.isDisabled(), false, 'La espera de otra pestaña no debe bloquear el borrador actual');
    }
    await second.getByRole('button', { name: new RegExp(product.codigo + '.*' + product.nombre) }).click();
    const thirdSearch = third.getByLabel('Código o nombre del producto', { exact: true });
    await thirdSearch.fill(product.codigo); await thirdSearch.press('Enter');
    for (const other of [second, third]) {
      await other.getByRole('row').filter({ hasText: product.nombre }).waitFor();
      assert.equal(await other.getByRole('button', { name: /Registrar venta/ }).isDisabled(), true, 'El guardado espera una confirmación, pero permite preparar la siguiente venta');
    }
    assert.equal(await search.isDisabled(), true, 'La venta que ya se envió conserva sus datos');
  } finally { response.resolve(); }
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
  await page.setViewportSize({ width: 568, height: 320 });
  const dialog = page.getByRole('dialog');
  await dialog.evaluate(async element => { await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  for (const name of ['Cerrar cámara', 'Reintentar cámara']) {
    const bounds = await dialog.getByRole('button', { name, exact: true }).boundingBox();
    assert.ok(bounds.y >= 16 && bounds.y + bounds.height <= 304, `${name} queda accesible tras rechazar el permiso en horizontal`);
  }
  await mockCamera(page);
  await dialog.getByRole('button', { name: 'Reintentar cámara', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
  assert.equal(await dialog.getByLabel('Vista de la cámara').isVisible(), true, 'Reintentar vuelve a mostrar el vídeo');
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
      const stream = canvas.captureStream(5);
      window.setCameraBits = next => {
        context.fillStyle = next ? 'white' : 'rgb(24, 140, 96)'; context.fillRect(0, 0, 640, 360);
        context.fillStyle = 'black';
        for (let index = 0; index < next.length; index++) if (next[index] === '1') context.fillRect(80 + index * 5, 70, 5, 220);
        // Each simulated package must produce a video frame even if the canvas
        // was redrawn between captureStream's scheduled frame requests.
        stream.getVideoTracks()[0].requestFrame();
      };
      window.setCameraBits(bits);
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

test('la vista visible reproduce la cámara al abrir y volver a abrir el diálogo', async t => {
  const { page, writes } = await openSale(t);
  await mockCamera(page);
  for (let opening = 0; opening < 2; opening++) {
    await page.getByRole('button', { name: 'Escanear con cámara' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
    const preview = dialog.getByLabel('Vista de la cámara');
    assert.equal(await preview.evaluate(video => video.srcObject instanceof MediaStream), true,
      'El stream debe estar conectado al video visible, no a un video creado fuera del diálogo.');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.videoWidth > 0 && video.videoHeight > 0 && !video.paused && video.readyState >= 2;
    });
    const pixel = await preview.evaluate(video => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    // Media frames can round RGB values during color-space conversion.
    for (const [channel, expected] of [24, 140, 96, 255].entries())
      assert.ok(Math.abs(pixel[channel] - expected) <= 2, `Canal ${channel}: ${pixel[channel]}`);
    assert.equal(await preview.evaluate(video => video.muted && video.playsInline && video.autoplay), true);
    await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
    await page.waitForFunction(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  }
  assert.deepEqual(writes, []);
});

test('la cámara permite lecturas continuas, no duplica un código sostenido y confirma cada agregado', async t => {
  const second = { ...product, id: 2, codigo: '0012345678912', nombre: 'Segundo repuesto' };
  const secondBits = eanBits.slice(0, -17) + '1100110' + '1101100' + '101';
  const unknownBits = eanBits.slice(0, -17) + '1101100' + '1110100' + '101';
  const { page, writes } = await openSale(t, [product, second]);
  await observeScanAudio(page);
  await mockCamera(page, eanBits);
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  const dialog = page.getByRole('dialog');
  const row = page.locator('.sale-cart tbody tr').filter({ hasText: product.nombre });
  async function checkFeedbackLayout(state) {
    const evidence = process.env.FELIX_SCANNER_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    for (const [width, height] of [[390, 844], [568, 320]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        const close = await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).boundingBox();
        assert.ok(close.y >= 16 && close.y + close.height <= height - 16, 'La confirmación no desplaza Cerrar fuera de pantalla');
        assert.equal(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth), true);
        if (evidence) await page.screenshot({ path: path.join(evidence, `${state}-${width}-${theme}.png`), animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await row.waitFor({ timeout: 7000 });
  assert.match(await row.innerText(), /0012345678905/);
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  assert.equal(await dialog.isVisible(), true, 'La cámara sigue abierta después de agregar');
  await dialog.getByRole('status').filter({ hasText: /Agregado: 1 × Repuesto sintético/ }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.cameraStreams.flatMap(stream => stream.getTracks().map(track => track.readyState))), ['live']);
  assert.equal(await page.evaluate(() => window.cameraConstraints.audio), false);
  await page.waitForFunction(() => window.scanAudio.peak > 0.01 && window.scanAudio.beeps[0]?.ended);
  assert.equal(await page.evaluate(() => window.scanAudio.contexts[0].openedByGesture), true, 'El audio se habilita al pulsar la cámara');
  await page.waitForTimeout(1400); // More than several real decoder passes over a stationary code.
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  await page.evaluate(() => window.setCameraBits(''));
  await page.waitForTimeout(200); // A brief blur must not count the same package again.
  await page.evaluate(bits => window.setCameraBits(bits), eanBits);
  await page.waitForTimeout(500);
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '1');
  await page.evaluate(() => window.setCameraBits(''));
  await page.waitForTimeout(1300);
  await page.evaluate(bits => window.setCameraBits(bits), eanBits);
  await row.locator('td').nth(1).filter({ hasText: /^2$/ }).waitFor();
  await page.waitForFunction(() => window.scanAudio.beeps.length === 2 && window.scanAudio.beeps[1].ended);
  await page.evaluate(bits => window.setCameraBits(bits), secondBits);
  await dialog.getByRole('status').filter({ hasText: /Agregado: 1 × Segundo repuesto/ }).waitFor();
  assert.equal(await page.locator('.sale-cart tbody tr').count(), 2);
  await page.waitForFunction(() => window.scanAudio.beeps.length === 3 && window.scanAudio.beeps[2].ended);
  await checkFeedbackLayout('agregado');
  await page.evaluate(bits => window.setCameraBits(bits), unknownBits);
  await dialog.getByRole('alert').filter({ hasText: /No hay un artículo/ }).waitFor();
  await checkFeedbackLayout('desconocido');
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 3);
  await page.evaluate(bits => window.setCameraBits(bits), eanBits);
  await row.locator('td').nth(1).filter({ hasText: /^3$/ }).waitFor();
  await page.waitForFunction(() => window.scanAudio.beeps.length === 4 && window.scanAudio.beeps[3].ended);
  await page.evaluate(() => window.setCameraBits(''));
  await page.waitForTimeout(1300);
  await page.evaluate(bits => window.setCameraBits(bits), eanBits);
  await dialog.getByRole('alert').filter({ hasText: /No se agregó/ }).waitFor();
  assert.equal((await row.locator('td').nth(1).innerText()).trim(), '3', 'No excede las existencias');
  assert.equal(await page.evaluate(() => window.scanAudio.beeps.length), 4, 'El rechazo no pita');
  assert.equal(await page.evaluate(() => window.cameraRequests), 1, 'Todas las lecturas usan el mismo permiso y vídeo');
  await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
  await page.waitForFunction(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder')?.startsWith('Escanea o escribe'));
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

test('la guía permanece centrada y girar el teléfono no reinicia la cámara', async t => {
  const { page, writes } = await openSale(t);
  await mockCamera(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Escanear con cámara' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('status').filter({ hasText: /Buscando un código/ }).waitFor();
  await dialog.evaluate(async element => { await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  for (const [width, height] of [[390, 844], [844, 390], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const guide = dialog.locator('.barcode-camera-guide');
    assert.equal(await guide.isVisible(), true, 'La cámara muestra una guía visible para el código');
    // Read both boxes in one layout frame while the viewport is rotating.
    const { video, frame } = await guide.evaluate(element => ({
      video: element.parentElement.querySelector('video').getBoundingClientRect().toJSON(),
      frame: element.getBoundingClientRect().toJSON(),
    }));
    assert.ok(frame.width > frame.height * 2, 'El marco debe ser horizontal');
    assert.ok(Math.abs(frame.x + frame.width / 2 - video.x - video.width / 2) < 1);
    assert.ok(Math.abs(frame.y + frame.height / 2 - video.y - video.height / 2) < 1, JSON.stringify({ width, height, video, frame }));
    assert.equal(await guide.locator('.barcode-camera-corner').count(), 4);
    assert.equal(await guide.locator('.barcode-camera-line').isVisible(), true);
    assert.equal(await guide.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => window.cameraRequests), 1);
    assert.equal(await dialog.getByLabel('Vista de la cámara').evaluate(video => !video.paused && video.srcObject.getVideoTracks()[0].readyState === 'live'), true);
  }
  await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
  assert.deepEqual(writes, []);
});

test('el diálogo horizontal cabe en móvil y escritorio en ambos temas', async t => {
  const { page } = await openSale(t);
  await mockCamera(page);
  const evidence = process.env.FELIX_SCANNER_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const [width, height] of [[320, 600], [390, 844], [768, 1024], [568, 320], [667, 375], [844, 390], [1440, 1000]]) {
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
      const landscape = width > height && height <= 600;
      assert.ok(Math.abs(bounds.width - Math.min(width - 32, landscape ? 960 : 768)) < 1, 'El visor aprovecha el ancho disponible.');
      assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= width - 15, 'El diálogo conserva márgenes laterales.');
      assert.ok(bounds.y >= 15 && bounds.y + bounds.height <= height - 15, 'El diálogo cabe en la altura disponible.');
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      const video = await dialog.getByLabel('Vista de la cámara').boundingBox();
      assert.ok(Math.abs(video.width / video.height - 16 / 9) < 0.02, 'La vista conserva una proporción horizontal de 16:9');
      if (landscape) {
        assert.equal(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, 'En horizontal se ven cámara y controles sin desplazar el diálogo');
        const close = await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).boundingBox();
        assert.ok(close.x > video.x + video.width, 'Los controles quedan junto al visor');
        assert.ok(close.y + close.height <= height - 15, 'Cerrar queda dentro de la pantalla');
      }
      if (evidence) await page.screenshot({ path: path.join(evidence, `camera-${width}-${theme}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Cerrar cámara', exact: true }).click();
    }
  }
});
