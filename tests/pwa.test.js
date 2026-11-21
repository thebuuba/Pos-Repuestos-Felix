import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function worker() {
  const handlers = new Map();
  const stores = new Map();
  const origin = 'https://pos.example';
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).pathname;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (urls) => { for (const url of urls) store.set(key(url), new Response(`shell:${key(url)}`)); },
        match: async (request) => store.get(key(request))?.clone(),
      };
    },
  };
  const context = {
    self: { location: { origin }, clients: { claim: async () => {} }, addEventListener: (name, callback) => handlers.set(name, callback) },
    caches, URL, Response,
    fetch: async () => { throw new TypeError('Sin conexión'); },
  };
  vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let installed;
  handlers.get('install')({ waitUntil: (promise) => { installed = promise; } });
  await installed;
  return { handlers, caches, stores, origin };
}

test('la interfaz instalada se puede abrir sin conexión', async () => {
  const { handlers, origin } = await worker();
  let result;
  handlers.get('fetch')({
    request: { method: 'GET', mode: 'navigate', url: `${origin}/` },
    respondWith: (response) => { result = response; },
  });
  assert.equal(await (await result).text(), 'shell:/');
});

test('el service worker no intercepta API, escrituras ni inicio de sesión', async () => {
  const { handlers, origin } = await worker();
  for (const [method, path] of [['GET', '/api/state'], ['PUT', '/api/state'], ['POST', '/login'], ['GET', '/login'], ['GET', '/respaldo.json']]) {
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
