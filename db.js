/* Almacenamiento local con IndexedDB. Nada sale del dispositivo. */
'use strict';
const DB = (() => {
  const NAME = 'bitacora-forestal-campo';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          const r = db.createObjectStore('records', { keyPath: 'id' });
          r.createIndex('luminaria', 'luminaria');
          r.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('photos')) {
          const p = db.createObjectStore('photos', { keyPath: 'id' });
          p.createIndex('recordId', 'recordId');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(friendly(req.error));
      req.onblocked = () => reject(new Error('Cierre las otras pestañas de la aplicación e intente de nuevo.'));
    });
    return dbp;
  }

  function friendly(err) {
    if (!err) return new Error('Error desconocido de almacenamiento');
    if (err.name === 'QuotaExceededError') {
      const e = new Error('El almacenamiento del dispositivo está lleno. Libere espacio o exporte y haga copia de seguridad antes de continuar. No se guardó este cambio.');
      e.quota = true; return e;
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  function reqP(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(friendly(req.error)); });
  }
  function txDone(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(friendly(tx.error));
      tx.onabort = () => rej(friendly(tx.error || new Error('Operación cancelada')));
    });
  }

  async function getAll(store) {
    const db = await open();
    return reqP(db.transaction(store).objectStore(store).getAll());
  }
  async function get(store, key) {
    const db = await open();
    return reqP(db.transaction(store).objectStore(store).get(key));
  }
  async function getMeta(key, fallback = null) {
    const r = await get('meta', key);
    return r ? r.value : fallback;
  }
  async function setMeta(key, value) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    return txDone(tx);
  }
  async function delMeta(key) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    return txDone(tx);
  }

  async function photosOf(recordId) {
    const db = await open();
    const list = await reqP(db.transaction('photos').objectStore('photos').index('recordId').getAll(recordId));
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Guarda un registro y sus fotos en UNA sola transacción y luego verifica
   * leyendo de nuevo todo lo escrito. Solo si la verificación pasa se considera guardado.
   * newPhotos: [{id, recordId, data:ArrayBuffer, type, name, createdAt, size}]
   * removedPhotoIds: ids de fotos de ESTE registro a eliminar (ya confirmadas por el usuario)
   */
  async function saveRecord(record, newPhotos = [], removedPhotoIds = []) {
    const db = await open();
    const tx = db.transaction(['records', 'photos', 'meta'], 'readwrite');
    const done = txDone(tx);
    const recs = tx.objectStore('records');
    const phs = tx.objectStore('photos');
    const meta = tx.objectStore('meta');

    if (!record.seq) {
      const r = meta.get('seq');
      r.onsuccess = () => {
        const next = ((r.result && r.result.value) || 0) + 1;
        meta.put({ key: 'seq', value: next });
        record.seq = next;
        record.consecutivo = `${record.brigada}-${String(next).padStart(6, '0')}`;
        recs.put(record);
      };
    } else {
      recs.put(record);
    }
    for (const p of newPhotos) phs.put(p);
    for (const id of removedPhotoIds) {
      const g = phs.get(id);
      g.onsuccess = () => { if (g.result && g.result.recordId === record.id) phs.delete(id); };
    }
    await done;

    // Verificación posterior a la escritura
    const saved = await get('records', record.id);
    if (!saved || saved.updatedAt !== record.updatedAt) throw new Error('No se pudo verificar el registro guardado. Intente de nuevo.');
    for (const p of newPhotos) {
      const back = await get('photos', p.id);
      if (!back || !back.data || back.data.byteLength !== p.data.byteLength || back.recordId !== record.id) {
        throw new Error('Una fotografía no quedó almacenada correctamente. El registro sigue abierto: vuelva a guardar.');
      }
    }
    const all = await photosOf(record.id);
    return { record: saved, photoCount: all.length };
  }

  async function putRecordOnly(record) {
    const db = await open();
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(record);
    await txDone(tx);
    const saved = await get('records', record.id);
    if (!saved || saved.updatedAt !== record.updatedAt) throw new Error('No se pudo verificar el cambio');
    return saved;
  }

  /** Borrado definitivo (solo desde la papelera, con confirmación). */
  async function purgeRecord(id) {
    const photos = await photosOf(id);
    const db = await open();
    const tx = db.transaction(['records', 'photos'], 'readwrite');
    tx.objectStore('records').delete(id);
    for (const p of photos) tx.objectStore('photos').delete(p.id);
    return txDone(tx);
  }

  /** Restauración por fusión: nunca borra; agrega lo que falta y actualiza si la copia es más reciente. */
  async function mergeBackup(records, photos, seq) {
    const db = await open();
    let added = 0, updated = 0, skipped = 0, photosAdded = 0;
    const existing = new Map((await getAll('records')).map(r => [r.id, r]));
    const existingPhotos = new Set((await reqP(db.transaction('photos').objectStore('photos').getAllKeys())));
    const tx = db.transaction(['records', 'photos', 'meta'], 'readwrite');
    const done = txDone(tx);
    for (const r of records) {
      const cur = existing.get(r.id);
      if (!cur) { tx.objectStore('records').put(r); added++; }
      else if ((r.updatedAt || '') > (cur.updatedAt || '')) { tx.objectStore('records').put(r); updated++; }
      else skipped++;
    }
    for (const p of photos) {
      if (!existingPhotos.has(p.id)) { tx.objectStore('photos').put(p); photosAdded++; }
    }
    const m = tx.objectStore('meta').get('seq');
    m.onsuccess = () => {
      const cur = (m.result && m.result.value) || 0;
      if (seq > cur) tx.objectStore('meta').put({ key: 'seq', value: seq });
    };
    await done;
    return { added, updated, skipped, photosAdded };
  }

  return { open, getAll, get, getMeta, setMeta, delMeta, photosOf, saveRecord, putRecordOnly, purgeRecord, mergeBackup };
})();
