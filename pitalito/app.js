/* App de campo forestal — American Lighting
   Modo "admin": Inventario forestal (Neiva, Pitalito) + Podas (Neiva, Pitalito, La Dorada).
   Modo "crew":  Podas de un solo municipio (apps de cuadrilla).
   Todo se guarda en el celular (IndexedDB). Excel con fotos, KMZ con fotos y ZIP se generan sin internet. */
'use strict';
const CFG = window.APP;                         // {mode:'admin'|'crew', city?:'neiva'}
const ADMIN = CFG.mode === 'admin';
const APP_VERSION = '3.1.0';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const CITIES = {
  neiva: { name: 'Neiva', color: '#1E6B3A' },
  pitalito: { name: 'Pitalito', color: '#1F5F8B' },
  ladorada: { name: 'La Dorada', color: '#B4532A' }
};
const MODS = {
  inv: { label: 'Inventario forestal', short: 'Inventario', icon: '🌳', cities: ['neiva', 'pitalito'], kinds: ['foto1', 'foto2'] },
  poda: { label: 'Podas', short: 'Podas', icon: '✂️', cities: ['neiva', 'pitalito', 'ladorada'], kinds: ['antes', 'despues'] }
};
const KIND_LABEL = { foto1: 'FOTO 1', foto2: 'FOTO 2', antes: 'ANTES', despues: 'DESPUÉS' };

/* ======================= ZIP (modo store) ======================= */
const Zip = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function u8(d) {
    if (d instanceof Uint8Array) return d; if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (typeof d === 'string') return enc.encode(d); if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
    throw new Error('Dato no soportado');
  }
  function dos(d) { const y = Math.max(1980, d.getFullYear()); return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  async function build(files, mime = 'application/zip') {
    const parts = [], cen = []; let off = 0; const now = dos(new Date());
    for (const f of files) {
      const data = await u8(f.data), name = enc.encode(f.name), crc = crc32(data);
      const L = new DataView(new ArrayBuffer(30));
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true);
      L.setUint16(10, now.t, true); L.setUint16(12, now.d, true); L.setUint32(14, crc, true);
      L.setUint32(18, data.length, true); L.setUint32(22, data.length, true); L.setUint16(26, name.length, true);
      parts.push(new Uint8Array(L.buffer), name, data);
      const C = new DataView(new ArrayBuffer(46));
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x0800, true);
      C.setUint16(12, now.t, true); C.setUint16(14, now.d, true); C.setUint32(16, crc, true);
      C.setUint32(20, data.length, true); C.setUint32(24, data.length, true); C.setUint16(28, name.length, true); C.setUint32(42, off, true);
      cen.push(new Uint8Array(C.buffer), name); off += 30 + name.length + data.length;
    }
    if (files.length > 65535 || off > 0xFFFFFFFF) throw new Error('El archivo es demasiado grande. Exporte por mes o por cuadrilla.');
    const size = cen.reduce((s, a) => s + a.length, 0), E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true); E.setUint16(8, files.length, true); E.setUint16(10, files.length, true); E.setUint32(12, size, true); E.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(E.buffer)], { type: mime });
  }
  async function read(blob) {
    const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer);
    let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('El archivo no es un ZIP válido');
    const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out = new Map();
    for (let k = 0; k < n; k++) {
      const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), cs = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      const st = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = b.subarray(st, st + cs); let data;
      if (method === 0) data = raw;
      else if (method === 8 && typeof DecompressionStream !== 'undefined') data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error('Compresión no soportada: ' + name);
      if (crc32(data) !== crc) throw new Error('Archivo dañado dentro del ZIP: ' + name);
      out.set(name, data);
    }
    return out;
  }
  return { build, read, text: u => dec.decode(u) };
})();

/* ======================= Base de datos local ======================= */
const DB_NAME = ADMIN ? 'forestal-admin' : 'podas-' + CFG.city;   // las cuadrillas conservan su base anterior
const DB = (() => {
  let p = null;
  const friendly = e => {
    if (e && e.name === 'QuotaExceededError') { const x = new Error('El almacenamiento del celular está lleno. No se guardó. Exporte, haga copia y libere espacio.'); x.quota = true; return x; }
    return e instanceof Error ? e : new Error(String(e || 'Error de almacenamiento'));
  };
  function open() {
    return p || (p = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const rs = db.createObjectStore('records', { keyPath: 'id' }); rs.createIndex('sticker', 'sticker');
        const ps = db.createObjectStore('photos', { keyPath: 'id' }); ps.createIndex('recordId', 'recordId');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
      r.onerror = () => rej(friendly(r.error));
    }));
  }
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(friendly(r.error)); });
  const done = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(friendly(t.error)); t.onabort = () => rej(friendly(t.error || new Error('Operación cancelada'))); });
  async function all(s) { return rq((await open()).transaction(s).objectStore(s).getAll()); }
  async function get(s, k) { return rq((await open()).transaction(s).objectStore(s).get(k)); }
  async function keys(s) { return rq((await open()).transaction(s).objectStore(s).getAllKeys()); }
  async function meta(k, d = null) { const r = await get('meta', k); return r ? r.value : d; }
  async function setMeta(k, v) { const t = (await open()).transaction('meta', 'readwrite'); t.objectStore('meta').put({ key: k, value: v }); return done(t); }
  async function delMeta(k) { const t = (await open()).transaction('meta', 'readwrite'); t.objectStore('meta').delete(k); return done(t); }
  async function photosOf(id) { return rq((await open()).transaction('photos').objectStore('photos').index('recordId').getAll(id)); }
  async function save(rec, newPhotos, removeIds) {
    const t = (await open()).transaction(['records', 'photos', 'meta'], 'readwrite'), d = done(t);
    if (!rec.seq) {
      const m = t.objectStore('meta').get('seq');
      m.onsuccess = () => { const n = ((m.result && m.result.value) || 0) + 1; t.objectStore('meta').put({ key: 'seq', value: n }); rec.seq = n; t.objectStore('records').put(rec); };
    } else t.objectStore('records').put(rec);
    for (const ph of newPhotos) t.objectStore('photos').put(ph);
    for (const id of removeIds) t.objectStore('photos').delete(id);
    await d;
    const back = await get('records', rec.id);
    if (!back || back.updatedAt !== rec.updatedAt) throw new Error('No se pudo verificar el registro. Toque Guardar de nuevo.');
    for (const ph of newPhotos) {
      const b = await get('photos', ph.id);
      if (!b || !b.full || b.full.byteLength !== ph.full.byteLength || !b.mid || b.mid.byteLength !== ph.mid.byteLength) throw new Error('La foto ' + KIND_LABEL[ph.kind] + ' no quedó guardada. Toque Guardar de nuevo.');
    }
    return back;
  }
  async function putRecord(rec) { const t = (await open()).transaction('records', 'readwrite'); t.objectStore('records').put(rec); await done(t); }
  async function purge(id) {
    const ph = await photosOf(id), t = (await open()).transaction(['records', 'photos'], 'readwrite');
    t.objectStore('records').delete(id); ph.forEach(x => t.objectStore('photos').delete(x.id)); return done(t);
  }
  async function merge(records, photos) {
    const cur = new Map((await all('records')).map(r => [r.id, r])), have = new Set(await keys('photos'));
    const t = (await open()).transaction(['records', 'photos'], 'readwrite'), d = done(t);
    let added = 0, updated = 0, same = 0, padd = 0;
    for (const r of records) {
      const c = cur.get(r.id), copy = { ...r };
      if (!c) { copy.seq = 0; copy.importado = true; t.objectStore('records').put(copy); added++; }
      else if ((r.updatedAt || '') > (c.updatedAt || '')) { copy.seq = c.seq; copy.importado = c.importado; t.objectStore('records').put(copy); updated++; }
      else same++;
    }
    for (const ph of photos) if (!have.has(ph.id)) { t.objectStore('photos').put(ph); padd++; }
    await d; return { added, updated, same, padd };
  }
  return { open, all, get, meta, setMeta, delMeta, photosOf, save, putRecord, purge, merge };
})();

/* Normaliza registros de versiones anteriores (podas v1) */
function norm(r, fallbackCity) {
  if (!r.mod) r.mod = 'poda';
  if (!r.city) r.city = fallbackCity || CFG.city || 'neiva';
  if (!r.fotos) r.fotos = r.mod === 'poda' ? { antes: r.fotoAntes || null, despues: r.fotoDespues || null } : {};
  if (r.coord && r.coord.lat != null && !r.coord.src) r.coord.src = 'gps';
  return r;
}

/* ======================= Especies ======================= */
const SPECIES = [
  ['Mango', 'Mangifera indica'], ['Oití', 'Licania tomentosa'], ['Ficus', 'Ficus benjamina'], ['Caucho', 'Ficus elastica'],
  ['Almendro', 'Terminalia catappa'], ['Samán', 'Samanea saman'], ['Guayacán amarillo', 'Handroanthus chrysanthus'],
  ['Guayacán rosado', 'Tabebuia rosea'], ['Acacia roja / Flamboyán', 'Delonix regia'], ['Lluvia de oro', 'Cassia fistula'],
  ['Matarratón', 'Gliricidia sepium'], ['Ceiba', 'Ceiba pentandra'], ['Neem', 'Azadirachta indica'], ['Mamoncillo', 'Melicoccus bijugatus'],
  ['Palma real', 'Roystonea regia'], ['Guácimo', 'Guazuma ulmifolia'], ['Chiminango / Payandé', 'Pithecellobium dulce'],
  ['Leucaena', 'Leucaena leucocephala'], ['Totumo', 'Crescentia cujete'], ['Cañafístula', 'Cassia grandis'], ['Swinglea', 'Swinglea glutinosa'],
  ['Guamo', 'Inga edulis'], ['Aguacate', 'Persea americana'], ['Limón', 'Citrus × limon'], ['Guanábano', 'Annona muricata'],
  ['Pomarroso', 'Syzygium jambos'], ['Igua', 'Albizia guachapele'], ['Cedro', 'Cedrela odorata'], ['Teca', 'Tectona grandis'],
  ['Urapán', 'Fraxinus uhdei'], ['Eucalipto', 'Eucalyptus globulus'], ['Pino', 'Pinus patula'], ['Nogal cafetero', 'Cordia alliodora'],
  ['Chicalá', 'Tecoma stans'], ['Acacia negra', 'Acacia melanoxylon'], ['Cajeto / Nacedero', 'Trichanthera gigantea'],
  ['Carbonero', 'Calliandra pittieri'], ['Sauce', 'Salix humboldtiana'], ['Guadua', 'Guadua angustifolia'], ['Bambú', 'Bambusa vulgaris']
];

/* ======================= Utilidades ======================= */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function num(v) { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; }
const now = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const fmtDate = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtTime = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const monthKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = k => { const [y, m] = k.split('-'); return `${MESES[+m - 1]} ${y}`; };
const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'SN';
function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
const CO = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };
const inCO = (a, b) => a >= CO.latMin && a <= CO.latMax && b >= CO.lonMin && b <= CO.lonMax;

let toastT;
function toast(m, k = '') { const t = $('#toast'); t.textContent = m; t.className = 'toast ' + k; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), k === 'err' ? 7000 : 3500); }
function ask(title, html, btns) {
  return new Promise(res => {
    const d = $('#dlg'); $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = html;
    const box = $('#dlgBtns'); box.innerHTML = '';
    btns.forEach(b => { const e = document.createElement('button'); e.className = 'btn ' + (b.kind || ''); e.textContent = b.label; e.value = b.value; box.appendChild(e); });
    d.returnValue = ''; d.onclose = () => res(d.returnValue || null); d.showModal();
  });
}
const confirmBox = async (t, h, ok = 'Aceptar', kind = 'primary') => (await ask(t, h, [{ label: 'Cancelar', value: 'no' }, { label: ok, value: 'yes', kind }])) === 'yes';
function download(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
}
function offerShare(blob, name, where = '#exportLog') {
  try {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '📤 Compartir ' + name;
      b.onclick = () => navigator.share({ files: [f], title: name }).catch(() => {});
      $(where).prepend(b);
    }
  } catch (e) { }
}

/* ======================= Estado ======================= */
const S = {
  records: [], settings: { cuadrilla: '', responsable: '' }, ctx: ADMIN ? null : { mod: 'poda', city: CFG.city },
  filter: 'all', q: '', editing: null, photos: {}, removeIds: [], coord: null, gps: null, urls: [], dirty: false
};
const inCtx = r => S.ctx && r.mod === S.ctx.mod && r.city === S.ctx.city;
const active = () => S.records.filter(r => !r.deleted && inCtx(r));
const brandColor = () => S.ctx ? CITIES[S.ctx.city].color : '#1f4d2e';

const REQ_LABEL = { cap: 'CAP', altura: 'altura', copa: 'copa', costado: 'costado', cortes: 'N.º cortes', ramas: 'N.º ramas', despues: 'foto DESPUÉS', foto1: 'foto', nombreComun: 'nombre común', estado: 'estado', ubicacion: 'ubicación' };
function hasCoord(r) { return !!(r.coord && Number.isFinite(r.coord.lat) && Number.isFinite(r.coord.lon)); }
function missing(r) {
  const m = [];
  if (!r.nombreComun) m.push('nombreComun');
  if (!r.estado) m.push('estado');
  if (r.cap == null) m.push('cap');
  if (r.altura == null) m.push('altura');
  if (r.mod === 'inv') {
    if (r.copa == null) m.push('copa');
    if (!hasCoord(r)) m.push('ubicacion');
  } else {
    if (!r.costado) m.push('costado');
    if (r.cortes == null) m.push('cortes');
    if (r.ramas == null) m.push('ramas');
    if (!r.fotos || !r.fotos.despues) m.push('despues');
  }
  return m;
}

/* ======================= Fotos ======================= */
async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) {
    const url = URL.createObjectURL(blob);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
}
async function encode(src, max, q) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const k = Math.min(1, max / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);
  const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  if (!b || !b.size) throw new Error('No se pudo procesar la foto');
  return { data: await b.arrayBuffer(), w, h };
}
async function processPhoto(blob, kind) {
  const img = await decodeImage(blob);
  try {
    const full = await encode(img, 1600, 0.82), mid = await encode(img, 560, 0.72);
    return { id: uuid(), kind, type: 'image/jpeg', full: full.data, w: full.w, h: full.h, mid: mid.data, mw: mid.w, mh: mid.h, takenAt: now() };
  } finally { if (img.close) img.close(); }
}
function blobUrl(buf) { const u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })); S.urls.push(u); return u; }
function clearUrls() { S.urls.forEach(u => URL.revokeObjectURL(u)); S.urls = []; }

/* ======================= Conexión / offline ======================= */
const ASSETS = ['./', 'index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'icon.png'];
function net() {
  const p = $('#netPill');
  if (navigator.onLine) { p.textContent = 'Con conexión'; p.className = 'pill'; }
  else { p.textContent = 'Sin conexión · guardando en el celular'; p.className = 'pill off'; }
}
async function ready() {
  const pill = $('#readyPill'), info = $('#offlineInfo');
  if (!('serviceWorker' in navigator) || !window.caches || !isSecureContext) {
    pill.textContent = 'Sin modo offline'; pill.className = 'pill off';
    if (info) info.textContent = 'Abra la app desde la dirección https:// en Chrome para que funcione sin conexión.'; return false;
  }
  let miss = 0; for (const a of ASSETS) if (!(await caches.match(new URL(a, location.href).href))) miss++;
  const c = navigator.serviceWorker.controller, ok = !miss && c && c.scriptURL === new URL('sw.js', location.href).href;
  pill.textContent = ok ? '✓ Lista sin conexión' : 'Preparando offline…'; pill.className = 'pill ' + (ok ? 'ready' : 'warn');
  if (info) info.textContent = ok ? '✓ La app está guardada en el celular y abre sin internet.' : 'Mantenga la conexión y vuelva a abrir la app una vez para terminar de prepararla.';
  return ok;
}
function setupSW() {
  if (!('serviceWorker' in navigator)) return ready();
  const mine = () => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL === new URL('sw.js', location.href).href;
  navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
    const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && mine()) $('#updateBar').hidden = false; ready(); });
    if (reg.waiting && mine()) $('#updateBar').hidden = false;
    watch(reg.installing); reg.addEventListener('updatefound', () => watch(reg.installing));
    $('#btnUpdate').onclick = () => reg.waiting && reg.waiting.postMessage('skipWaiting');
  }).catch(() => ready());
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!$('#updateBar').hidden && !reloaded) { reloaded = true; location.reload(); } else setTimeout(ready, 300); });
  setTimeout(ready, 1500);
}
async function storage() {
  let t = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      t = `Usado ${bytes(usage)} de ${bytes(quota)}.`;
      $('#storageBar').hidden = !(quota && (usage / quota > 0.9 || quota - usage < 80 * 1048576));
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted(); $('#btnPersist').hidden = p;
      t += p ? ' ✓ Datos protegidos.' : ' Datos aún no protegidos contra borrado automático.';
    }
  } catch (e) { }
  const el = $('#storageInfo'); if (el) el.textContent = `${S.records.filter(r => !r.deleted).length} registros en total. ` + t;
}
async function persist(silent) {
  try { if (navigator.storage && navigator.storage.persist) { const ok = await navigator.storage.persist(); if (!silent) toast(ok ? 'Datos protegidos ✓' : 'Instale la app en la pantalla de inicio y vuelva a intentarlo', ok ? 'ok' : 'err'); } } catch (e) { }
  storage();
}

/* ======================= Navegación ======================= */
function paintHeader() {
  document.documentElement.style.setProperty('--brand', brandColor());
  document.querySelector('meta[name=theme-color]').content = brandColor();
  $('#ctxTitle').textContent = S.ctx ? `${MODS[S.ctx.mod].label}` : 'Forestal';
  $('#ctxSub').textContent = S.ctx ? CITIES[S.ctx.city].name.toUpperCase() : 'INVENTARIO Y PODAS';
  $('#homeBtn').hidden = !ADMIN || !S.ctx;
  $('#cuadPill').textContent = S.settings.cuadrilla || (ADMIN ? 'Sin nombre' : 'Sin cuadrilla');
  $('.tabs').hidden = !S.ctx;
  $('#tabNewLabel').textContent = S.ctx && S.ctx.mod === 'inv' ? 'Nuevo árbol' : 'Nueva poda';
}
async function show(view) {
  if (!$('#v-form').hidden && view !== 'form' && S.dirty) {
    if (!(await confirmBox('Registro sin guardar', 'Lo que lleva queda como borrador y lo puede continuar desde <b>Nuevo</b>.', 'Salir'))) return;
    stopGps();
  }
  if (!S.ctx && view !== 'home') view = 'home';
  $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  paintHeader(); scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'list') renderList();
  if (view === 'export') renderExport();
  if (view === 'backup') renderBackup();
}
function setCtx(mod, city) { S.ctx = { mod, city }; S.filter = 'all'; S.q = ''; $('#q').value = ''; $$('#filters .chip').forEach(x => x.classList.toggle('on', x.dataset.f === 'all')); try { localStorage.setItem('ctx', JSON.stringify(S.ctx)); } catch (e) { } show('list'); }
function renderHome() {
  const box = $('#homeBox'); box.innerHTML = '';
  for (const [mk, m] of Object.entries(MODS)) {
    const sec = document.createElement('section'); sec.className = 'home';
    sec.innerHTML = `<h2>${m.icon} ${m.label}</h2><div class="hgrid">` + m.cities.map(c => {
      const n = S.records.filter(r => !r.deleted && r.mod === mk && r.city === c).length;
      return `<button class="hcard" data-mod="${mk}" data-city="${c}" style="--c:${CITIES[c].color}"><b>${CITIES[c].name}</b><span>${n} registro${n === 1 ? '' : 's'}</span></button>`;
    }).join('') + '</div>';
    box.appendChild(sec);
  }
}

/* ======================= Lista ======================= */
async function load() {
  S.records = (await DB.all('records')).map(r => norm(r));
  S.records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
const keyOf = r => r.mod === 'inv' ? r.luminaria : r.sticker;
const keyLabel = mod => mod === 'inv' ? 'Luminaria' : 'Sticker';
async function renderList() {
  clearUrls();
  const all = active(), mk = monthKey(now()), mod = S.ctx.mod;
  const mes = all.filter(r => monthKey(r.createdAt) === mk), pend = all.filter(r => missing(r).length);
  $('#summary').innerHTML = mod === 'poda'
    ? `<div><b>${mes.length}</b><span>árboles este mes</span></div><div><b>${mes.reduce((s, r) => s + (r.cortes || 0), 0)}</b><span>cortes este mes</span></div><div class="${pend.length ? 'warn' : ''}"><b>${pend.length}</b><span>pendientes</span></div>`
    : `<div><b>${all.length}</b><span>árboles</span></div><div><b>${mes.length}</b><span>este mes</span></div><div class="${pend.length ? 'warn' : ''}"><b>${pend.length}</b><span>pendientes</span></div>`;
  let list = all;
  if (S.filter === 'pend') list = pend;
  if (S.filter === 'mes') list = mes;
  if (S.filter === 'hoy') { const d = new Date().toDateString(); list = all.filter(r => new Date(r.createdAt).toDateString() === d); }
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(r => [keyOf(r), r.nombreComun, r.cuadrilla].some(v => String(v || '').toLowerCase().includes(q)));
  $('#empty').hidden = all.length > 0;
  const ul = $('#list'); ul.innerHTML = '';
  const kinds = MODS[mod].kinds;
  for (const r of list.slice(0, 300)) {
    const m = missing(r), li = document.createElement('li'); li.className = 'item'; li.dataset.id = r.id; li.tabIndex = 0;
    const sub = mod === 'poda'
      ? `${esc(r.nombreComun || '—')}${r.estado ? ' · ' + esc(r.estado) : ''}${r.cortes != null ? ' · ' + r.cortes + ' corte' + (r.cortes === 1 ? '' : 's') : ''}${r.ramas != null ? ' · ' + r.ramas + ' rama' + (r.ramas === 1 ? '' : 's') : ''}`
      : `${esc(r.nombreComun || '—')}${r.estado ? ' · ' + esc(r.estado) : ''}${r.cap != null ? ' · CAP ' + r.cap : ''}`;
    li.innerHTML = `<div class="thumbs2">${kinds.map(k => `<div class="tb" data-k="${k}"><span>${KIND_LABEL[k]}</span></div>`).join('')}</div>
      <div class="info"><div class="st">${keyLabel(mod)} <b>${esc(keyOf(r))}</b></div><div class="sub">${sub}</div>
      <div class="badges">${m.length ? `<span class="badge warn">Falta: ${m.map(x => REQ_LABEL[x]).join(', ')}</span>` : '<span class="badge ok">Completo</span>'}
      ${ADMIN && r.cuadrilla ? `<span class="badge">${esc(r.cuadrilla)}</span>` : ''}<span class="date">${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)}</span></div></div>`;
    ul.appendChild(li);
  }
  if (list.length > 300) ul.insertAdjacentHTML('beforeend', `<li class="empty">Mostrando 300 de ${list.length}. Use el buscador.</li>`);
  if (!list.length && all.length) ul.innerHTML = '<li class="empty">Ningún registro coincide.</li>';
  for (const li of ul.querySelectorAll('.item')) {
    for (const p of await DB.photosOf(li.dataset.id)) {
      const tb = li.querySelector(`.tb[data-k="${p.kind}"]`);
      if (tb) { tb.style.backgroundImage = `url(${blobUrl(p.mid)})`; tb.classList.add('has'); }
    }
  }
}

/* ======================= Formulario ======================= */
const slotHtml = (kind, label, req) => `<div class="card"><label class="lbl">${label}${req ? ' *' : ''}</label>
  <div class="slot" id="slot-${kind}"><div class="img" data-act="cam" data-k="${kind}" role="button" tabindex="0"><span class="ph">📷<b>Tomar ${label.toLowerCase()}</b></span></div>
  <div class="srow"><span class="state"></span><button type="button" class="link" data-act="gal" data-k="${kind}">Galería</button><button type="button" class="link danger del" data-act="delphoto" data-k="${kind}">Quitar</button></div>
  <input type="file" accept="image/*" capture="environment" hidden data-k="${kind}" class="cam"><input type="file" accept="image/*" hidden data-k="${kind}" class="gal"></div></div>`;
const chipsHtml = (f, opts) => `<input type="hidden" name="${f}"><div class="chips c${opts.length}">${opts.map(o => `<button type="button" class="chip" data-act="chip" data-f="${f}" data-v="${o}">${o}</button>`).join('')}</div>`;
const especieHtml = () => `<label class="lbl">Nombre común</label><input name="nombreComun" list="dlComun" placeholder="ej. Mango">
  <button type="button" class="link" data-act="sci">+ Nombre científico (opcional)</button><div id="sciBox" hidden><input name="nombreCientifico" list="dlSci" placeholder="Nombre científico"></div>`;
const locHtml = () => `<div class="card"><label class="lbl">Ubicación (GPS)</label><div id="locStatus" class="locs"></div>
  <div class="row2"><button type="button" class="btn small" data-act="gps">📍 Tomar ubicación</button><button type="button" class="btn small" data-act="manual">✏️ Escribir</button></div>
  <div id="locManual" class="g2" hidden><div><label class="lbl">Latitud</label><input name="lat" inputmode="decimal" placeholder="2.9273"></div><div><label class="lbl">Longitud</label><input name="lon" inputmode="decimal" placeholder="-75.2819"></div></div>
  <button type="button" class="link danger" data-act="clearcoord">Borrar ubicación</button>
  <p class="hint">Funciona sin internet a cielo abierto. La precisión depende del celular; no es levantamiento topográfico. Si no hay señal, guarde y complete después.</p></div>`;
function formHtml(mod) {
  if (mod === 'inv') return `
    <div class="card"><label class="lbl">Código de luminaria *</label><input name="luminaria" class="big" autocapitalize="characters" placeholder="Código"><p id="dupInfo" class="hint" hidden></p></div>
    ${slotHtml('foto1', 'Foto 1 (opcional)', false)}
    <div class="card">${especieHtml()}
      <label class="lbl">Estado fitosanitario</label>${chipsHtml('estado', ['Bueno', 'Regular', 'Malo', 'Muerto'])}
      <div class="g3"><div><label class="lbl">CAP (cm)</label><input name="cap" inputmode="decimal" placeholder="0"></div>
      <div><label class="lbl">Altura (m)</label><input name="altura" inputmode="decimal" placeholder="0"></div>
      <div><label class="lbl">Copa (m)</label><input name="copa" inputmode="decimal" placeholder="0"></div></div>
      <p class="hint" id="dapInfo"></p></div>
    ${locHtml()}
    ${slotHtml('foto2', 'Foto 2 (opcional)', false)}
    <div class="card"><label class="lbl">Observaciones (opcional)</label><textarea name="obs" rows="2"></textarea></div>`;
  return `
    <div class="card"><label class="lbl">Sticker *</label><input name="sticker" class="big" inputmode="numeric" autocapitalize="characters" placeholder="Número del sticker"><p id="dupInfo" class="hint" hidden></p></div>
    ${slotHtml('antes', 'Foto ANTES', true)}
    <div class="card">${especieHtml()}
      <label class="lbl">Estado</label>${chipsHtml('estado', ['Bueno', 'Regular', 'Malo', 'Muerto'])}
      <div class="g2"><div><label class="lbl">CAP (cm)</label><input name="cap" inputmode="decimal" placeholder="0"></div><div><label class="lbl">Altura (m)</label><input name="altura" inputmode="decimal" placeholder="0"></div></div>
      <label class="lbl">Costado de luminaria</label>${chipsHtml('costado', ['Izquierdo', 'Derecho', 'Frontal', 'Posterior'])}
      <div class="g2"><div><label class="lbl">Número de cortes</label>
      <div class="stepper"><button type="button" class="btn" data-act="minus" data-f="cortes">−</button><input name="cortes" inputmode="numeric" placeholder="0"><button type="button" class="btn" data-act="plus" data-f="cortes">+</button></div></div>
      <div><label class="lbl">Número de ramas</label>
      <div class="stepper"><button type="button" class="btn" data-act="minus" data-f="ramas">−</button><input name="ramas" inputmode="numeric" placeholder="0"><button type="button" class="btn" data-act="plus" data-f="ramas">+</button></div></div></div></div>
    ${slotHtml('despues', 'Foto DESPUÉS', false)}
    <p class="hint pad">Puede guardar con la foto ANTES y agregar la DESPUÉS al terminar (abra el registro desde la lista).</p>
    ${locHtml()}
    <div class="card"><label class="lbl">Observaciones (opcional)</label><textarea name="obs" rows="2"></textarea></div>`;
}
const FIELDS = { inv: ['luminaria', 'nombreComun', 'nombreCientifico', 'estado', 'cap', 'altura', 'copa', 'obs'], poda: ['sticker', 'nombreComun', 'nombreCientifico', 'estado', 'cap', 'altura', 'costado', 'cortes', 'ramas', 'obs'] };
const NUMS = { inv: [['cap', 'CAP'], ['altura', 'Altura'], ['copa', 'Copa']], poda: [['cap', 'CAP'], ['altura', 'Altura'], ['cortes', 'N.º de cortes'], ['ramas', 'N.º de ramas']] };
const F = () => $('#form').elements;

async function openForm(rec, draft) {
  stopGps(); clearUrls();
  const mod = S.ctx.mod;
  $('#formBody').innerHTML = formHtml(mod);
  S.editing = rec ? structuredClone(rec) : null;
  S.photos = {}; S.removeIds = []; S.coord = rec && hasCoord(rec) ? { ...rec.coord } : null;
  if (rec) {
    FIELDS[mod].forEach(k => setField(k, rec[k]));
    for (const p of await DB.photosOf(rec.id)) S.photos[p.kind] = { ...p, saved: true };
  }
  if (draft) {
    FIELDS[mod].forEach(k => { if (draft.fields[k] !== undefined) setField(k, draft.fields[k]); });
    for (const k of MODS[mod].kinds) if (draft.photos && draft.photos[k]) S.photos[k] = draft.photos[k];
    S.removeIds = draft.removeIds || []; if (draft.coord !== undefined) S.coord = draft.coord;
  }
  $('#sciBox').hidden = !F().nombreCientifico.value;
  $('#formTitle').textContent = (rec ? 'Editar ' : 'Nuevo ') + (mod === 'inv' ? 'árbol' : 'registro de poda');
  $('#formNum').textContent = `${CITIES[S.ctx.city].name} · ${rec ? (rec.cuadrilla || '') + '-' + String(rec.seq || 0).padStart(4, '0') : S.settings.cuadrilla}`;
  $('#btnDelete').hidden = !rec;
  renderSlots(); renderChips(); renderCoord(); checkDup(); dapInfo();
  S.dirty = !!draft;
  $$('.view').forEach(v => (v.hidden = v.id !== 'v-form'));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'form'));
  paintHeader(); scrollTo(0, 0);
  if (!S.coord && !rec) startGps();
  if (rec && !draft && mod === 'poda' && S.photos.antes && !S.photos.despues) setTimeout(() => $('#slot-despues').scrollIntoView({ block: 'center' }), 50);
}
function setField(k, v) { const f = F(); if (f[k]) f[k].value = v ?? ''; }
function renderChips() { $$('#form .chip').forEach(c => c.classList.toggle('on', F()[c.dataset.f].value === c.dataset.v)); }
function renderSlots() {
  for (const k of MODS[S.ctx.mod].kinds) {
    const slot = $('#slot-' + k), p = S.photos[k]; if (!slot) continue;
    slot.classList.toggle('has', !!p);
    slot.querySelector('.img').style.backgroundImage = p ? `url(${blobUrl(p.mid)})` : '';
    slot.querySelector('.state').textContent = p ? (p.saved ? '✓ Guardada' : '● Sin guardar') : 'Toque para tomar foto';
    slot.querySelector('.del').hidden = !p;
  }
}
function dapInfo() { const el = $('#dapInfo'); if (!el) return; const c = num(F().cap.value); el.textContent = c > 0 ? `DAP calculado: ${(c / Math.PI).toFixed(1)} cm` : ''; }
function markDirty() { S.dirty = true; clearTimeout(S.dt); S.dt = setTimeout(saveDraft, 500); }
async function saveDraft() {
  if (!S.dirty || $('#v-form').hidden || !S.ctx) return;
  const f = F(), fields = {}; FIELDS[S.ctx.mod].forEach(k => (fields[k] = f[k].value));
  const photos = {}; for (const k of MODS[S.ctx.mod].kinds) { const p = S.photos[k]; photos[k] = p && !p.saved ? p : null; }
  try { await DB.setMeta('draft', { ctx: S.ctx, editingId: S.editing ? S.editing.id : null, fields, photos, removeIds: S.removeIds, coord: S.coord, at: now() }); }
  catch (e) { if (e.quota) toast(e.message, 'err'); }
}
async function clearDraft() { clearTimeout(S.dt); S.dirty = false; try { await DB.delMeta('draft'); } catch (e) { } }
async function takePhoto(kind, file) {
  const slot = $('#slot-' + kind); slot.classList.add('busy'); slot.querySelector('.state').textContent = 'Procesando…';
  try {
    const ph = await processPhoto(file, kind), old = S.photos[kind];
    if (old && old.saved) S.removeIds.push(old.id);
    S.photos[kind] = ph; markDirty(); await saveDraft();
  } catch (e) { toast('No se pudo usar la foto: ' + e.message, 'err'); }
  slot.classList.remove('busy'); renderSlots();
}
async function removePhoto(kind) {
  const p = S.photos[kind]; if (!p) return;
  if (!(await confirmBox('Quitar ' + KIND_LABEL[kind], p.saved ? 'La foto se quitará al guardar el registro.' : '¿Quitar esta foto?', 'Quitar', 'danger'))) return;
  if (p.saved) S.removeIds.push(p.id); delete S.photos[kind]; markDirty(); renderSlots();
}
function checkDup() {
  const fk = S.ctx.mod === 'inv' ? 'luminaria' : 'sticker', v = F()[fk].value.trim().toUpperCase(), el = $('#dupInfo');
  if (!v) { el.hidden = true; return; }
  const mk = monthKey(S.editing ? S.editing.createdAt : now());
  const n = active().filter(r => keyOf(r) === v && (S.ctx.mod === 'inv' || monthKey(r.createdAt) === mk) && (!S.editing || r.id !== S.editing.id)).length;
  el.hidden = !n;
  el.textContent = n ? (S.ctx.mod === 'inv' ? `ℹ️ La luminaria ${v} ya tiene ${n} árbol(es) registrado(s). Se creará otro con su propio ID.` : `ℹ️ El sticker ${v} ya tiene ${n} registro(s) este mes. Si es otro árbol de la misma luminaria, continúe.`) : '';
}

/* ---------- Ubicación (GPS o manual; nunca inventa ni copia del anterior) ---------- */
function stopGps() { if (S.gps) { navigator.geolocation.clearWatch(S.gps.w); clearTimeout(S.gps.t); S.gps = null; } }
function startGps() {
  if (!('geolocation' in navigator) || !isSecureContext) { renderCoord('Ubicación no disponible en este celular. Use ✏️ Escribir o guarde y complete después.'); return; }
  stopGps(); const g = { best: null }; S.gps = g; renderCoord('📡 Buscando señal GPS… (puede seguir llenando el formulario)');
  const end = () => { stopGps(); renderCoord(); };
  g.w = navigator.geolocation.watchPosition(p => {
    if (S.gps !== g) return;
    if (!g.best || p.coords.accuracy < g.best.coords.accuracy) {
      g.best = p; S.coord = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), src: 'gps', at: new Date(p.timestamp || Date.now()).toISOString() };
      renderCoord(); if (S.dirty) markDirty();
    }
    if (p.coords.accuracy <= 8) end();
  }, e => { if (S.gps !== g) return; if (e.code === 1) { stopGps(); renderCoord('Permiso de ubicación negado. Actívelo en Chrome o use ✏️ Escribir.'); } else if (!g.best) renderCoord('Aún sin señal GPS. Espere a cielo abierto, use ✏️ Escribir o guarde y complete después.'); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
  g.t = setTimeout(end, 90000);
}
function renderCoord(msg) {
  const el = $('#locStatus'), c = S.coord; if (!el) return;
  if (c) el.innerHTML = `<span class="badge ok">${c.src === 'manual' ? 'Escrita a mano' : 'GPS'}</span> <b>${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}</b>${c.acc ? ` · precisión <b>±${c.acc} m</b>` : ''}${S.gps ? ' · mejorando…' : ''}`;
  else el.innerHTML = `<span class="badge warn">Pendiente</span> ${esc(msg || 'Sin ubicación todavía.')}`;
  const f = F(); if (f.lat && document.activeElement !== f.lat && document.activeElement !== f.lon) { f.lat.value = c ? c.lat.toFixed(7).replace(/0+$/, '') : ''; f.lon.value = c ? c.lon.toFixed(7).replace(/0+$/, '') : ''; }
}
function onCoordTyped() {
  const f = F(), lat = num(f.lat.value), lon = num(f.lon.value);
  stopGps();
  if (lat == null && lon == null) S.coord = null;
  else if (Number.isFinite(lat) && Number.isFinite(lon) && !(S.coord && Math.abs(S.coord.lat - lat) < 5e-7 && Math.abs(S.coord.lon - lon) < 5e-7)) S.coord = { lat, lon, acc: null, src: 'manual', at: now() };
  renderCoord('Escriba latitud y longitud en grados decimales.'); markDirty();
}

/* ---------- Guardar ---------- */
async function save(ev) {
  ev.preventDefault();
  const f = F(), mod = S.ctx.mod, keyF = mod === 'inv' ? 'luminaria' : 'sticker';
  const key = f[keyF].value.trim().toUpperCase();
  if (!key) { toast(mod === 'inv' ? 'Escriba el código de luminaria' : 'Escriba el número de sticker', 'err'); f[keyF].focus(); return; }
  if (mod === 'poda' && !S.photos.antes) { toast('Falta la foto ANTES', 'err'); $('#slot-antes').scrollIntoView({ block: 'center' }); return; }
  const vals = {};
  for (const [k, label] of NUMS[mod]) {
    const n = num(f[k].value);
    if (Number.isNaN(n) || (n != null && n < 0)) { toast(label + ': escriba un número válido', 'err'); f[k].focus(); return; }
    vals[k] = n;
  }
  if (vals.cortes != null) vals.cortes = Math.round(vals.cortes);
  if (vals.ramas != null) vals.ramas = Math.round(vals.ramas);
  if (vals.altura != null && vals.altura > 60 && !(await confirmBox('Revise la altura', `¿Altura de <b>${vals.altura} m</b>?`, 'Sí, es correcto'))) return;
  if (vals.cap != null && vals.cap > 1000 && !(await confirmBox('Revise el CAP', `¿CAP de <b>${vals.cap} cm</b>?`, 'Sí, es correcto'))) return;
  // coordenadas escritas a mano
  if (f.lat && !$('#locManual').hidden) {
    const lat = num(f.lat.value), lon = num(f.lon.value);
    if ((lat == null) !== (lon == null) || Number.isNaN(lat) || Number.isNaN(lon)) { toast('Escriba latitud y longitud, o deje ambas vacías', 'err'); f.lat.focus(); return; }
  }
  let coord = S.coord ? { ...S.coord } : null;
  if (coord) {
    if (Math.abs(coord.lat) > 90 || Math.abs(coord.lon) > 180) { toast('Coordenada fuera de rango (¿invirtió latitud y longitud?)', 'err'); return; }
    if (!inCO(coord.lat, coord.lon)) {
      const swap = inCO(coord.lon, coord.lat);
      const r = await ask('Revise la ubicación', `<p>${swap ? 'La latitud y la longitud parecen <b>invertidas</b>.' : 'La ubicación queda <b>fuera de Colombia</b>.'}</p><p>Latitud: <b>${coord.lat}</b><br>Longitud: <b>${coord.lon}</b></p><p class="hint">En el Huila y Caldas la latitud es cercana a 2–5 y la longitud es negativa (cerca de −75).</p>`,
        [{ label: 'Corregir', value: 'fix' }, ...(swap ? [{ label: 'Intercambiar', value: 'swap', kind: 'primary' }] : []), { label: 'Guardar así', value: 'keep' }]);
      if (r === 'swap') { coord = { ...coord, lat: coord.lon, lon: coord.lat }; S.coord = coord; renderCoord(); }
      else if (r !== 'keep') return;
    }
  }
  const btn = $('#btnSave'); btn.disabled = true; btn.textContent = 'Guardando y verificando…';
  try {
    const t = now();
    const rec = S.editing ? { ...S.editing } : { id: uuid(), mod, city: S.ctx.city, createdAt: t, cuadrilla: S.settings.cuadrilla, responsable: S.settings.responsable, deleted: false, fotos: {} };
    rec[keyF] = key;
    for (const k of FIELDS[mod]) if (!NUMS[mod].some(([n]) => n === k) && k !== keyF) rec[k] = (f[k].value || '').trim();
    Object.assign(rec, vals);
    rec.coord = coord; rec.updatedAt = t; rec.fotos = {};
    const newPhotos = [];
    for (const k of MODS[mod].kinds) {
      const p = S.photos[k];
      if (p && !p.saved) { const c = { ...p, recordId: rec.id }; delete c.saved; newPhotos.push(c); }
      rec.fotos[k] = p ? p.id : null;
    }
    if (mod === 'poda') { rec.fotoAntes = rec.fotos.antes; rec.fotoDespues = rec.fotos.despues; }
    const keep = new Set(Object.values(rec.fotos));
    const saved = norm(await DB.save(rec, newPhotos, S.removeIds.filter(id => !keep.has(id))));
    await clearDraft(); stopGps(); learn(rec); await load();
    const m = missing(saved);
    toast(`✓ ${keyLabel(mod)} ${key} guardado` + (m.length ? ` · falta: ${m.map(x => REQ_LABEL[x]).join(', ')}` : ' · completo'), m.length ? '' : 'ok');
    if (!S.persisted) { S.persisted = true; persist(true); }
    show('list');
  } catch (e) { toast(e.message || String(e), 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Guardar'; }
}
async function cancel() {
  if (S.dirty && !(await confirmBox('Cancelar', 'Se descartará lo que no ha guardado (incluidas fotos nuevas).', 'Descartar', 'danger'))) return;
  await clearDraft(); stopGps(); show('list');
}
async function del() {
  const r = S.editing; if (!r) return;
  if (!(await confirmBox('Eliminar registro', `¿Enviar a la papelera <b>${keyLabel(r.mod)} ${esc(keyOf(r))}</b>? Se puede recuperar desde Copia.`, 'Eliminar', 'danger'))) return;
  const cur = await DB.get('records', r.id); cur.deleted = true; cur.deletedAt = now(); cur.updatedAt = now();
  await DB.putRecord(cur); await clearDraft(); stopGps(); await load(); toast('Enviado a la papelera'); show('list');
}
function learn(r) {
  if (r.nombreComun && !SPECIES.some(s => s[0].toLowerCase() === r.nombreComun.toLowerCase())) SPECIES.push([r.nombreComun, r.nombreCientifico || '']);
  $('#dlComun').innerHTML = SPECIES.map(s => `<option value="${esc(s[0])}">`).join('');
  $('#dlSci').innerHTML = [...new Set(SPECIES.map(s => s[1]).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('');
}
async function newRecord() {
  if (!S.settings.cuadrilla) { await setup(); if (!S.settings.cuadrilla) return; }
  const d = await DB.meta('draft');
  if (d && d.ctx && d.ctx.mod === S.ctx.mod && d.ctx.city === S.ctx.city) {
    const target = d.editingId ? S.records.find(r => r.id === d.editingId) : null;
    const r = await ask('Registro sin terminar', `Tiene ${target ? 'la edición de <b>' + esc(keyOf(target)) + '</b>' : 'un registro nuevo'} sin guardar.`,
      [{ label: 'Descartar', value: 'x', kind: 'danger' }, { label: 'Continuar', value: 'c', kind: 'primary' }]);
    if (r === 'c') return openForm(target || null, d);
    if (r !== 'x') return;
    await clearDraft();
  }
  openForm(null);
}
async function edit(r) {
  const d = await DB.meta('draft');
  if (d && d.editingId === r.id) return openForm(r, d);
  if (d && d.ctx && d.ctx.mod === S.ctx.mod && d.ctx.city === S.ctx.city && !(await confirmBox('Borrador pendiente', 'Hay otro registro sin terminar. Si abre este, ese borrador se descarta.', 'Descartar y abrir', 'danger'))) return;
  if (d && d.ctx && d.ctx.mod === S.ctx.mod && d.ctx.city === S.ctx.city) await clearDraft();
  openForm(r);
}

/* ======================= Columnas de exportación ======================= */
const COLS = {
  inv: [
    { k: 'n', h: 'N.º', w: 6, s: 'int' }, { k: 'fecha', h: 'Fecha', w: 11, s: 'c' }, { k: 'hora', h: 'Hora', w: 7, s: 'c' },
    { k: 'municipio', h: 'Municipio', w: 11, s: 'c' }, { k: 'luminaria', h: 'Código luminaria', w: 13, s: 'c' },
    { k: 'nombreComun', h: 'Nombre común', w: 16, s: 't' }, { k: 'nombreCientifico', h: 'Nombre científico', w: 20, s: 't' },
    { k: 'estado', h: 'Estado fitosanitario', w: 12, s: 'c' }, { k: 'cap', h: 'CAP (cm)', w: 9, s: 'dec' }, { k: 'dap', h: 'DAP calculado (cm)', w: 10, s: 'dec' },
    { k: 'altura', h: 'Altura (m)', w: 9, s: 'dec' }, { k: 'copa', h: 'Diámetro copa (m)', w: 10, s: 'dec' },
    { k: 'img_foto1', h: 'FOTO 1', w: 36, s: 'c', img: 'foto1' }, { k: 'img_foto2', h: 'FOTO 2', w: 36, s: 'c', img: 'foto2' },
    { k: 'lat', h: 'Latitud', w: 11, s: 'coord' }, { k: 'lon', h: 'Longitud', w: 12, s: 'coord' }, { k: 'acc', h: 'Precisión GPS (m)', w: 10, s: 'int' },
    { k: 'origen', h: 'Origen ubicación', w: 12, s: 'c' }, { k: 'obs', h: 'Observaciones', w: 24, s: 't' },
    { k: 'estadoReg', h: 'Estado del registro', w: 18, s: 'flag' }, { k: 'responsable', h: 'Registró', w: 15, s: 't' }, { k: 'id', h: 'ID único', w: 14, s: 't' }
  ],
  poda: [
    { k: 'n', h: 'N.º', w: 6, s: 'int' }, { k: 'fecha', h: 'Fecha', w: 11, s: 'c' }, { k: 'hora', h: 'Hora', w: 7, s: 'c' },
    { k: 'municipio', h: 'Municipio', w: 11, s: 'c' }, { k: 'cuadrilla', h: 'Cuadrilla', w: 12, s: 'c' }, { k: 'sticker', h: 'Sticker', w: 11, s: 'c' },
    { k: 'nombreComun', h: 'Nombre común', w: 16, s: 't' }, { k: 'nombreCientifico', h: 'Nombre científico', w: 20, s: 't' },
    { k: 'estado', h: 'Estado', w: 10, s: 'c' }, { k: 'cap', h: 'CAP (cm)', w: 9, s: 'dec' }, { k: 'altura', h: 'Altura (m)', w: 9, s: 'dec' },
    { k: 'costado', h: 'Costado de luminaria', w: 13, s: 'c' }, { k: 'cortes', h: 'N.º de cortes', w: 9, s: 'int' }, { k: 'ramas', h: 'N.º de ramas', w: 9, s: 'int' },
    { k: 'img_antes', h: 'FOTO ANTES', w: 36, s: 'c', img: 'antes' }, { k: 'img_despues', h: 'FOTO DESPUÉS', w: 36, s: 'c', img: 'despues' },
    { k: 'lat', h: 'Latitud', w: 11, s: 'coord' }, { k: 'lon', h: 'Longitud', w: 12, s: 'coord' }, { k: 'acc', h: 'Precisión GPS (m)', w: 10, s: 'int' },
    { k: 'obs', h: 'Observaciones', w: 24, s: 't' }, { k: 'estadoReg', h: 'Estado del registro', w: 18, s: 'flag' },
    { k: 'responsable', h: 'Responsable', w: 15, s: 't' }, { k: 'id', h: 'ID único', w: 14, s: 't' }
  ]
};
function rowValues(r, i) {
  const m = missing(r), c = hasCoord(r) ? r.coord : null;
  return {
    n: i + 1, fecha: fmtDate(r.createdAt), hora: fmtTime(r.createdAt), municipio: CITIES[r.city].name, cuadrilla: r.cuadrilla,
    luminaria: r.luminaria, sticker: r.sticker, nombreComun: r.nombreComun, nombreCientifico: r.nombreCientifico, estado: r.estado,
    cap: r.cap, dap: r.cap > 0 ? Math.round(r.cap / Math.PI * 10) / 10 : null, altura: r.altura, copa: r.copa, costado: r.costado, cortes: r.cortes, ramas: r.ramas,
    lat: c ? c.lat : null, lon: c ? c.lon : null, acc: c ? c.acc : null, origen: c ? (c.src === 'manual' ? 'Escrita a mano' : 'GPS') : 'Pendiente',
    obs: r.obs, estadoReg: m.length ? 'Pendiente: ' + m.map(z => REQ_LABEL[z]).join(', ') : 'Completo', responsable: r.responsable, id: r.id
  };
}

/* ======================= Excel con fotos incrustadas ======================= */
const ROW_PT = 172, EMU = 9525, colPx = w => Math.floor(w * 7 + 5);
function xe(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cn(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
async function buildExcel(recs, title, mod, periodo) {
  const COL = COLS[mod], brand = 'FF' + brandColor().replace('#', '').toUpperCase();
  const ST = { title: 1, head: 2, t: 3, c: 4, dec: 5, int: 6, coord: 7, pend: 8, ok: 9, label: 10, val: 11 };
  const media = [], anchors = [], last = cn(COL.length - 1);
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  x += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  x += '<cols>' + COL.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  x += `<row r="1" ht="30" customHeight="1"><c r="A1" t="inlineStr" s="${ST.title}"><is><t>${xe(title)}</t></is></c></row>`;
  x += '<row r="2" ht="36" customHeight="1">' + COL.map((c, i) => `<c r="${cn(i)}2" t="inlineStr" s="${ST.head}"><is><t>${xe(c.h)}</t></is></c>`).join('') + '</row>';
  recs.forEach(({ r, photos }, i) => {
    const R = i + 3, m = missing(r), v = rowValues(r, i);
    x += `<row r="${R}" ht="${ROW_PT}" customHeight="1">`;
    COL.forEach((c, ci) => {
      const ref = cn(ci) + R;
      if (c.img) {
        const p = photos[c.img];
        if (p) { media.push(p.mid); anchors.push({ col: ci, row: R - 1, w: p.mw, h: p.mh, n: media.length, name: `${KIND_LABEL[c.img]} ${keyOf(r)}`, cw: c.w }); x += `<c r="${ref}" s="${ST.c}"/>`; }
        else x += `<c r="${ref}" t="inlineStr" s="${ST.pend}"><is><t>Sin foto</t></is></c>`;
        return;
      }
      const val = v[c.k], style = c.s === 'flag' ? (m.length ? ST.pend : ST.ok) : ST[c.s];
      if (val === null || val === undefined || val === '') { x += `<c r="${ref}" s="${style}"/>`; return; }
      if (['dec', 'int', 'coord'].includes(c.s) && Number.isFinite(Number(val))) x += `<c r="${ref}" s="${style}"><v>${Number(val)}</v></c>`;
      else x += `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xe(val)}</t></is></c>`;
    });
    x += '</row>';
  });
  x += '</sheetData>' + `<autoFilter ref="A2:${last}${Math.max(2, recs.length + 2)}"/><mergeCells count="1"><mergeCell ref="A1:${last}1"/></mergeCells>`;
  x += '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  if (anchors.length) x += '<drawing r:id="rId1"/>';
  x += '</worksheet>';

  const rowPx = Math.round(ROW_PT * 96 / 72);
  let dr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  anchors.forEach((a, i) => {
    const boxW = colPx(a.cw) - 10, boxH = rowPx - 10, k = Math.min(boxW / a.w, boxH / a.h), w = Math.round(a.w * k), h = Math.round(a.h * k);
    const ox = Math.round((colPx(a.cw) - w) / 2), oy = Math.round((rowPx - h) / 2);
    dr += `<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${ox * EMU}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${oy * EMU}</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${a.col}</xdr:col><xdr:colOff>${(ox + w) * EMU}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${(oy + h) * EMU}</xdr:rowOff></xdr:to>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Foto ${i + 1}" descr="${xe(a.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="rId${a.n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  });
  dr += '</xdr:wsDr>';

  // Resumen
  const tot = recs.length, comp = recs.filter(z => !missing(z.r).length).length, est = {}, cuad = {};
  recs.forEach(z => { const e = z.r.estado || 'Sin dato'; est[e] = (est[e] || 0) + 1; const c = z.r.cuadrilla || 'Sin dato'; cuad[c] = cuad[c] || { n: 0, c: 0 }; cuad[c].n++; cuad[c].c += z.r.cortes || 0; });
  const conUb = recs.filter(z => hasCoord(z.r)).length;
  const rows = [['Municipio', CITIES[S.ctx.city].name], ['Módulo', MODS[mod].label], ['Periodo', periodo], ['Generado', `${fmtDate(now())} ${fmtTime(now())}`], ['', ''],
    [mod === 'poda' ? 'Árboles intervenidos' : 'Árboles inventariados', tot]];
  if (mod === 'poda') rows.push(['Total de cortes', recs.reduce((s, z) => s + (z.r.cortes || 0), 0)], ['Total de ramas', recs.reduce((s, z) => s + (z.r.ramas || 0), 0)]);
  rows.push(['Registros completos', comp], ['Registros pendientes', tot - comp], ['Con ubicación', conUb], ['', ''], ['Por estado', 'Árboles'], ...Object.entries(est).map(([k, n]) => [k, n]));
  if (mod === 'poda') rows.push(['', ''], ['Por cuadrilla', 'Árboles · cortes'], ...Object.entries(cuad).map(([k, o]) => [k, `${o.n} · ${o.c}`]));
  let s2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="26" customWidth="1"/></cols><sheetData>';
  s2 += `<row r="1" ht="26" customHeight="1"><c r="A1" t="inlineStr" s="${ST.title}"><is><t>${xe('Resumen · ' + title)}</t></is></c></row>`;
  rows.forEach((rw, i) => {
    const R = i + 3, bold = ['Por estado', 'Por cuadrilla'].includes(rw[0]);
    s2 += `<row r="${R}">` + rw.map((val, ci) => {
      const ref = cn(ci) + R, st = bold ? ST.head : ci ? ST.val : ST.label;
      if (val === '') return '';
      return typeof val === 'number' ? `<c r="${ref}" s="${st}"><v>${val}</v></c>` : `<c r="${ref}" t="inlineStr" s="${st}"><is><t>${xe(val)}</t></is></c>`;
    }).join('') + '</row>';
  });
  s2 += '</sheetData></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.000000"/><numFmt numFmtId="165" formatCode="0.0#"/></numFmts>' +
    `<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="${brand}"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${brand}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F2E4"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9C9C9"/></left><right style="thin"><color rgb="FFC9C9C9"/></right><top style="thin"><color rgb="FFC9C9C9"/></top><bottom style="thin"><color rgb="FFC9C9C9"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const sheetName = mod === 'inv' ? 'Inventario' : 'Podas';
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      (anchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/><sheet name="Resumen" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${sheetName}!$A$2:$${last}$${Math.max(2, recs.length + 2)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">${sheetName}!$2:$2</definedName></definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles }, { name: 'xl/worksheets/sheet1.xml', data: x }, { name: 'xl/worksheets/sheet2.xml', data: s2 }
  ];
  if (anchors.length) {
    files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' });
    files.push({ name: 'xl/drawings/drawing1.xml', data: dr });
    files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + media.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpeg"/>`).join('') + '</Relationships>' });
    media.forEach((m, i) => files.push({ name: `xl/media/image${i + 1}.jpeg`, data: new Uint8Array(m) }));
  }
  return { blob: await Zip.build(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), fotos: media.length };
}

/* ======================= KMZ con fotos ======================= */
async function markerPng(color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.lineWidth = 7; g.strokeStyle = '#fff'; g.stroke();
  const b = await new Promise(r => cv.toBlob(r, 'image/png')); return b ? new Uint8Array(await b.arrayBuffer()) : null;
}
const hx = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function buildKmz(recs, title, mod) {
  const files = [], icon = await markerPng(brandColor()), withC = recs.filter(z => hasCoord(z.r));
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${hx(title)}</name>` +
    `<description>${hx('Generado sin conexión. Coordenadas WGS84 (EPSG:4326). Precisión según GPS del celular; no es levantamiento topográfico.')}</description>` +
    `<Style id="p"><IconStyle><scale>0.9</scale><Icon><href>files/marcador.png</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><LabelStyle><color>ffffffff</color><scale>0.85</scale></LabelStyle></Style>` +
    `<Folder><name>${hx(MODS[mod].label)} · ${withC.length} puntos</name>`;
  let nimg = 0;
  withC.forEach(({ r, photos }, i) => {
    const v = rowValues(r, i), cols = COLS[mod].filter(c => !c.img && !['n', 'lat', 'lon', 'id'].includes(c.k));
    const table = cols.filter(c => v[c.k] !== null && v[c.k] !== undefined && v[c.k] !== '').map(c => `<tr><td style="color:#555;padding:2px 8px 2px 0"><b>${hx(c.h)}</b></td><td>${hx(v[c.k])}</td></tr>`).join('');
    let imgs = '';
    for (const k of MODS[mod].kinds) {
      const p = photos[k]; if (!p) continue;
      const fn = `files/${safe(keyOf(r))}_${k}_${p.id.slice(0, 8)}.jpg`; files.push({ name: fn, data: new Uint8Array(p.mid) }); nimg++;
      imgs += `<p><b>${KIND_LABEL[k]}</b><br><img src="${fn}" width="320"/></p>`;
    }
    const name = mod === 'inv' ? `LUM ${keyOf(r)}` : `${keyOf(r)}`;
    const ext = cols.filter(c => v[c.k] !== null && v[c.k] !== undefined && v[c.k] !== '').map(c => `<Data name="${hx(c.h)}"><value>${hx(v[c.k])}</value></Data>`).join('');
    kml += `<Placemark><name>${hx(name)}</name><styleUrl>#p</styleUrl><description><![CDATA[<table style="font-family:Arial;font-size:12px">${table}</table>${imgs}]]></description><ExtendedData>${ext}</ExtendedData>` +
      `<Point><coordinates>${r.coord.lon},${r.coord.lat},0</coordinates></Point></Placemark>`;
  });
  kml += '</Folder></Document></kml>';
  files.unshift({ name: 'doc.kml', data: kml });
  if (icon) files.push({ name: 'files/marcador.png', data: icon });
  return { blob: await Zip.build(files, 'application/vnd.google-earth.kmz'), puntos: withC.length, sin: recs.length - withC.length, fotos: nimg };
}

/* ======================= Exportar ======================= */
function selection() {
  const mk = $('#expMes').value, cq = $('#expCuad').value;
  return active().filter(r => (mk === 'all' || monthKey(r.createdAt) === mk) && (cq === 'all' || r.cuadrilla === cq)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}
function renderExport() {
  const all = active(), months = [...new Set(all.map(r => monthKey(r.createdAt)))].sort().reverse(), cur = monthKey(now());
  const ms = $('#expMes'), prevM = ms.value, isInv = S.ctx.mod === 'inv';
  if (!months.includes(cur)) months.unshift(cur);
  ms.innerHTML = (isInv ? '<option value="all">Todos los meses</option>' : '') + months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('') + (isInv ? '' : '<option value="all">Todos los meses</option>');
  ms.value = prevM && [...ms.options].some(o => o.value === prevM) ? prevM : (isInv ? 'all' : cur);
  const cs = $('#expCuad'), prevC = cs.value, cuads = [...new Set(all.map(r => r.cuadrilla).filter(Boolean))].sort();
  cs.innerHTML = '<option value="all">Todas</option>' + cuads.map(c => `<option>${esc(c)}</option>`).join('');
  cs.value = prevC && [...cs.options].some(o => o.value === prevC) ? prevC : 'all';
  $('#cuadSel').hidden = !ADMIN && cuads.length < 2;
  $('#expTitle').textContent = `Exportar · ${MODS[S.ctx.mod].short} ${CITIES[S.ctx.city].name}`;
  renderExportInfo();
}
function renderExportInfo() {
  const sel = selection(), pend = sel.filter(r => missing(r).length), sinUb = sel.filter(r => !hasCoord(r)).length;
  const fotos = sel.reduce((s, r) => s + Object.values(r.fotos || {}).filter(Boolean).length, 0);
  $('#expInfo').innerHTML = `<b>${sel.length}</b> árboles · <b>${fotos}</b> fotos` + (S.ctx.mod === 'poda' ? ` · <b>${sel.reduce((s, r) => s + (r.cortes || 0), 0)}</b> cortes · <b>${sel.reduce((s, r) => s + (r.ramas || 0), 0)}</b> ramas` : '') +
    (pend.length ? `<br><span class="warntxt">⚠️ ${pend.length} pendiente(s): salen en amarillo en el Excel.</span>` : '<br>✓ Todos completos.') +
    (sinUb ? `<br><span class="warntxt">📍 ${sinUb} sin ubicación: no aparecen en el KMZ.</span>` : '');
}
async function gather(sel) { const out = []; for (const r of sel) { const photos = {}; for (const p of await DB.photosOf(r.id)) photos[p.kind] = p; out.push({ r, photos }); } return out; }
function periodName() {
  const mk = $('#expMes').value, cq = $('#expCuad').value;
  return { label: (mk === 'all' ? 'Todos los meses' : monthLabel(mk)) + (cq === 'all' ? '' : ' · ' + cq), file: (mk === 'all' ? 'todos' : mk) + (cq === 'all' ? '' : '_' + safe(cq)) };
}
async function doExport(kind) {
  const sel = selection(); if (!sel.length) { toast('No hay registros en esa selección', 'err'); return; }
  const btns = $$('[data-exp]'); btns.forEach(b => (b.disabled = true)); const st = $('#expStatus'); st.textContent = 'Generando…';
  const mod = S.ctx.mod, city = CITIES[S.ctx.city].name, p = periodName(), base = `${mod === 'inv' ? 'Inventario' : 'Podas'}_${safe(city)}_${p.file}_${stamp()}`;
  const title = `${mod === 'inv' ? 'INVENTARIO FORESTAL' : 'PODAS'} ${city.toUpperCase()} · ${p.label}`;
  try {
    const recs = await gather(sel); let blob, name, note = '';
    if (kind === 'xlsx') { const r = await buildExcel(recs, title, mod, p.label); blob = r.blob; name = base + '.xlsx'; note = `${sel.length} árboles · ${r.fotos} fotos`; }
    if (kind === 'kmz') {
      const r = await buildKmz(recs, title, mod); if (!r.puntos) { toast('Ningún registro de la selección tiene ubicación', 'err'); return; }
      blob = r.blob; name = base + '.kmz'; note = `${r.puntos} puntos · ${r.fotos} fotos` + (r.sin ? ` · ${r.sin} sin ubicación no incluidos` : '');
    }
    if (kind === 'zip') {
      const files = [], used = new Set(), lines = ['Archivo;' + keyLabel(mod) + ';Tipo;Fecha;Municipio;Cuadrilla;ID registro'];
      for (const { r, photos } of recs) for (const k of MODS[mod].kinds) {
        const ph = photos[k]; if (!ph) continue;
        const b0 = `${mod === 'inv' ? 'LUM-' : ''}${safe(keyOf(r))}_${KIND_LABEL[k].replace(/\s/g, '').replace('É', 'E')}`; let n = b0, i = 2; while (used.has(n)) n = `${b0}_${i++}`; used.add(n);
        files.push({ name: `fotos/${n}.jpg`, data: new Uint8Array(ph.full) });
        lines.push(`${n}.jpg;${keyOf(r)};${KIND_LABEL[k]};${fmtDate(r.createdAt)};${city};${r.cuadrilla || ''};${r.id}`);
      }
      files.push({ name: 'relacion_fotos.csv', data: '﻿' + lines.join('\r\n') });
      blob = await Zip.build(files); name = `Fotos_${base}.zip`; note = `${files.length - 1} fotos`;
    }
    download(blob, name); offerShare(blob, name);
    $('#exportLog').insertAdjacentHTML('afterbegin', `<div>✓ ${esc(name)} · ${esc(note)} · ${bytes(blob.size)}</div>`);
    toast('Archivo generado. Los registros siguen guardados.', 'ok');
  } catch (e) { toast('Error al generar: ' + e.message + '. Sus datos no cambiaron.', 'err'); }
  finally { btns.forEach(b => (b.disabled = false)); st.textContent = ''; }
}

/* ======================= Copia / unir / datos anteriores ======================= */
async function renderBackup() {
  const lb = await DB.meta('lastBackup');
  $('#lastBackup').innerHTML = lb ? `Última copia: <b>${fmtDate(lb)} ${fmtTime(lb)}</b>` : '<span class="warntxt">Aún no ha hecho copia de seguridad.</span>';
  $('#setCuad').value = S.settings.cuadrilla; $('#setResp').value = S.settings.responsable || '';
  const del = S.records.filter(r => r.deleted && inCtx(r));
  $('#trash').innerHTML = del.length ? del.map(r => `<li class="trow"><span>${keyLabel(r.mod)} <b>${esc(keyOf(r))}</b> · ${fmtDate(r.createdAt)}</span><span><button class="btn small" data-restore="${r.id}">Recuperar</button> <button class="btn small danger" data-purge="${r.id}">Borrar</button></span></li>`).join('') : '<li class="hint">Papelera vacía.</li>';
  $('#version').textContent = `${document.title} · versión ${APP_VERSION} · los datos se guardan solo en este celular`;
  storage(); ready();
}
async function backup() {
  const b = $('#btnBackup'), label = b.textContent; b.disabled = true; b.textContent = 'Generando copia…';
  try {
    let recs = await DB.all('records'), photos = await DB.all('photos');
    const files = [], pm = photos.map(p => {
      files.push({ name: `fotos/${p.id}_full.jpg`, data: new Uint8Array(p.full) }, { name: `fotos/${p.id}_mid.jpg`, data: new Uint8Array(p.mid) });
      const { full, mid, ...rest } = p; return { ...rest, fullSize: full.byteLength, midSize: mid.byteLength };
    });
    files.unshift({ name: 'respaldo.json', data: JSON.stringify({ format: ADMIN ? 'forestal-respaldo' : 'podas-respaldo', version: 2, ciudad: CFG.city || null, cuadrilla: S.settings.cuadrilla, createdAt: now(), records: recs, photos: pm }) });
    const blob = await Zip.build(files), chk = await parseBackup(blob);
    if (chk.data.records.length !== recs.length || chk.photos.length !== photos.length) throw new Error('La copia no pasó la verificación');
    const name = ADMIN ? `Respaldo_Forestal_${stamp()}.zip` : `Copia_Podas_${safe(CITIES[CFG.city].name)}_${safe(S.settings.cuadrilla)}_${stamp()}.zip`;
    download(blob, name); offerShare(blob, name, '#backupLog');
    await DB.setMeta('lastBackup', now());
    toast(`✓ Copia verificada: ${recs.length} registros, ${photos.length} fotos (${bytes(blob.size)})`, 'ok'); renderBackup();
  } catch (e) { toast('No se pudo crear la copia: ' + e.message, 'err'); }
  finally { b.disabled = false; b.textContent = label; }
}
async function parseBackup(file) {
  const ent = await Zip.read(file), j = ent.get('respaldo.json');
  if (!j) throw new Error('Este archivo no es una copia de estas apps.');
  const data = JSON.parse(Zip.text(j));
  if (!['podas-respaldo', 'forestal-respaldo'].includes(data.format)) throw new Error('Formato no reconocido.');
  const photos = [], bad = [];
  for (const p of data.photos) {
    const f = ent.get(`fotos/${p.id}_full.jpg`), m = ent.get(`fotos/${p.id}_mid.jpg`);
    if (!f || !m || f.byteLength !== p.fullSize || m.byteLength !== p.midSize) { bad.push(p.id); continue; }
    const { fullSize, midSize, ...rest } = p; photos.push({ ...rest, full: f.slice().buffer, mid: m.slice().buffer });
  }
  data.records = data.records.map(r => norm({ ...r }, data.ciudad));
  return { data, photos, bad };
}
async function restore(files) {
  const tot = { added: 0, updated: 0, same: 0, padd: 0 }, names = [];
  for (const file of files) {
    try {
      const { data, photos, bad } = await parseBackup(file);
      let recs = data.records;
      if (!ADMIN) {
        if (data.format !== 'podas-respaldo' || data.ciudad !== CFG.city) { toast(`«${file.name}» no es una copia de Podas ${CITIES[CFG.city].name}.`, 'err'); continue; }
      }
      const desc = data.format === 'podas-respaldo' ? `Cuadrilla <b>${esc(data.cuadrilla || '—')}</b> · Podas ${esc(CITIES[data.ciudad] ? CITIES[data.ciudad].name : data.ciudad)}` : 'Copia completa de la app Forestal';
      const ok = await confirmBox('Unir copia', `<b>${esc(file.name)}</b><br>${desc}<br>${recs.length} registros · ${photos.length} fotos${bad.length ? `<br>⚠️ ${bad.length} foto(s) dañadas no se unirán` : ''}<br><br>No se borra nada de este celular.`, 'Unir');
      if (!ok) continue;
      const ids = new Set(recs.map(r => r.id));
      const r = await DB.merge(recs, photos.filter(p => ids.has(p.recordId)));
      for (const k in tot) tot[k] += r[k]; names.push(data.cuadrilla || file.name);
    } catch (e) { toast(`No se pudo leer «${file.name}»: ${e.message}`, 'err'); }
  }
  if (!names.length) return;
  await load();
  await ask('Copias unidas', `De: <b>${esc(names.join(', '))}</b><br>Registros nuevos: <b>${tot.added}</b><br>Actualizados: <b>${tot.updated}</b><br>Ya estaban: <b>${tot.same}</b><br>Fotos agregadas: <b>${tot.padd}</b>`, [{ label: 'Aceptar', value: 'ok', kind: 'primary' }]);
  if (S.ctx) renderBackup(); else renderHome();
}

/* Traer datos de versiones anteriores guardados en este mismo celular (solo app Forestal) */
function rawOpen(name) { return new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => { r.transaction.abort(); rej(new Error('no existe')); }; }); }
function rawAll(db, store) { return new Promise((res, rej) => { if (!db.objectStoreNames.contains(store)) return res([]); const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function importLegacy() {
  let names = [];
  try { names = (await indexedDB.databases()).map(d => d.name); } catch (e) { names = ['bitacora-forestal-campo', 'podas-neiva', 'podas-pitalito', 'podas-ladorada']; }
  const found = [];
  for (const n of ['bitacora-forestal-campo', 'podas-neiva', 'podas-pitalito', 'podas-ladorada']) {
    if (!names.includes(n)) continue;
    try { const db = await rawOpen(n); const recs = (await rawAll(db, 'records')).filter(r => !r.deleted); if (recs.length) found.push({ n, db, recs }); else db.close(); } catch (e) { }
  }
  if (!found.length) { await ask('Datos anteriores', 'No se encontraron registros de versiones anteriores en este celular.', [{ label: 'Aceptar', value: 'ok', kind: 'primary' }]); return; }
  const tot = { added: 0, same: 0, padd: 0, updated: 0 };
  for (const { n, db, recs } of found) {
    if (n === 'bitacora-forestal-campo') {
      const city = await ask('Bitácora anterior', `Hay <b>${recs.length}</b> árbol(es) de la Bitácora anterior. ¿De qué municipio son?`, [{ label: 'Omitir', value: '' }, { label: 'Pitalito', value: 'pitalito' }, { label: 'Neiva', value: 'neiva', kind: 'primary' }]);
      if (!city) { db.close(); continue; }
      const oldPh = await rawAll(db, 'photos'), photos = [], out = [];
      for (const r of recs) {
        const mine = oldPh.filter(p => p.recordId === r.id).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).slice(0, 2), fotos = {};
        for (let i = 0; i < mine.length; i++) {
          try {
            const p = await processPhoto(new Blob([mine[i].data], { type: mine[i].type || 'image/jpeg' }), 'foto' + (i + 1));
            p.id = mine[i].id; p.recordId = r.id; p.takenAt = mine[i].createdAt || p.takenAt; photos.push(p); fotos[p.kind] = p.id;
          } catch (e) { }
        }
        const c = r.coord && r.coord.status !== 'pendiente' && Number.isFinite(r.coord.lat) ? { lat: r.coord.lat, lon: r.coord.lon, acc: r.coord.accuracy ? Math.round(r.coord.accuracy) : null, src: r.coord.source === 'manual' ? 'manual' : 'gps', at: r.coord.capturedAt } : null;
        out.push({ id: r.id, mod: 'inv', city, createdAt: r.createdAt, updatedAt: r.updatedAt, cuadrilla: S.settings.cuadrilla, responsable: r.responsable || S.settings.responsable, deleted: false,
          luminaria: String(r.luminaria || '').toUpperCase(), nombreComun: r.especieComun || '', nombreCientifico: r.especieCientifica || '', estado: r.estado || '',
          cap: r.cap ?? null, altura: r.altura ?? null, copa: r.diametroCopa ?? null, obs: [r.arbolId ? 'ID árbol: ' + r.arbolId : '', r.observaciones || ''].filter(Boolean).join(' · '), coord: c, fotos });
      }
      const x = await DB.merge(out, photos); for (const k in tot) tot[k] += x[k];
    } else {
      const city = n.replace('podas-', ''), ph = await rawAll(db, 'photos');
      const x = await DB.merge(recs.map(r => norm({ ...r }, city)), ph); for (const k in tot) tot[k] += x[k];
    }
    db.close();
  }
  await load();
  await ask('Datos anteriores', `Registros traídos: <b>${tot.added}</b><br>Ya estaban: <b>${tot.same}</b><br>Fotos: <b>${tot.padd}</b>`, [{ label: 'Aceptar', value: 'ok', kind: 'primary' }]);
  if (S.ctx) renderBackup(); else renderHome();
}

async function setup() {
  const r = await ask(ADMIN ? 'Sus datos' : 'Datos de la cuadrilla', `<p class="hint">Se guardan en este celular y salen en cada registro y en el Excel.</p>
    <label>${ADMIN ? 'Nombre corto o equipo *' : 'Nombre de la cuadrilla *'}<input id="suCuad" value="${esc(S.settings.cuadrilla)}" placeholder="${ADMIN ? 'ej. Ing. Forestal' : 'ej. Cuadrilla 1'}" maxlength="20"></label>
    <label>Responsable<input id="suResp" value="${esc(S.settings.responsable || '')}" placeholder="Nombre de quien registra"></label>`, [{ label: 'Guardar', value: 'ok', kind: 'primary' }]);
  if (r !== 'ok') return;
  const c = ($('#suCuad').value || '').trim(); if (!c) { toast('Escriba el nombre', 'err'); return setup(); }
  S.settings = { cuadrilla: c, responsable: ($('#suResp').value || '').trim() }; await DB.setMeta('settings', S.settings); paintHeader();
}

/* ======================= Inicio ======================= */
async function init() {
  net(); addEventListener('online', net); addEventListener('offline', net);
  try { await DB.open(); } catch (e) { document.body.innerHTML = `<p style="padding:20px">No se pudo abrir el almacenamiento: ${esc(e.message)}. No use modo incógnito.</p>`; return; }
  S.settings = { ...S.settings, ...(await DB.meta('settings', {})) };
  await load(); learn({}); S.records.forEach(learn);
  $('#importLegacyBox').hidden = !ADMIN;
  if (ADMIN) { try { const c = JSON.parse(localStorage.getItem('ctx') || 'null'); if (c && MODS[c.mod] && MODS[c.mod].cities.includes(c.city)) S.ctx = c; } catch (e) { } }

  $$('.tabs button').forEach(b => b.onclick = () => b.dataset.view === 'form' ? ($('#v-form').hidden ? newRecord() : null) : show(b.dataset.view));
  $('#homeBtn').onclick = async () => { if (!$('#v-form').hidden && S.dirty && !(await confirmBox('Registro sin guardar', 'Queda como borrador.', 'Salir'))) return; stopGps(); S.ctx = null; try { localStorage.removeItem('ctx'); } catch (e) { } show('home'); };
  $('#homeBox').onclick = e => { const b = e.target.closest('.hcard'); if (b) setCtx(b.dataset.mod, b.dataset.city); };
  $('#homeRestore').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) restore(fs); };
  $('#homeLegacy').onclick = importLegacy;
  $('#list').onclick = e => { const li = e.target.closest('.item'); if (li) { const r = S.records.find(x => x.id === li.dataset.id); if (r) edit(r); } };
  $('#q').oninput = e => { S.q = e.target.value; renderList(); };
  $('#filters').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; S.filter = c.dataset.f; $$('#filters .chip').forEach(x => x.classList.toggle('on', x === c)); renderList(); };
  $('#cuadPill').onclick = setup;

  const form = $('#form');
  form.addEventListener('submit', save);
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, k = b.dataset.k, f = F();
    if (a === 'cam') $(`#slot-${k} input.cam`).click();
    if (a === 'gal') $(`#slot-${k} input.gal`).click();
    if (a === 'delphoto') removePhoto(k);
    if (a === 'chip') { f[b.dataset.f].value = f[b.dataset.f].value === b.dataset.v ? '' : b.dataset.v; renderChips(); markDirty(); }
    if (a === 'sci') { $('#sciBox').hidden = false; f.nombreCientifico.focus(); }
    if (a === 'minus') { const el = f[b.dataset.f]; const n = num(el.value) || 0; el.value = Math.max(0, n - 1); markDirty(); }
    if (a === 'plus') { const el = f[b.dataset.f]; const n = num(el.value); el.value = (Number.isFinite(n) ? n : 0) + 1; markDirty(); }
    if (a === 'gps') startGps();
    if (a === 'manual') { $('#locManual').hidden = false; f.lat.focus(); }
    if (a === 'clearcoord') { confirmBox('Borrar ubicación', 'La ubicación de este registro quedará pendiente.', 'Borrar', 'danger').then(y => { if (y) { stopGps(); S.coord = null; renderCoord(); markDirty(); } }); }
  });
  form.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'file') { const file = t.files[0]; t.value = ''; if (file) takePhoto(t.dataset.k, file); return; }
    markDirty();
  });
  form.addEventListener('input', e => {
    const n = e.target.name, f = F();
    if (n === 'lat' || n === 'lon') return onCoordTyped();
    if (n === 'sticker' || n === 'luminaria') checkDup();
    if (n === 'cap') dapInfo();
    if (n === 'nombreComun') {
      const sp = SPECIES.find(s => s[0].toLowerCase() === f.nombreComun.value.trim().toLowerCase());
      if (sp && sp[1] && (!f.nombreCientifico.value || f.nombreCientifico.dataset.auto === '1')) { f.nombreCientifico.value = sp[1]; f.nombreCientifico.dataset.auto = '1'; }
    }
    if (n === 'nombreCientifico') f.nombreCientifico.dataset.auto = '';
    markDirty();
  });
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'DIV') e.target.click(); });
  $('#btnCancel').onclick = cancel; $('#btnDelete').onclick = del;

  $('#expMes').onchange = renderExportInfo; $('#expCuad').onchange = renderExportInfo;
  $$('[data-exp]').forEach(b => b.onclick = () => doExport(b.dataset.exp));
  $('#btnBackup').onclick = backup;
  $('#restoreIn').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) restore(fs); };
  $('#btnLegacy').onclick = importLegacy;
  $('#btnPersist').onclick = () => persist(false);
  $('#btnSaveSet').onclick = async () => {
    const c = $('#setCuad').value.trim(); if (!c) { toast('El nombre no puede quedar vacío', 'err'); return; }
    S.settings = { cuadrilla: c, responsable: $('#setResp').value.trim() }; await DB.setMeta('settings', S.settings); paintHeader(); toast('Guardado ✓', 'ok');
  };
  $('#trash').onclick = async e => {
    const rid = e.target.dataset.restore, pid = e.target.dataset.purge;
    if (rid) { const r = await DB.get('records', rid); r.deleted = false; r.updatedAt = now(); await DB.putRecord(r); await load(); renderBackup(); toast('Recuperado ✓', 'ok'); }
    if (pid) {
      const r = S.records.find(x => x.id === pid);
      if (!(await confirmBox('Borrar definitivamente', `<b>${keyLabel(r.mod)} ${esc(keyOf(r))}</b> y sus fotos se borrarán para siempre de este celular.`, 'Borrar para siempre', 'danger'))) return;
      await DB.purge(pid); await load(); renderBackup(); toast('Borrado');
    }
  };
  addEventListener('pagehide', () => S.dirty && saveDraft());
  document.addEventListener('visibilitychange', () => document.hidden && saveDraft());

  show(S.ctx ? 'list' : 'home'); setupSW(); storage();
  if (!S.settings.cuadrilla) setTimeout(setup, 300);
  else if (await DB.meta('draft')) toast('Tiene un registro sin terminar. Toque «Nuevo» para continuarlo.');
}

/* Retira los programas viejos que vivían en la raíz del sitio (no toca registros guardados) */
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => {
  const p = new URL(r.scope).pathname;
  if (p === '/' || p.startsWith('/podas-')) r.unregister();
})).catch(() => {});
if (window.caches) caches.keys().then(ks => ks.forEach(k => { if (k.startsWith('bitacora-campo-') || k.startsWith('podas-v')) caches.delete(k); })).catch(() => {});
init();
