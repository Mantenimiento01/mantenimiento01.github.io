/* Service Worker de Bitácora Forestal: guarda la aplicación en el dispositivo para abrirla sin internet.
   No toca los datos (IndexedDB): actualizar la app nunca borra registros.
   v1.0.2: solo responde por sus propias páginas, para convivir con las apps de Podas del mismo sitio. */
const CACHE = 'bitacora-campo-v1.0.2';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'db.js', 'zip.js', 'export.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
const BASE = new URL(self.registration.scope).pathname;
const isOwnPage = p => p === BASE || p === BASE + 'index.html';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
  self.skipWaiting();   // esta versión corrige la convivencia: se activa de inmediato
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('bitacora-campo-')) await caches.delete(k);
    await self.clients.claim();
    // Si alguna pestaña de otra app quedó mostrando la Bitácora por error, recargarla
    for (const c of await self.clients.matchAll({ type: 'window' })) {
      if (!isOwnPage(new URL(c.url).pathname)) c.navigate(c.url).catch(() => {});
    }
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate' && !isOwnPage(url.pathname)) return;   // otras apps del sitio: no intervenir
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./')) || fetch(req);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
