/* Retiro del Service Worker antiguo de la raíz (la Bitácora ahora vive en /bitacora/).
   Solo borra archivos de programa en caché; los registros (IndexedDB) NO se tocan. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('bitacora-campo-')) await caches.delete(k);
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  await self.registration.unregister();
})()));
