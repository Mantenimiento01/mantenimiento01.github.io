/* Podas mensual — app de campo offline para cuadrillas (Neiva · Pitalito · La Dorada)
   Todo se guarda en el celular (IndexedDB). Excel con fotos incrustadas generado localmente. */
'use strict';
const CFG = window.PODAS;                     // {slug, ciudad, color}
const APP_VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ======================= ZIP (modo store, sin librerías) ======================= */
const Zip = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function u8(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (typeof d === 'string') return enc.encode(d);
    if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
    throw new Error('Dato no soportado');
  }
  function dos(d) { const y = Math.max(1980, d.getFullYear()); return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  async function build(files, mime = 'application/zip') {
    const parts = [], cen = []; let off = 0; const now = dos(new Date());
    for (const f of files) {
      const data = await u8(f.data), name = enc.encode(f.name), crc = crc32(data);
      const L = new DataView(new ArrayBuffer(30));
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true); L.setUint16(8, 0, true);
      L.setUint16(10, now.t, true); L.setUint16(12, now.d, true); L.setUint32(14, crc, true);
      L.setUint32(18, data.length, true); L.setUint32(22, data.length, true); L.setUint16(26, name.length, true);
      parts.push(new Uint8Array(L.buffer), name, data);
      const C = new DataView(new ArrayBuffer(46));
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x0800, true);
      C.setUint16(12, now.t, true); C.setUint16(14, now.d, true); C.setUint32(16, crc, true);
      C.setUint32(20, data.length, true); C.setUint32(24, data.length, true); C.setUint16(28, name.length, true); C.setUint32(42, off, true);
      cen.push(new Uint8Array(C.buffer), name);
      off += 30 + name.length + data.length;
    }
    if (files.length > 65535 || off > 0xFFFFFFFF) throw new Error('El archivo es demasiado grande. Exporte por mes o por cuadrilla.');
    const size = cen.reduce((s, a) => s + a.length, 0);
    const E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true); E.setUint16(8, files.length, true); E.setUint16(10, files.length, true);
    E.setUint32(12, size, true); E.setUint32(16, off, true);
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
      const st = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      const raw = b.subarray(st, st + cs); let data;
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
const DB = (() => {
  let p = null;
  const friendly = e => {
    if (e && e.name === 'QuotaExceededError') { const x = new Error('El almacenamiento del celular está lleno. No se guardó. Exporte, haga copia y libere espacio.'); x.quota = true; return x; }
    return e instanceof Error ? e : new Error(String(e || 'Error de almacenamiento'));
  };
  function open() {
    return p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('podas-' + CFG.slug, 1);
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

  /** Guarda registro + fotos nuevas en una transacción y luego verifica leyendo de nuevo. */
  async function save(rec, newPhotos, removeIds) {
    const db = await open();
    const t = db.transaction(['records', 'photos', 'meta'], 'readwrite'); const d = done(t);
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
      if (!b || !b.full || b.full.byteLength !== ph.full.byteLength || !b.mid || b.mid.byteLength !== ph.mid.byteLength) throw new Error('La foto ' + ph.kind.toUpperCase() + ' no quedó guardada. Toque Guardar de nuevo.');
    }
    return back;
  }
  async function putRecord(rec) { const t = (await open()).transaction('records', 'readwrite'); t.objectStore('records').put(rec); await done(t); }
  async function purge(id) {
    const ph = await photosOf(id); const t = (await open()).transaction(['records', 'photos'], 'readwrite');
    t.objectStore('records').delete(id); ph.forEach(x => t.objectStore('photos').delete(x.id)); return done(t);
  }
  async function merge(records, photos) {
    const cur = new Map((await all('records')).map(r => [r.id, r])); const have = new Set(await keys('photos'));
    const t = (await open()).transaction(['records', 'photos'], 'readwrite'); const d = done(t);
    let added = 0, updated = 0, same = 0, padd = 0;
    for (const r of records) {
      const c = cur.get(r.id); const copy = { ...r }; delete copy.seq;
      if (!c) { copy.seq = 0; copy.importado = true; t.objectStore('records').put(copy); added++; }
      else if ((r.updatedAt || '') > (c.updatedAt || '')) { copy.seq = c.seq; copy.importado = c.importado; t.objectStore('records').put(copy); updated++; }
      else same++;
    }
    for (const ph of photos) if (!have.has(ph.id)) { t.objectStore('photos').put(ph); padd++; }
    await d; return { added, updated, same, padd };
  }
  return { open, all, get, meta, setMeta, delMeta, photosOf, save, putRecord, purge, merge };
})();

/* ======================= Especies ======================= */
const COMUNES = [
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
  ['Carbonero', 'Calliandra pittieri'], ['Sauce', 'Salix humboldtiana'], ['Guadua', 'Guadua angustifolia'], ['Bambú', 'Bambusa vulgaris'],
  ['Chirlobirlo', 'Tecoma stans'], ['Mataratón', 'Gliricidia sepium']
];
const SPECIES = COMUNES.slice();

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
function offerShare(blob, name) {
  try {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '📤 Compartir ' + name;
      b.onclick = () => navigator.share({ files: [f], title: name }).catch(() => {});
      $('#exportLog').prepend(b);
    }
  } catch (e) { /* opcional */ }
}

/* ======================= Estado ======================= */
const S = {
  records: [], settings: { cuadrilla: '', responsable: '' }, filter: 'all', q: '',
  editing: null, photos: { antes: null, despues: null }, removeIds: [], coord: null, gps: null, urls: [], dirty: false
};
const FIELDS = ['sticker', 'nombreComun', 'nombreCientifico', 'estado', 'cap', 'altura', 'costado', 'cortes', 'obs'];
const REQ_LABEL = { cap: 'CAP', altura: 'altura', costado: 'costado', cortes: 'N.º cortes', despues: 'foto DESPUÉS', nombreComun: 'nombre común', estado: 'estado' };

function missing(r) {
  const m = [];
  if (!r.nombreComun) m.push('nombreComun');
  if (!r.estado) m.push('estado');
  if (r.cap == null) m.push('cap');
  if (r.altura == null) m.push('altura');
  if (!r.costado) m.push('costado');
  if (r.cortes == null) m.push('cortes');
  if (!r.fotoDespues) m.push('despues');
  return m;
}
const active = () => S.records.filter(r => !r.deleted);

/* ======================= Fotos ======================= */
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
}
async function encode(src, max, q) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const k = Math.min(1, max / Math.max(W, H)); const w = Math.round(W * k), h = Math.round(H * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);
  const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  if (!b || !b.size) throw new Error('No se pudo procesar la foto');
  return { data: await b.arrayBuffer(), w, h };
}
async function processPhoto(file, kind) {
  const img = await decodeImage(file);
  try {
    const full = await encode(img, 1600, 0.82);
    const mid = await encode(img, 560, 0.72);
    return { id: uuid(), kind, type: 'image/jpeg', full: full.data, w: full.w, h: full.h, mid: mid.data, mw: mid.w, mh: mid.h, takenAt: now() };
  } finally { if (img.close) img.close(); }
}
function blobUrl(buf) { const u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })); S.urls.push(u); return u; }
function clearUrls() { S.urls.forEach(u => URL.revokeObjectURL(u)); S.urls = []; }

/* ======================= Conexión / offline ======================= */
const ASSETS = ['podas-' + CFG.slug + '.html', 'podas-app.js', 'podas-app.css', 'podas-' + CFG.slug + '.webmanifest', 'podas-' + CFG.slug + '.png'];
function net() {
  const p = $('#netPill');
  if (navigator.onLine) { p.textContent = 'Con conexión'; p.className = 'pill'; }
  else { p.textContent = 'Sin conexión · guardando en el celular'; p.className = 'pill off'; }
}
async function ready() {
  const pill = $('#readyPill'), info = $('#offlineInfo');
  if (!('serviceWorker' in navigator) || !window.caches || !isSecureContext) {
    pill.textContent = 'Sin modo offline'; pill.className = 'pill off';
    info.textContent = 'Abra la app desde la dirección https:// en Chrome para que funcione sin conexión.'; return false;
  }
  let miss = 0; for (const a of ASSETS) if (!(await caches.match(new URL(a, location.href).href))) miss++;
  const c = navigator.serviceWorker.controller; const ok = !miss && c && /podas-sw\.js$/.test(c.scriptURL);
  pill.textContent = ok ? '✓ Lista sin conexión' : 'Preparando offline…'; pill.className = 'pill ' + (ok ? 'ready' : 'warn');
  info.textContent = ok ? '✓ La app está guardada en el celular y abre sin internet.' : 'Mantenga la conexión y vuelva a abrir la app una vez para terminar de prepararla.';
  return ok;
}
function setupSW() {
  if (!('serviceWorker' in navigator)) return ready();
  navigator.serviceWorker.register('podas-sw.js', { scope: './podas-' }).then(reg => {
    const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller && /podas-sw/.test(navigator.serviceWorker.controller.scriptURL)) $('#updateBar').hidden = false; ready(); });
    if (reg.waiting && navigator.serviceWorker.controller) $('#updateBar').hidden = false;
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
      const low = quota && (usage / quota > 0.9 || quota - usage < 80 * 1048576);
      $('#storageBar').hidden = !low;
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted(); $('#btnPersist').hidden = p;
      t += p ? ' ✓ Datos protegidos.' : ' Datos aún no protegidos contra borrado automático.';
    }
  } catch (e) { }
  $('#storageInfo').textContent = `${active().length} registros. ` + t;
}
async function persist(silent) {
  try { if (navigator.storage && navigator.storage.persist) { const ok = await navigator.storage.persist(); if (!silent) toast(ok ? 'Datos protegidos ✓' : 'Instale la app en la pantalla de inicio y vuelva a intentarlo', ok ? 'ok' : 'err'); } } catch (e) { }
  storage();
}

/* ======================= Navegación ======================= */
async function show(view) {
  if (!$('#v-form').hidden && view !== 'form' && S.dirty) {
    if (!(await confirmBox('Registro sin guardar', 'Lo que lleva queda como borrador y lo puede continuar desde <b>Nuevo</b>.', 'Salir'))) return;
    stopGps();
  }
  $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  scrollTo(0, 0);
  if (view === 'list') renderList();
  if (view === 'export') renderExport();
  if (view === 'backup') renderBackup();
}

/* ======================= Lista ======================= */
async function load() { S.records = await DB.all('records'); S.records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
async function renderList() {
  clearUrls();
  const all = active(), mk = monthKey(now());
  const mes = all.filter(r => monthKey(r.createdAt) === mk);
  const pend = all.filter(r => missing(r).length);
  $('#summary').innerHTML = `<div><b>${mes.length}</b><span>árboles este mes</span></div><div><b>${mes.reduce((s, r) => s + (r.cortes || 0), 0)}</b><span>cortes este mes</span></div><div class="${pend.length ? 'warn' : ''}"><b>${pend.length}</b><span>pendientes</span></div>`;
  let list = all;
  if (S.filter === 'pend') list = pend;
  if (S.filter === 'mes') list = mes;
  if (S.filter === 'hoy') { const d = new Date().toDateString(); list = all.filter(r => new Date(r.createdAt).toDateString() === d); }
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(r => [r.sticker, r.nombreComun, r.cuadrilla].some(v => String(v || '').toLowerCase().includes(q)));
  $('#empty').hidden = all.length > 0;
  const ul = $('#list'); ul.innerHTML = '';
  for (const r of list.slice(0, 300)) {
    const m = missing(r);
    const li = document.createElement('li'); li.className = 'item'; li.dataset.id = r.id; li.tabIndex = 0;
    li.innerHTML = `<div class="thumbs2"><div class="tb" data-k="antes"><span>ANTES</span></div><div class="tb" data-k="despues"><span>DESPUÉS</span></div></div>
      <div class="info"><div class="st">Sticker <b>${esc(r.sticker)}</b></div>
      <div class="sub">${esc(r.nombreComun || '—')}${r.estado ? ' · ' + esc(r.estado) : ''}${r.cortes != null ? ' · ' + r.cortes + ' corte' + (r.cortes === 1 ? '' : 's') : ''}</div>
      <div class="badges">${m.length ? `<span class="badge warn">Falta: ${m.map(x => REQ_LABEL[x]).join(', ')}</span>` : '<span class="badge ok">Completo</span>'}
      <span class="date">${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)}</span></div></div>`;
    ul.appendChild(li);
  }
  if (list.length > 300) ul.insertAdjacentHTML('beforeend', `<li class="empty">Mostrando 300 de ${list.length}. Use el buscador.</li>`);
  if (!list.length && all.length) ul.innerHTML = '<li class="empty">Ningún registro coincide.</li>';
  // miniaturas (asíncrono)
  for (const li of ul.querySelectorAll('.item')) {
    const ph = await DB.photosOf(li.dataset.id);
    for (const p of ph) {
      const tb = li.querySelector(`.tb[data-k="${p.kind}"]`);
      if (tb) { tb.style.backgroundImage = `url(${blobUrl(p.mid)})`; tb.classList.add('has'); }
    }
  }
}

/* ======================= Formulario ======================= */
const F = () => $('#form').elements;
async function openForm(rec, draft) {
  stopGps(); clearUrls(); $('#form').reset();
  F().estado.value = ''; F().costado.value = ''; F().nombreCientifico.dataset.auto = '';
  S.editing = rec ? structuredClone(rec) : null;
  S.photos = { antes: null, despues: null }; S.removeIds = []; S.coord = rec && rec.coord ? { ...rec.coord } : null;
  if (rec) {
    FIELDS.forEach(k => setField(k, rec[k]));
    for (const p of await DB.photosOf(rec.id)) S.photos[p.kind] = { ...p, saved: true };
  }
  if (draft) {
    FIELDS.forEach(k => { if (draft.fields[k] !== undefined) setField(k, draft.fields[k]); });
    if (draft.photos) for (const k of ['antes', 'despues']) if (draft.photos[k]) S.photos[k] = draft.photos[k];
    S.removeIds = draft.removeIds || []; S.coord = draft.coord || S.coord;
  }
  $('#sciBox').hidden = !F().nombreCientifico.value;
  $('#formTitle').textContent = rec ? 'Editar poda' : 'Nueva poda';
  $('#formNum').textContent = rec ? `N.º ${rec.cuadrilla}-${String(rec.seq || 0).padStart(4, '0')}` : S.settings.cuadrilla;
  $('#btnDelete').hidden = !rec;
  renderSlots(); renderChips(); renderCoord(); checkDup();
  S.dirty = !!draft;
  $$('.view').forEach(v => (v.hidden = v.id !== 'v-form'));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'form'));
  scrollTo(0, 0);
  if (!S.coord) startGps();
  if (rec && !draft && S.photos.antes && !S.photos.despues) setTimeout(() => $('#slot-despues').scrollIntoView({ block: 'center' }), 50);
}
function setField(k, v) {
  const f = F();
  if (k === 'estado' || k === 'costado') { f[k].value = v || ''; return; }
  if (f[k]) f[k].value = v ?? '';
}
function renderChips() {
  for (const k of ['estado', 'costado']) {
    const v = F()[k].value;
    $$(`.chips[data-f="${k}"] .chip`).forEach(c => c.classList.toggle('on', c.dataset.v === v));
  }
}
function renderSlots() {
  for (const k of ['antes', 'despues']) {
    const slot = $('#slot-' + k), p = S.photos[k];
    slot.classList.toggle('has', !!p);
    slot.querySelector('.img').style.backgroundImage = p ? `url(${blobUrl(p.mid)})` : '';
    slot.querySelector('.state').textContent = p ? (p.saved ? '✓ Guardada' : '● Sin guardar') : 'Toque para tomar foto';
    slot.querySelector('.del').hidden = !p;
  }
}
function markDirty() { S.dirty = true; clearTimeout(S.dt); S.dt = setTimeout(saveDraft, 500); }
async function saveDraft() {
  if (!S.dirty || $('#v-form').hidden) return;
  const f = F(), fields = {}; FIELDS.forEach(k => (fields[k] = f[k].value));
  const photos = {}; for (const k of ['antes', 'despues']) { const p = S.photos[k]; photos[k] = p && !p.saved ? p : null; }
  try { await DB.setMeta('draft', { editingId: S.editing ? S.editing.id : null, fields, photos, removeIds: S.removeIds, coord: S.coord, at: now() }); }
  catch (e) { if (e.quota) toast(e.message, 'err'); }
}
async function clearDraft() { clearTimeout(S.dt); S.dirty = false; try { await DB.delMeta('draft'); } catch (e) { } }

async function takePhoto(kind, file) {
  const slot = $('#slot-' + kind); slot.classList.add('busy'); slot.querySelector('.state').textContent = 'Procesando…';
  try {
    const ph = await processPhoto(file, kind);
    const old = S.photos[kind]; if (old && old.saved) S.removeIds.push(old.id);
    S.photos[kind] = ph; markDirty(); await saveDraft();
  } catch (e) { toast('No se pudo usar la foto: ' + e.message, 'err'); }
  slot.classList.remove('busy'); renderSlots();
}
async function removePhoto(kind) {
  const p = S.photos[kind]; if (!p) return;
  if (!(await confirmBox('Quitar foto ' + (kind === 'antes' ? 'ANTES' : 'DESPUÉS'), p.saved ? 'La foto se quitará al guardar el registro.' : '¿Quitar esta foto?', 'Quitar', 'danger'))) return;
  if (p.saved) S.removeIds.push(p.id); S.photos[kind] = null; markDirty(); renderSlots();
}
function checkDup() {
  const st = F().sticker.value.trim().toUpperCase(), el = $('#dupInfo');
  if (!st) { el.hidden = true; return; }
  const mk = monthKey(S.editing ? S.editing.createdAt : now());
  const n = active().filter(r => r.sticker === st && monthKey(r.createdAt) === mk && (!S.editing || r.id !== S.editing.id)).length;
  el.hidden = !n; el.textContent = n ? `ℹ️ El sticker ${st} ya tiene ${n} registro(s) este mes. Si es otro árbol de la misma luminaria, continúe.` : '';
}

/* ---------- GPS automático (opcional, nunca inventa ni copia) ---------- */
function stopGps() { if (S.gps) { navigator.geolocation.clearWatch(S.gps.w); clearTimeout(S.gps.t); S.gps = null; } }
function startGps() {
  if (!('geolocation' in navigator) || !isSecureContext) { renderCoord('Ubicación no disponible en este celular (opcional).'); return; }
  stopGps(); const g = { best: null }; S.gps = g; renderCoord('📡 Buscando ubicación… (opcional, no detiene el registro)');
  const end = () => { stopGps(); renderCoord(); };
  g.w = navigator.geolocation.watchPosition(p => {
    if (S.gps !== g) return;
    if (!g.best || p.coords.accuracy < g.best.coords.accuracy) {
      g.best = p; S.coord = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: new Date(p.timestamp || Date.now()).toISOString() };
      renderCoord(); if (S.dirty || F().sticker.value) markDirty();
    }
    if (p.coords.accuracy <= 8) end();
  }, e => { if (S.gps !== g) return; if (e.code === 1) { stopGps(); renderCoord('Permiso de ubicación negado (opcional).'); } else if (!g.best) renderCoord('Sin señal GPS todavía (opcional).'); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
  g.t = setTimeout(end, 90000);
}
function renderCoord(msg) {
  const el = $('#coordInfo'), c = S.coord;
  if (c) el.innerHTML = `📍 Ubicación tomada <b>±${c.acc} m</b> <small>(${c.lat.toFixed(6)}, ${c.lon.toFixed(6)})</small>${S.gps ? ' · mejorando…' : ''}`;
  else el.textContent = msg || 'Sin ubicación (opcional).';
}

/* ---------- Guardar ---------- */
async function save(ev) {
  ev.preventDefault();
  const f = F();
  const sticker = f.sticker.value.trim().toUpperCase();
  if (!sticker) { toast('Escriba el número de sticker', 'err'); f.sticker.focus(); return; }
  if (!S.photos.antes) { toast('Falta la foto ANTES', 'err'); $('#slot-antes').scrollIntoView({ block: 'center' }); return; }
  const vals = {};
  for (const [k, label] of [['cap', 'CAP'], ['altura', 'Altura'], ['cortes', 'N.º de cortes']]) {
    const n = num(f[k].value);
    if (Number.isNaN(n) || (n != null && n < 0)) { toast(label + ': escriba un número válido', 'err'); f[k].focus(); return; }
    vals[k] = n;
  }
  if (vals.cortes != null) vals.cortes = Math.round(vals.cortes);
  if (vals.altura != null && vals.altura > 60) { if (!(await confirmBox('Revise la altura', `¿Altura de <b>${vals.altura} m</b>? Parece muy alta.`, 'Sí, es correcto'))) return; }
  if (vals.cap != null && vals.cap > 1000) { if (!(await confirmBox('Revise el CAP', `¿CAP de <b>${vals.cap} cm</b>?`, 'Sí, es correcto'))) return; }

  const btn = $('#btnSave'); btn.disabled = true; btn.textContent = 'Guardando y verificando…';
  try {
    const t = now();
    const rec = S.editing ? { ...S.editing } : { id: uuid(), createdAt: t, ciudad: CFG.ciudad, cuadrilla: S.settings.cuadrilla, responsable: S.settings.responsable, deleted: false };
    rec.sticker = sticker;
    rec.nombreComun = f.nombreComun.value.trim();
    rec.nombreCientifico = f.nombreCientifico.value.trim();
    rec.estado = f.estado.value; rec.costado = f.costado.value; rec.obs = f.obs.value.trim();
    Object.assign(rec, vals);
    rec.coord = S.coord || null;
    rec.updatedAt = t;
    const newPhotos = [];
    for (const k of ['antes', 'despues']) {
      const p = S.photos[k];
      if (p && !p.saved) { const c = { ...p, recordId: rec.id }; delete c.saved; newPhotos.push(c); }
      rec[k === 'antes' ? 'fotoAntes' : 'fotoDespues'] = p ? p.id : null;
    }
    const saved = await DB.save(rec, newPhotos, S.removeIds.filter(id => id !== rec.fotoAntes && id !== rec.fotoDespues));
    await clearDraft(); stopGps(); learn(rec);
    await load();
    const m = missing(saved);
    toast(`✓ Sticker ${saved.sticker} guardado` + (m.length ? ` · falta: ${m.map(x => REQ_LABEL[x]).join(', ')}` : ' · completo'), m.length ? '' : 'ok');
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
  if (!(await confirmBox('Eliminar registro', `¿Enviar a la papelera el sticker <b>${esc(r.sticker)}</b>? Se puede recuperar desde Respaldo.`, 'Eliminar', 'danger'))) return;
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
  if (d) {
    const target = d.editingId ? S.records.find(r => r.id === d.editingId) : null;
    const r = await ask('Registro sin terminar', `Tiene ${target ? 'la edición del sticker <b>' + esc(target.sticker) + '</b>' : 'un registro nuevo'} sin guardar${d.fields.sticker ? ' (sticker ' + esc(d.fields.sticker) + ')' : ''}.`,
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
  if (d && !(await confirmBox('Borrador pendiente', 'Hay otro registro sin terminar. Si abre este, ese borrador se descarta.', 'Descartar y abrir', 'danger'))) return;
  if (d) await clearDraft();
  openForm(r);
}

/* ======================= Excel con fotos incrustadas ======================= */
const COLS = [
  { k: 'n', h: 'N.º', w: 6, s: 'int' }, { k: 'fecha', h: 'Fecha', w: 11, s: 'c' }, { k: 'hora', h: 'Hora', w: 7, s: 'c' },
  { k: 'cuadrilla', h: 'Cuadrilla', w: 12, s: 'c' }, { k: 'sticker', h: 'Sticker', w: 11, s: 'c' },
  { k: 'nombreComun', h: 'Nombre común', w: 16, s: 't' }, { k: 'nombreCientifico', h: 'Nombre científico', w: 20, s: 't' },
  { k: 'estado', h: 'Estado', w: 10, s: 'c' }, { k: 'cap', h: 'CAP (cm)', w: 9, s: 'dec' }, { k: 'altura', h: 'Altura (m)', w: 9, s: 'dec' },
  { k: 'costado', h: 'Costado de luminaria', w: 13, s: 'c' }, { k: 'cortes', h: 'N.º de cortes', w: 9, s: 'int' },
  { k: 'img_antes', h: 'FOTO ANTES', w: 36, s: 'c', img: 'antes' }, { k: 'img_despues', h: 'FOTO DESPUÉS', w: 36, s: 'c', img: 'despues' },
  { k: 'lat', h: 'Latitud', w: 11, s: 'coord' }, { k: 'lon', h: 'Longitud', w: 12, s: 'coord' }, { k: 'acc', h: 'Precisión GPS (m)', w: 10, s: 'int' },
  { k: 'obs', h: 'Observaciones', w: 24, s: 't' }, { k: 'estadoReg', h: 'Estado del registro', w: 18, s: 'flag' },
  { k: 'responsable', h: 'Responsable', w: 15, s: 't' }, { k: 'id', h: 'ID único', w: 14, s: 't' }
];
const ROW_PT = 172;                                  // alto de fila con foto (puntos)
const colPx = w => Math.floor(w * 7 + 5);
const EMU = 9525;
function xe(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cn(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

async function buildExcel(recs, title) {
  const brand = 'FF' + CFG.color.replace('#', '').toUpperCase();
  const ST = { title: 1, head: 2, t: 3, c: 4, dec: 5, int: 6, coord: 7, pend: 8, ok: 9, label: 10, val: 11 };
  const media = []; const anchors = [];
  const last = cn(COLS.length - 1);
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  x += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  x += '<sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  x += '<cols>' + COLS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  x += `<row r="1" ht="30" customHeight="1"><c r="A1" t="inlineStr" s="${ST.title}"><is><t>${xe(title)}</t></is></c></row>`;
  x += '<row r="2" ht="36" customHeight="1">' + COLS.map((c, i) => `<c r="${cn(i)}2" t="inlineStr" s="${ST.head}"><is><t>${xe(c.h)}</t></is></c>`).join('') + '</row>';
  for (let i = 0; i < recs.length; i++) {
    const { r, photos } = recs[i]; const R = i + 3; const m = missing(r);
    const v = {
      n: i + 1, fecha: fmtDate(r.createdAt), hora: fmtTime(r.createdAt), cuadrilla: r.cuadrilla, sticker: r.sticker,
      nombreComun: r.nombreComun, nombreCientifico: r.nombreCientifico, estado: r.estado, cap: r.cap, altura: r.altura,
      costado: r.costado, cortes: r.cortes, lat: r.coord ? r.coord.lat : null, lon: r.coord ? r.coord.lon : null, acc: r.coord ? r.coord.acc : null,
      obs: r.obs, estadoReg: m.length ? 'Pendiente: ' + m.map(z => REQ_LABEL[z]).join(', ') : 'Completo', responsable: r.responsable, id: r.id
    };
    x += `<row r="${R}" ht="${ROW_PT}" customHeight="1">`;
    COLS.forEach((c, ci) => {
      const ref = cn(ci) + R;
      if (c.img) {
        const p = photos[c.img];
        if (p) { media.push(p.mid); anchors.push({ col: ci, row: R - 1, w: p.mw, h: p.mh, n: media.length, name: `${c.img} sticker ${r.sticker}`, cw: c.w }); x += `<c r="${ref}" s="${ST.c}"/>`; }
        else x += `<c r="${ref}" t="inlineStr" s="${ST.pend}"><is><t>Sin foto</t></is></c>`;
        return;
      }
      const val = v[c.k];
      const style = c.s === 'flag' ? (m.length ? ST.pend : ST.ok) : ST[c.s];
      if (val === null || val === undefined || val === '') { x += `<c r="${ref}" s="${style}"/>`; return; }
      if (['dec', 'int', 'coord'].includes(c.s) && Number.isFinite(Number(val))) x += `<c r="${ref}" s="${style}"><v>${Number(val)}</v></c>`;
      else x += `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xe(val)}</t></is></c>`;
    });
    x += '</row>';
  }
  x += '</sheetData>';
  x += `<autoFilter ref="A2:${last}${Math.max(2, recs.length + 2)}"/>`;
  x += `<mergeCells count="1"><mergeCell ref="A1:${last}1"/></mergeCells>`;
  x += '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>';
  x += '<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  if (anchors.length) x += '<drawing r:id="rId1"/>';
  x += '</worksheet>';

  // Dibujo: cada foto anclada dentro de su celda (se mueve y filtra con la fila)
  const rowPx = Math.round(ROW_PT * 96 / 72);
  let dr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  anchors.forEach((a, i) => {
    const boxW = colPx(a.cw) - 10, boxH = rowPx - 10;
    const k = Math.min(boxW / a.w, boxH / a.h); const w = Math.round(a.w * k), h = Math.round(a.h * k);
    const ox = Math.round((colPx(a.cw) - w) / 2), oy = Math.round((rowPx - h) / 2);
    dr += `<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${ox * EMU}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${oy * EMU}</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${a.col}</xdr:col><xdr:colOff>${(ox + w) * EMU}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${(oy + h) * EMU}</xdr:rowOff></xdr:to>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Foto ${i + 1}" descr="${xe(a.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="rId${a.n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  });
  dr += '</xdr:wsDr>';

  // Hoja resumen
  const tot = recs.length, cortes = recs.reduce((s, z) => s + (z.r.cortes || 0), 0);
  const comp = recs.filter(z => !missing(z.r).length).length;
  const est = {}; recs.forEach(z => { const e = z.r.estado || 'Sin dato'; est[e] = (est[e] || 0) + 1; });
  const cuad = {}; recs.forEach(z => { const c = z.r.cuadrilla || 'Sin dato'; cuad[c] = cuad[c] || { n: 0, c: 0 }; cuad[c].n++; cuad[c].c += z.r.cortes || 0; });
  const rows = [['Municipio', CFG.ciudad], ['Periodo', title.split(' · ')[1] || ''], ['Generado', `${fmtDate(now())} ${fmtTime(now())}`], ['', ''],
    ['Árboles intervenidos', tot], ['Total de cortes', cortes], ['Registros completos', comp], ['Registros pendientes', tot - comp], ['', ''], ['Por estado', 'Árboles'],
    ...Object.entries(est).map(([k, n]) => [k, n]), ['', ''], ['Por cuadrilla', 'Árboles · cortes'], ...Object.entries(cuad).map(([k, o]) => [k, `${o.n} · ${o.c}`])];
  let s2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/></cols><sheetData>';
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

  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      (anchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Podas" sheetId="1" r:id="rId1"/><sheet name="Resumen" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Podas!$A$2:$${last}$${Math.max(2, recs.length + 2)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Podas!$2:$2</definedName></definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: x },
    { name: 'xl/worksheets/sheet2.xml', data: s2 }
  ];
  if (anchors.length) {
    files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' });
    files.push({ name: 'xl/drawings/drawing1.xml', data: dr });
    files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + media.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpeg"/>`).join('') + '</Relationships>' });
    media.forEach((m, i) => files.push({ name: `xl/media/image${i + 1}.jpeg`, data: new Uint8Array(m) }));
  }
  return { blob: await Zip.build(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), fotos: media.length };
}

/* ======================= Exportar ======================= */
function selection() {
  const mk = $('#expMes').value, cq = $('#expCuad').value;
  return active().filter(r => (mk === 'all' || monthKey(r.createdAt) === mk) && (cq === 'all' || r.cuadrilla === cq))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}
function renderExport() {
  const all = active();
  const months = [...new Set(all.map(r => monthKey(r.createdAt)))].sort().reverse();
  const cur = monthKey(now()); if (!months.includes(cur)) months.unshift(cur);
  const ms = $('#expMes'), prevM = ms.value;
  ms.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('') + '<option value="all">Todos los meses</option>';
  ms.value = prevM && [...ms.options].some(o => o.value === prevM) ? prevM : cur;
  const cs = $('#expCuad'), prevC = cs.value;
  const cuads = [...new Set(all.map(r => r.cuadrilla).filter(Boolean))].sort();
  cs.innerHTML = '<option value="all">Todas las cuadrillas</option>' + cuads.map(c => `<option>${esc(c)}</option>`).join('');
  cs.value = prevC && [...cs.options].some(o => o.value === prevC) ? prevC : 'all';
  renderExportInfo();
}
function renderExportInfo() {
  const sel = selection(), pend = sel.filter(r => missing(r).length);
  $('#expInfo').innerHTML = `<b>${sel.length}</b> árboles · <b>${sel.reduce((s, r) => s + (r.cortes || 0), 0)}</b> cortes · ` +
    `<b>${sel.filter(r => r.fotoAntes).length + sel.filter(r => r.fotoDespues).length}</b> fotos` +
    (pend.length ? `<br><span class="warntxt">⚠️ ${pend.length} pendiente(s): salen marcados en amarillo en el Excel.</span>` : '<br>✓ Todos completos.');
}
async function gatherPhotos(sel) {
  const out = [];
  for (const r of sel) {
    const photos = {}; for (const p of await DB.photosOf(r.id)) photos[p.kind] = p;
    out.push({ r, photos });
  }
  return out;
}
function periodName() {
  const mk = $('#expMes').value, cq = $('#expCuad').value;
  return { label: (mk === 'all' ? 'Todos los meses' : monthLabel(mk)) + (cq === 'all' ? '' : ' · ' + cq), file: (mk === 'all' ? 'todos' : mk) + (cq === 'all' ? '' : '_' + safe(cq)) };
}
async function exportExcel() {
  const sel = selection(); if (!sel.length) { toast('No hay registros en esa selección', 'err'); return; }
  const btns = $$('[data-exp]'); btns.forEach(b => (b.disabled = true)); const st = $('#expStatus'); st.textContent = 'Generando Excel con fotos…';
  try {
    const recs = await gatherPhotos(sel); const p = periodName();
    const { blob, fotos } = await buildExcel(recs, `PODAS MENSUAL ${CFG.ciudad.toUpperCase()} · ${p.label}`);
    const name = `Podas_${safe(CFG.ciudad)}_${p.file}_${stamp()}.xlsx`;
    download(blob, name); offerShare(blob, name);
    $('#exportLog').insertAdjacentHTML('afterbegin', `<div>✓ ${esc(name)} · ${sel.length} árboles · ${fotos} fotos · ${bytes(blob.size)}</div>`);
    toast('Excel generado. Los registros siguen guardados.', 'ok');
  } catch (e) { toast('Error al generar: ' + e.message + '. Sus datos no cambiaron.', 'err'); }
  finally { btns.forEach(b => (b.disabled = false)); st.textContent = ''; }
}
async function exportZip() {
  const sel = selection(); if (!sel.length) { toast('No hay registros en esa selección', 'err'); return; }
  const btns = $$('[data-exp]'); btns.forEach(b => (b.disabled = true)); $('#expStatus').textContent = 'Empacando fotos…';
  try {
    const recs = await gatherPhotos(sel), p = periodName(), files = [], used = new Set();
    const lines = ['Archivo;Sticker;Tipo;Fecha;Cuadrilla;ID registro'];
    for (const { r, photos } of recs) for (const k of ['antes', 'despues']) {
      const ph = photos[k]; if (!ph) continue;
      let base = `${safe(r.sticker)}_${k.toUpperCase()}`, n = base, i = 2; while (used.has(n)) n = `${base}_${i++}`; used.add(n);
      files.push({ name: `fotos/${n}.jpg`, data: new Uint8Array(ph.full) });
      lines.push(`${n}.jpg;${r.sticker};${k === 'antes' ? 'ANTES' : 'DESPUÉS'};${fmtDate(r.createdAt)};${r.cuadrilla};${r.id}`);
    }
    files.push({ name: 'relacion_fotos.csv', data: '﻿' + lines.join('\r\n') });
    const blob = await Zip.build(files), name = `Fotos_podas_${safe(CFG.ciudad)}_${p.file}_${stamp()}.zip`;
    download(blob, name); offerShare(blob, name);
    $('#exportLog').insertAdjacentHTML('afterbegin', `<div>✓ ${esc(name)} · ${files.length - 1} fotos · ${bytes(blob.size)}</div>`);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
  finally { btns.forEach(b => (b.disabled = false)); $('#expStatus').textContent = ''; }
}

/* ======================= Respaldo / unir cuadrillas ======================= */
async function renderBackup() {
  const lb = await DB.meta('lastBackup');
  $('#lastBackup').innerHTML = lb ? `Última copia: <b>${fmtDate(lb)} ${fmtTime(lb)}</b>` : '<span class="warntxt">Aún no ha hecho copia de seguridad.</span>';
  $('#setCuad').value = S.settings.cuadrilla; $('#setResp').value = S.settings.responsable || '';
  const del = S.records.filter(r => r.deleted);
  $('#trash').innerHTML = del.length ? del.map(r => `<li class="trow"><span>Sticker <b>${esc(r.sticker)}</b> · ${fmtDate(r.createdAt)}</span><span><button class="btn small" data-restore="${r.id}">Recuperar</button> <button class="btn small danger" data-purge="${r.id}">Borrar</button></span></li>`).join('') : '<li class="hint">Papelera vacía.</li>';
  $('#version').textContent = `Podas ${CFG.ciudad} · versión ${APP_VERSION} · los datos se guardan solo en este celular`;
  storage(); ready();
}
async function backup() {
  const b = $('#btnBackup'); b.disabled = true; b.textContent = 'Generando copia…';
  try {
    const recs = await DB.all('records'), photos = await DB.all('photos'), files = [];
    const pm = photos.map(p => {
      files.push({ name: `fotos/${p.id}_full.jpg`, data: new Uint8Array(p.full) }, { name: `fotos/${p.id}_mid.jpg`, data: new Uint8Array(p.mid) });
      const { full, mid, ...rest } = p; return { ...rest, fullSize: full.byteLength, midSize: mid.byteLength };
    });
    files.unshift({ name: 'respaldo.json', data: JSON.stringify({ format: 'podas-respaldo', version: 1, ciudad: CFG.slug, cuadrilla: S.settings.cuadrilla, createdAt: now(), records: recs, photos: pm }) });
    const blob = await Zip.build(files);
    const chk = await parseBackup(blob);
    if (chk.data.records.length !== recs.length || chk.photos.length !== photos.length) throw new Error('La copia no pasó la verificación');
    const name = `Respaldo_podas_${safe(CFG.ciudad)}_${safe(S.settings.cuadrilla)}_${stamp()}.zip`;
    download(blob, name); offerShare(blob, name);
    await DB.setMeta('lastBackup', now());
    toast(`✓ Copia verificada: ${recs.length} registros, ${photos.length} fotos (${bytes(blob.size)})`, 'ok'); renderBackup();
  } catch (e) { toast('No se pudo crear la copia: ' + e.message, 'err'); }
  finally { b.disabled = false; b.textContent = '💾 Crear copia / enviar al supervisor'; }
}
async function parseBackup(file) {
  const ent = await Zip.read(file), j = ent.get('respaldo.json');
  if (!j) throw new Error('Este archivo no es una copia de la app de podas.');
  const data = JSON.parse(Zip.text(j));
  if (data.format !== 'podas-respaldo') throw new Error('Formato no reconocido.');
  const photos = [], bad = [];
  for (const p of data.photos) {
    const f = ent.get(`fotos/${p.id}_full.jpg`), m = ent.get(`fotos/${p.id}_mid.jpg`);
    if (!f || !m || f.byteLength !== p.fullSize || m.byteLength !== p.midSize) { bad.push(p.id); continue; }
    const { fullSize, midSize, ...rest } = p; photos.push({ ...rest, full: f.slice().buffer, mid: m.slice().buffer });
  }
  return { data, photos, bad };
}
async function restore(files) {
  let tot = { added: 0, updated: 0, same: 0, padd: 0 }; const names = [];
  for (const file of files) {
    try {
      const { data, photos, bad } = await parseBackup(file);
      if (data.ciudad !== CFG.slug) { toast(`«${file.name}» es de otra ciudad (${data.ciudad}). Ábralo en esa app.`, 'err'); continue; }
      const ok = await confirmBox('Unir copia', `<b>${esc(file.name)}</b><br>Cuadrilla: <b>${esc(data.cuadrilla || '—')}</b><br>${data.records.length} registros · ${data.photos.length} fotos${bad.length ? `<br>⚠️ ${bad.length} foto(s) dañadas no se unirán` : ''}<br><br>No se borra nada de este celular.`, 'Unir');
      if (!ok) continue;
      const r = await DB.merge(data.records, photos); for (const k in tot) tot[k] += r[k]; names.push(data.cuadrilla || file.name);
    } catch (e) { toast(`No se pudo leer «${file.name}»: ${e.message}`, 'err'); }
  }
  if (!names.length) return;
  await load();
  await ask('Copias unidas', `Cuadrillas: <b>${esc(names.join(', '))}</b><br>Registros nuevos: <b>${tot.added}</b><br>Actualizados: <b>${tot.updated}</b><br>Ya estaban: <b>${tot.same}</b><br>Fotos agregadas: <b>${tot.padd}</b><br><br>Ahora puede exportar un solo Excel con todas las cuadrillas.`, [{ label: 'Aceptar', value: 'ok', kind: 'primary' }]);
  renderBackup();
}
async function setup() {
  const r = await ask('Datos de la cuadrilla', `<p class="hint">Se guardan en este celular y salen en cada registro y en el Excel.</p>
    <label>Nombre de la cuadrilla *<input id="suCuad" value="${esc(S.settings.cuadrilla)}" placeholder="ej. Cuadrilla 1" maxlength="20" autocapitalize="words"></label>
    <label>Responsable<input id="suResp" value="${esc(S.settings.responsable || '')}" placeholder="Nombre de quien registra"></label>`,
    [{ label: 'Guardar', value: 'ok', kind: 'primary' }]);
  if (r !== 'ok') return;
  const c = ($('#suCuad').value || '').trim(); if (!c) { toast('Escriba el nombre de la cuadrilla', 'err'); return setup(); }
  S.settings = { cuadrilla: c, responsable: ($('#suResp').value || '').trim() }; await DB.setMeta('settings', S.settings); paintCuad();
}
function paintCuad() { $('#cuadPill').textContent = S.settings.cuadrilla || 'Sin cuadrilla'; }

/* ======================= Inicio ======================= */
async function init() {
  net(); addEventListener('online', net); addEventListener('offline', net);
  try { await DB.open(); } catch (e) { document.body.innerHTML = `<p style="padding:20px">No se pudo abrir el almacenamiento: ${esc(e.message)}. No use modo incógnito.</p>`; return; }
  S.settings = { ...S.settings, ...(await DB.meta('settings', {})) }; paintCuad();
  await load(); learn({}); active().forEach(learn);

  $$('.tabs button').forEach(b => b.onclick = () => b.dataset.view === 'form' ? ($('#v-form').hidden ? newRecord() : null) : show(b.dataset.view));
  $('#list').onclick = e => { const li = e.target.closest('.item'); if (li) { const r = S.records.find(x => x.id === li.dataset.id); if (r) edit(r); } };
  $('#q').oninput = e => { S.q = e.target.value; renderList(); };
  $('#filters').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; S.filter = c.dataset.f; $$('#filters .chip').forEach(x => x.classList.toggle('on', x === c)); renderList(); };
  $('#cuadPill').onclick = setup;

  const f = F();
  $('#form').addEventListener('submit', save);
  $('#form').addEventListener('input', e => {
    const n = e.target.name;
    if (n === 'sticker') checkDup();
    if (n === 'nombreComun') {
      const sp = SPECIES.find(s => s[0].toLowerCase() === f.nombreComun.value.trim().toLowerCase());
      if (sp && sp[1] && (!f.nombreCientifico.value || f.nombreCientifico.dataset.auto === '1')) { f.nombreCientifico.value = sp[1]; f.nombreCientifico.dataset.auto = '1'; }
    }
    if (n === 'nombreCientifico') f.nombreCientifico.dataset.auto = '';
    markDirty();
  });
  $$('.chips[data-f]').forEach(box => box.onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    const k = box.dataset.f; f[k].value = f[k].value === c.dataset.v ? '' : c.dataset.v; renderChips(); markDirty();
  });
  $('#btnSci').onclick = () => { $('#sciBox').hidden = false; f.nombreCientifico.focus(); };
  $('#minus').onclick = () => { const n = num(f.cortes.value) || 0; f.cortes.value = Math.max(0, n - 1); markDirty(); };
  $('#plus').onclick = () => { const n = num(f.cortes.value); f.cortes.value = (Number.isFinite(n) ? n : 0) + 1; markDirty(); };
  for (const k of ['antes', 'despues']) {
    const slot = $('#slot-' + k), cam = $('#cam-' + k), gal = $('#gal-' + k);
    slot.querySelector('.img').onclick = () => cam.click();
    slot.querySelector('.galbtn').onclick = () => gal.click();
    slot.querySelector('.del').onclick = () => removePhoto(k);
    for (const inp of [cam, gal]) inp.onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) takePhoto(k, file); };
  }
  $('#btnGps').onclick = () => { S.coord = null; startGps(); };
  $('#btnCancel').onclick = cancel;
  $('#btnDelete').onclick = del;

  $('#expMes').onchange = renderExportInfo; $('#expCuad').onchange = renderExportInfo;
  $('[data-exp="xlsx"]').onclick = exportExcel; $('[data-exp="zip"]').onclick = exportZip;
  $('#btnBackup').onclick = backup;
  $('#restoreIn').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) restore(fs); };
  $('#btnPersist').onclick = () => persist(false);
  $('#btnSaveSet').onclick = async () => {
    const c = $('#setCuad').value.trim(); if (!c) { toast('El nombre de la cuadrilla no puede quedar vacío', 'err'); return; }
    S.settings = { cuadrilla: c, responsable: $('#setResp').value.trim() }; await DB.setMeta('settings', S.settings); paintCuad(); toast('Guardado ✓', 'ok');
  };
  $('#trash').onclick = async e => {
    const rid = e.target.dataset.restore, pid = e.target.dataset.purge;
    if (rid) { const r = await DB.get('records', rid); r.deleted = false; r.updatedAt = now(); await DB.putRecord(r); await load(); renderBackup(); toast('Recuperado ✓', 'ok'); }
    if (pid) {
      const r = S.records.find(x => x.id === pid);
      if (!(await confirmBox('Borrar definitivamente', `El sticker <b>${esc(r.sticker)}</b> y sus fotos se borrarán para siempre de este celular.`, 'Borrar para siempre', 'danger'))) return;
      await DB.purge(pid); await load(); renderBackup(); toast('Borrado');
    }
  };
  addEventListener('pagehide', () => S.dirty && saveDraft());
  document.addEventListener('visibilitychange', () => document.hidden && saveDraft());

  renderList(); setupSW(); storage();
  if (!S.settings.cuadrilla) setTimeout(setup, 300);
  else if (await DB.meta('draft')) toast('Tiene un registro sin terminar. Toque «Nuevo» para continuarlo.');
}
init();
