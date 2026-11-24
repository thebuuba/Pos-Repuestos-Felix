// build-operational sustituye la versión y la lista por los recursos de esta compilación.
const CACHE = 'felix-pos-shell-__BUILD_ID__';
const FILES = [
  '/pwa-shell.html', '/manifest.webmanifest',
  '/assets/fonts/inter-latin-wght-normal.woff2',
  '/assets/brand/repuestos-felix.jpg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
];
const OPTIONAL = [];
const PAGES = new Set(['/', '/index.html', '/ventas', '/inventario', '/compras', '/taller', '/caja', '/clientes', '/suplidores',
  '/reportes', '/cuentas-por-cobrar', '/cuentas-por-pagar', '/configuracion', '/ayuda']);

self.addEventListener('install', (event) => {
  // La página pública no contiene sesión ni datos del negocio. Nunca guardar HTML autenticado.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(url => new Request(url, { credentials: 'omit', cache: 'reload' })))));
  // Sin skipWaiting: no cambiar de versión durante una factura abierta.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('felix-pos-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'WARM_OPTIONAL' || !OPTIONAL.length) return;
  event.waitUntil((async () => {
    if (!(await caches.keys()).includes(CACHE)) return;
    const cache = await caches.open(CACHE);
    for (const pathname of OPTIONAL) {
      if (await cache.match(pathname)) continue;
      if (!(await caches.keys()).includes(CACHE)) return;
      try {
        const response = await fetch(new Request(pathname, { credentials: 'omit' }));
        if (response.ok) await cache.put(pathname, response);
      } catch { /* Precarga opcional en segundo plano. */ }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Solo interfaz estática: nunca API, respaldos, login ni transacciones.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (request.mode === 'navigate' && PAGES.has(url.pathname)) {
    // Only the public, data-free shell is cached. The API still validates the
    // session and fetches current data; reopening no longer waits for HTML auth.
    event.respondWith((async () => await caches.match('/pwa-shell.html', { cacheName: CACHE }) || fetch(request).catch(() => Response.error()))());
    return;
  }
  if (!FILES.includes(url.pathname) && !OPTIONAL.includes(url.pathname)) return;
  event.respondWith((async () => {
    // Una petición tardía no debe recrear la caché retirada por la nueva versión.
    const cached = await caches.match(url.pathname, { cacheName: CACHE });
    if (cached) return cached;
    const cache = OPTIONAL.includes(url.pathname) && (await caches.keys()).includes(CACHE) ? await caches.open(CACHE) : null;
    const response = await fetch(new Request(request, { credentials: 'omit' }));
    if (cache && response.ok) event.waitUntil(cache.put(url.pathname, response.clone()));
    return response;
  })());
});
