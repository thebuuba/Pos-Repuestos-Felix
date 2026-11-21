// Cambiar la versión cuando se publique un nuevo conjunto de archivos estáticos.
const CACHE = 'felix-pos-shell-v1';
const FILES = [
  '/', '/index.html', '/styles.css', '/app.js', '/state.js', '/pwa.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
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
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || !FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.pathname) || fetch(request);
  })());
});
