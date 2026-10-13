/* Service Worker de Podas (Neiva · Pitalito · La Dorada). Alcance: archivos que empiezan por "podas-".
   No toca los datos (IndexedDB): actualizar nunca borra registros. */
const CACHE = 'podas-v1.0.0';
const CITIES = ['neiva', 'pitalito', 'ladorada'];
const ASSETS = ['podas-app.js', 'podas-app.css', ...CITIES.flatMap(c => [`podas-${c}.html`, `podas-${c}.webmanifest`, `podas-${c}.png`])];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
  if (!self.registration.active) self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('podas-v') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return new Response('Sin conexión y este archivo no está guardado en el celular.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
