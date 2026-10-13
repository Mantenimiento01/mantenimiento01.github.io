/* Retiro del Service Worker antiguo de Podas (las apps ahora viven en /neiva/, /pitalito/, /ladorada/).
   Solo borra archivos de programa en caché; los registros (IndexedDB) NO se tocan. */
const MOVED = { 'podas-neiva.html': 'neiva/', 'podas-pitalito.html': 'pitalito/', 'podas-ladorada.html': 'ladorada/' };
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('podas-v')) await caches.delete(k);
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: 'window' })) {
    const name = new URL(c.url).pathname.split('/').pop();
    c.navigate(MOVED[name] ? new URL(MOVED[name], self.registration.scope).href : c.url).catch(() => {});
  }
  await self.registration.unregister();
})()));
