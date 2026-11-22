// build-operational sustituye la versión y la lista por los recursos de esta compilación.
const CACHE = 'felix-pos-shell-__BUILD_ID__';
const FILES = [
  '/pwa-shell.html', '/manifest.webmanifest',
  '/assets/fonts/inter-latin-wght-normal.woff2',
  '/assets/brand/repuestos-felix.jpg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
];
const PAGES = new Set(['/', '/index.html', '/ventas', '/inventario', '/compras', '/caja', '/clientes', '/suplidores',
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Solo interfaz estática: nunca API, respaldos, login ni transacciones.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (request.mode === 'navigate' && PAGES.has(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match('/pwa-shell.html') || Response.error();
    }));
    return;
  }
  if (!FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.pathname) || fetch(request);
  })());
});
