import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function worker(optional = []) {
  const handlers = new Map();
  const stores = new Map();
  const origin = 'https://pos.example';
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).pathname;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request, { cacheName }) => stores.get(cacheName)?.get(key(request))?.clone(),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (urls) => { for (const url of urls) store.set(key(url), new Response(`shell:${key(url)}`)); },
        match: async (request) => store.get(key(request))?.clone(),
        put: async (request, response) => { store.set(key(request), response); },
      };
    },
  };
  const context = {
    self: { location: { origin }, clients: { claim: async () => {} }, skipWaitingCalls: 0, skipWaiting() { this.skipWaitingCalls++; }, addEventListener: (name, callback) => handlers.set(name, callback) },
    caches, URL, Response, Request: class extends Request { constructor(url, options) { super(typeof url === 'string' ? new URL(url, origin) : url, options); } },
    fetch: async () => { throw new TypeError('Sin conexión'); },
  };
  vm.runInNewContext((await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')).replace('const OPTIONAL = [];', `const OPTIONAL = ${JSON.stringify(optional)};`), context);
  let installed;
  handlers.get('install')({ waitUntil: (promise) => { installed = promise; } });
  await installed;
  return { handlers, caches, stores, origin, context };
}

test('la interfaz instalada se puede abrir sin conexión', async () => {
  const { handlers, origin } = await worker();
  let result;
  handlers.get('fetch')({
    request: { method: 'GET', mode: 'navigate', url: `${origin}/ventas` },
    respondWith: (response) => { result = response; },
  });
  assert.ok(result, 'La ruta de ventas debe abrir la interfaz pública sin conexión');
  assert.equal(await (await result).text(), 'shell:/pwa-shell.html');
});

test('la PWA abre la interfaz pública guardada sin esperar otra navegación de red', async () => {
  const { handlers, origin, context } = await worker();
  let calls = 0;
  context.fetch = async () => { calls++; return new Response('documento de red'); };
  let result;
  handlers.get('fetch')({ request: { method: 'GET', mode: 'navigate', url: `${origin}/inventario` }, respondWith: value => { result = value; } });
  assert.equal(await (await result).text(), 'shell:/pwa-shell.html');
  assert.equal(calls, 0);
});

test('los módulos se guardan al usarse, sin credenciales ni descargar todos al instalar', async () => {
  const modulePath = '/assets/pwa/chunk-TEST1234.js';
  const { handlers, origin, context, stores } = await worker([modulePath]);
  assert.equal([...stores.values()][0].has(modulePath), false);
  let fetches = 0, response, saved;
  context.fetch = async request => {
    fetches++;
    assert.equal(request.credentials, 'omit');
    return new Response('módulo público');
  };
  for (let use = 0; use < 2; use++) {
    handlers.get('fetch')({ request: new Request(origin + modulePath), respondWith: value => { response = value; }, waitUntil: value => { saved = value; } });
    assert.equal(await (await response).text(), 'módulo público');
    await saved;
  }
  assert.equal(fetches, 1);
});

test('la fuente local está disponible sin conexión', async () => {
  const { handlers, origin } = await worker();
  let result;
  handlers.get('fetch')({ request: { method: 'GET', url: `${origin}/assets/fonts/inter-latin-wght-normal.woff2` }, respondWith: value => { result = value; } });
  assert.ok(result, 'La interfaz sin conexión debe conservar Inter');
  assert.equal(await (await result).text(), 'shell:/assets/fonts/inter-latin-wght-normal.woff2');
});

test('la imagen del negocio está disponible sin conexión junto a la interfaz', async () => {
  const { handlers, origin } = await worker();
  let result;
  handlers.get('fetch')({ request: { method: 'GET', url: `${origin}/assets/brand/repuestos-felix.jpg` }, respondWith: value => { result = value; } });
  assert.ok(result, 'La imagen debe pertenecer al conjunto estático de la PWA');
  assert.equal(await (await result).text(), 'shell:/assets/brand/repuestos-felix.jpg');
});

test('el service worker no intercepta API, escrituras ni inicio de sesión', async () => {
  const { handlers, origin } = await worker();
  for (const [method, path] of [['GET', '/api/state'], ['GET', '/api/backup'], ['POST', '/api/facturas'], ['PUT', '/api/state'], ['POST', '/login'], ['GET', '/login'], ['POST', '/logout'], ['POST', '/cuenta/clave'], ['GET', '/respaldo.json']]) {
    let intercepted = false;
    handlers.get('fetch')({ request: { method, url: origin + path }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, `${method} ${path}`);
  }
});

test('la caché no intercepta recursos de otro origen ni URLs con parámetros', async () => {
  const { handlers, origin } = await worker();
  for (const url of ['https://otro.example/app.js', `${origin}/?token=privado`]) {
    let intercepted = false;
    handlers.get('fetch')({ request: { method: 'GET', url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});

test('actualizar la PWA elimina solo sus propias cachés antiguas', async () => {
  const { handlers, caches, stores } = await worker();
  await caches.open('felix-pos-shell-antiguo');
  await caches.open('otra-aplicacion');
  let activated;
  handlers.get('activate')({ waitUntil: (promise) => { activated = promise; } });
  await activated;
  assert.equal(stores.has('felix-pos-shell-antiguo'), false);
  assert.equal(stores.has('otra-aplicacion'), true);
});

test('una petición tardía del worker anterior no recrea su caché retirada', async () => {
  const { handlers, stores, origin } = await worker();
  stores.clear(); // La nueva versión ya retiró la caché de este worker.
  let response;
  handlers.get('fetch')({
    request: { method: 'GET', mode: 'navigate', url: `${origin}/ventas` },
    respondWith: value => { response = value; },
  });
  assert.equal((await response).type, 'error');
  assert.equal(stores.size, 0);
});

test('SKIP_WAITING solo activa la nueva versión bajo petición explícita y /taller sirve el shell sin conexión', async () => {
  const { handlers, origin, context } = await worker();
  assert.equal(context.self.skipWaitingCalls, 0, 'install no debe llamar skipWaiting automáticamente');
  handlers.get('message')({ data: { type: 'SKIP_WAITING' } });
  assert.equal(context.self.skipWaitingCalls, 1, 'SKIP_WAITING explícito debe activar la versión nueva');
  let result;
  handlers.get('fetch')({
    request: { method: 'GET', mode: 'navigate', url: `${origin}/taller` },
    respondWith: value => { result = value; },
  });
  assert.ok(result, '/taller debe abrir el shell sin conexión');
  assert.equal(await (await result).text(), 'shell:/pwa-shell.html');
});
