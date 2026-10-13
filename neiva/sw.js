/* Service Worker — uno por carpeta (forestal/, neiva/, pitalito/, ladorada/).
   Guarda la app en el celular para abrirla sin internet. No toca los datos (IndexedDB). */
const SLUG = new URL(self.registration.scope).pathname.split('/').filter(Boolean).pop() || 'app';
const CACHE = `campo-${SLUG}-v3.1.0`;
const ASSETS = ['./', 'index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
  if (!self.registration.active) self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(`campo-${SLUG}-`) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return new Response('Sin conexión y este archivo no está guardado en el celular.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
