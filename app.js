/* Bitácora Forestal · Campo — lógica principal (offline-first) */
'use strict';
const APP_VERSION = '1.0.1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const SPECIES = [
  ['Mango', 'Mangifera indica'], ['Oití', 'Licania tomentosa'], ['Lluvia de oro', 'Cassia fistula'],
  ['Guayacán amarillo', 'Handroanthus chrysanthus'], ['Guayacán rosado', 'Tabebuia rosea'], ['Ficus', 'Ficus benjamina'],
  ['Caucho', 'Ficus elastica'], ['Almendro', 'Terminalia catappa'], ['Samán', 'Samanea saman'],
  ['Matarratón', 'Gliricidia sepium'], ['Acacia roja / Flamboyán', 'Delonix regia'], ['Payandé / Chiminango', 'Pithecellobium dulce'],
  ['Ceiba', 'Ceiba pentandra'], ['Neem', 'Azadirachta indica'], ['Mamoncillo', 'Melicoccus bijugatus'],
  ['Palma real', 'Roystonea regia'], ['Guácimo', 'Guazuma ulmifolia'], ['Igua', 'Albizia guachapele'],
  ['Swinglea', 'Swinglea glutinosa'], ['Leucaena', 'Leucaena leucocephala'], ['Totumo', 'Crescentia cujete'],
  ['Cañafístula', 'Cassia grandis'], ['Guanábano', 'Annona muricata'], ['Limón', 'Citrus × limon'], ['Pomarroso', 'Syzygium jambos']
];

const state = {
  records: [], filter: 'all', query: '',
  editing: null,          // registro en edición (copia) o null si es nuevo
  coord: null,            // {lat, lon, accuracy, altitude, source, capturedAt, status}
  newPhotos: [],          // fotos aún no guardadas en este formulario
  savedPhotos: [],        // fotos ya guardadas del registro en edición
  removedPhotoIds: [],
  settings: { brigada: '', responsable: '', resize: true },
  gps: null, urls: []
};

/* ================= utilidades ================= */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const hx = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function fmtNum(n, d = 6) { return n == null ? '' : Number(n).toFixed(d); }
function nowIso() { return new Date().toISOString(); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }

let toastT;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), kind === 'err' ? 7000 : 3500);
}
function ask(title, bodyHtml, buttons) {
  return new Promise(resolve => {
    const d = $('#dlg');
    $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = bodyHtml;
    const box = $('#dlgBtns'); box.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.kind || ''); el.textContent = b.label; el.value = b.value;
      box.appendChild(el);
    });
    d.onclose = () => resolve(d.returnValue || null);
    d.returnValue = '';
    d.showModal();
  });
}
async function confirmBox(title, body, okLabel = 'Aceptar', kind = 'primary') {
  return (await ask(title, body, [{ label: 'Cancelar', value: 'no' }, { label: okLabel, value: 'yes', kind }])) === 'yes';
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function deliver(blob, name) {
  download(blob, name);
  try {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      const log = $('#exportLog');
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = 'Compartir ' + name;
      b.onclick = () => navigator.share({ files: [f], title: name }).catch(() => {});
      log.prepend(b);
    }
  } catch (e) { /* compartir es opcional */ }
}

/* ================= conexión y preparación offline ================= */
function updateNet() {
  const p = $('#netPill');
  if (navigator.onLine) { p.textContent = 'Con conexión'; p.className = 'pill on'; }
  else { p.textContent = 'Sin conexión · guardando en el equipo'; p.className = 'pill off'; }
}
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'db.js', 'zip.js', 'export.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
async function checkOfflineReady() {
  const pill = $('#readyPill'), info = $('#offlineInfo');
  if (!('serviceWorker' in navigator) || !window.caches) {
    pill.textContent = 'Modo offline no disponible'; pill.className = 'pill off';
    info.textContent = 'Este navegador no admite el modo sin conexión. Use Chrome en Android o Chrome/Edge en el computador.';
    return false;
  }
  if (!isSecureContext) {
    pill.textContent = 'Requiere HTTPS'; pill.className = 'pill off';
    info.textContent = 'La aplicación debe abrirse desde una dirección https:// para funcionar sin conexión y usar el GPS.';
    return false;
  }
  let missing = 0;
  for (const a of ASSETS) if (!(await caches.match(new URL(a, location.href).href))) missing++;
  const controlled = !!navigator.serviceWorker.controller;
  const ok = missing === 0 && controlled;
  pill.textContent = ok ? '✓ Lista sin conexión' : 'Preparando modo offline…';
  pill.className = 'pill ' + (ok ? 'ready' : 'warn');
  info.innerHTML = ok
    ? '✓ Todos los archivos de la aplicación están guardados en el dispositivo. Puede abrirla sin internet.'
    : `Faltan ${missing} archivo(s) por guardar${controlled ? '' : ' y el modo offline aún no está activo'}. Mantenga la conexión y vuelva a abrir la aplicación una vez.`;
  return ok;
}
function setupSW() {
  if (!('serviceWorker' in navigator)) { checkOfflineReady(); return; }
  navigator.serviceWorker.register('sw.js').then(reg => {
    const watch = w => w && w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) $('#updateBar').hidden = false;
      checkOfflineReady();
    });
    if (reg.waiting && navigator.serviceWorker.controller) $('#updateBar').hidden = false;
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    $('#btnUpdate').onclick = () => { if (reg.waiting) reg.waiting.postMessage('skipWaiting'); };
    navigator.serviceWorker.ready.then(() => setTimeout(checkOfflineReady, 300));
  }).catch(() => checkOfflineReady());
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if ($('#updateBar').hidden === false && !reloaded) { reloaded = true; location.reload(); }
    else checkOfflineReady();
  });
}

/* ================= almacenamiento ================= */
async function updateStorage() {
  const info = $('#storageInfo'), bar = $('#storageBar');
  let txt = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const pct = quota ? (usage / quota) * 100 : 0;
      txt = `Usado: ${bytes(usage)} de ${bytes(quota)} disponibles (${pct.toFixed(1)} %).`;
      if (quota && (pct > 90 || quota - usage < 50 * 1048576)) {
        bar.hidden = false;
        bar.textContent = '⚠️ El almacenamiento está casi lleno. Exporte, haga copia de seguridad y libere espacio en el celular antes de seguir tomando fotos.';
      } else bar.hidden = true;
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      txt += p ? ' ✓ Datos protegidos contra borrado automático del navegador.' : ' Los datos aún no están protegidos contra el borrado automático del navegador.';
      $('#btnPersist').hidden = p;
    }
  } catch (e) { txt = 'No se pudo consultar el almacenamiento.'; }
  const photos = state.records.reduce((s, r) => s + (r.photoCount || 0), 0);
  info.textContent = `${state.records.filter(r => !r.deleted).length} registros, ${photos} fotos. ` + txt;
}
async function requestPersist(silent) {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const ok = await navigator.storage.persist();
      if (!silent) toast(ok ? 'Datos protegidos ✓' : 'El navegador no concedió la protección. Instale la app en la pantalla de inicio e intente de nuevo.', ok ? 'ok' : 'err');
    }
  } catch (e) { /* opcional */ }
  updateStorage();
}

/* ================= navegación ================= */
async function show(view) {
  if (view === 'form' && !$('#view-form').hidden) return;
  if (!$('#view-form').hidden && view !== 'form' && formDirty()) {
    const ok = await confirmBox('Salir del formulario', 'El registro no se ha guardado. El borrador se conserva en el dispositivo y podrá continuarlo desde <b>Nuevo</b>.', 'Salir');
    if (!ok) return;
    stopGps();
  }
  $$('.view').forEach(v => (v.hidden = v.id !== 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === 'list') renderList();
  if (view === 'export') renderExportCheck();
  if (view === 'backup') renderBackup();
}

/* ================= lista ================= */
async function loadRecords() {
  state.records = await DB.getAll('records');
  state.records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
function active() { return state.records.filter(r => !r.deleted); }
function coordBadge(r) {
  const c = Exporter.checkCoord(r.coord);
  if (c.level === 'pendiente') return '<span class="badge warn">Coord. pendiente</span>';
  if (c.level === 'error') return '<span class="badge err">Coord. no válida</span>';
  if (c.level === 'advertencia') return `<span class="badge warn">${esc(c.msg)}</span>`;
  return `<span class="badge ok">${r.coord.source === 'gps' ? 'GPS' : 'Manual'}${r.coord.accuracy ? ' ±' + Math.round(r.coord.accuracy) + ' m' : ''}</span>`;
}
function renderList() {
  const all = active();
  const pend = all.filter(r => Exporter.checkCoord(r.coord).level === 'pendiente').length;
  const today = new Date().toDateString();
  $('#summary').innerHTML = `<b>${all.length}</b> registros · <b>${all.reduce((s, r) => s + (r.photoCount || 0), 0)}</b> fotos · <b class="${pend ? 'warntxt' : ''}">${pend}</b> con coordenadas pendientes`;
  const q = state.query.trim().toLowerCase();
  let list = all;
  if (state.filter === 'pend') list = list.filter(r => Exporter.checkCoord(r.coord).level === 'pendiente');
  if (state.filter === 'nophoto') list = list.filter(r => !r.photoCount);
  if (state.filter === 'today') list = list.filter(r => new Date(r.createdAt).toDateString() === today);
  if (q) list = list.filter(r => [r.luminaria, r.arbolId, r.especieComun, r.especieCientifica, r.consecutivo, r.barrio, r.direccion].some(v => String(v || '').toLowerCase().includes(q)));
  $('#empty').hidden = all.length > 0;
  $('#list').innerHTML = list.map(r => `
    <li class="item" data-id="${esc(r.id)}" tabindex="0">
      <div class="itop"><b>Lum. ${esc(r.luminaria)}</b>${r.arbolId ? ` · Árbol ${esc(r.arbolId)}` : ''}<span class="mono">${esc(r.consecutivo)}</span></div>
      <div class="isub">${esc(r.especieComun || 'Sin especie')}${r.tratamiento ? ' · ' + esc(r.tratamiento) : ''}</div>
      <div class="ibadges">${coordBadge(r)}<span class="badge">${r.photoCount || 0} 📷</span><span class="idate">${fmtDate(r.createdAt)}</span></div>
    </li>`).join('') || (all.length ? '<li class="empty">Ningún registro coincide.</li>' : '');
}

/* ================= formulario ================= */
const F = () => $('#form').elements;
const FIELDS = ['luminaria', 'arbolId', 'responsable', 'especieComun', 'especieCientifica', 'cap', 'dap', 'altura', 'alturaFuste', 'diametroCopa', 'estado', 'interferencia', 'tratamiento', 'emplazamiento', 'comuna', 'barrio', 'direccion', 'observaciones'];
const NUMS = ['cap', 'dap', 'altura', 'alturaFuste', 'diametroCopa'];
let dirty = false;
function formDirty() { return dirty; }

function clearUrls() { state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = []; }

async function openForm(rec, draft) {
  stopGps(); clearUrls();
  const f = F();
  $('#form').reset();
  state.editing = rec ? structuredClone(rec) : null;
  state.newPhotos = []; state.removedPhotoIds = []; state.savedPhotos = [];
  state.coord = rec && rec.coord && rec.coord.status !== 'pendiente' ? { ...rec.coord } : null; // nunca se copian coordenadas de otro registro
  if (rec) {
    FIELDS.forEach(k => { f[k].value = rec[k] ?? ''; });
    state.savedPhotos = await DB.photosOf(rec.id);
  } else {
    f.responsable.value = state.settings.responsable || '';
  }
  if (draft) {
    FIELDS.forEach(k => { if (draft.fields[k] !== undefined) f[k].value = draft.fields[k]; });
    state.coord = draft.coord || null;
    state.newPhotos = draft.newPhotos || [];
    state.removedPhotoIds = draft.removedPhotoIds || [];
  }
  $('#formTitle').textContent = rec ? 'Editar registro' : 'Nuevo registro';
  $('#formConsec').textContent = rec ? rec.consecutivo : 'N.º se asigna al guardar';
  $('#btnDelete').hidden = !rec;
  $('#gpsLive').hidden = true;
  fillCoordInputs(); renderThumbs(); checkDup();
  dirty = !!draft;
  $$('.view').forEach(v => (v.hidden = v.id !== 'view-form'));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'form'));
  window.scrollTo(0, 0);
  if (rec && Exporter.checkCoord(rec.coord).level === 'pendiente' && !draft) {
    $('#locBox').scrollIntoView({ block: 'start' });
  }
}

function fillCoordInputs() {
  const f = F();
  f.lat.value = state.coord ? fmtNum(state.coord.lat, 7).replace(/0+$/, '').replace(/\.$/, '') : '';
  f.lon.value = state.coord ? fmtNum(state.coord.lon, 7).replace(/0+$/, '').replace(/\.$/, '') : '';
  renderCoordState();
}
function renderCoordState() {
  const el = $('#coordState'); const c = state.coord;
  if (!c) { el.innerHTML = '<span class="badge warn">Coordenadas pendientes</span>'; return; }
  const chk = Exporter.checkCoord(c);
  el.innerHTML = `<span class="badge ${chk.level === 'ok' ? 'ok' : 'warn'}">${c.source === 'gps' ? 'Tomada por GPS' : 'Ingresada manualmente'}</span>` +
    (c.accuracy ? ` <span>Precisión estimada: <b>±${Math.round(c.accuracy)} m</b></span>` : '') +
    (c.capturedAt ? ` <small>${fmtDate(c.capturedAt)}</small>` : '') +
    (chk.msg ? `<div class="warntxt">⚠️ ${esc(chk.msg)}</div>` : '');
}
function onCoordTyped() {
  const f = F();
  const lat = num(f.lat.value), lon = num(f.lon.value);
  if (lat == null && lon == null) state.coord = null;
  else if (sameAsCurrent(lat, lon)) { /* sin cambios */ }
  else state.coord = { lat, lon, accuracy: null, altitude: null, source: 'manual', capturedAt: nowIso(), status: 'ok' };
  renderCoordState(); markDirty();
}
function sameAsCurrent(lat, lon) {
  const c = state.coord;
  return !!(c && Number.isFinite(c.lat) && Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(c.lat - lat) < 5e-7 && Math.abs(c.lon - lon) < 5e-7);
}

/* ---------- GPS ---------- */
function stopGps() {
  if (state.gps) { navigator.geolocation.clearWatch(state.gps.watch); clearTimeout(state.gps.timer); state.gps = null; }
  $('#btnGps').disabled = false; $('#btnGpsStop').hidden = true;
}
function startGps() {
  const live = $('#gpsLive'); live.hidden = false;
  if (!('geolocation' in navigator)) { live.innerHTML = '❌ Este dispositivo o navegador no permite obtener la ubicación. Ingrese las coordenadas manualmente o guarde el registro con coordenadas pendientes.'; return; }
  if (!isSecureContext) { live.innerHTML = '❌ El GPS requiere abrir la aplicación desde una dirección https://.'; return; }
  stopGps();
  live.innerHTML = '⏳ Buscando señal GPS… Manténgase a cielo abierto, junto al árbol. Funciona sin internet.';
  $('#btnGps').disabled = true; $('#btnGpsStop').hidden = false;
  const g = { best: null, started: Date.now() };
  state.gps = g;
  const finish = () => {
    const best = g.best; stopGps();
    if (best) applyGps(best);
    else live.innerHTML = '⚠️ No se obtuvo ubicación. Puede intentar de nuevo, escribir las coordenadas o guardar con <b>coordenadas pendientes</b>.';
  };
  g.finish = finish;
  g.watch = navigator.geolocation.watchPosition(pos => {
    if (!state.gps) return;
    if (!g.best || pos.coords.accuracy < g.best.coords.accuracy) g.best = pos;
    const a = g.best.coords;
    const secs = Math.round((Date.now() - g.started) / 1000);
    live.innerHTML = `📡 Lat <b>${a.latitude.toFixed(6)}</b> · Lon <b>${a.longitude.toFixed(6)}</b><br>Precisión estimada: <b>±${Math.round(a.accuracy)} m</b> · ${secs} s<br><small>Se toma la mejor lectura. Se detiene sola al llegar a ±5 m o a los 60 s.</small>`;
    if (pos.coords.accuracy <= 5) finish();
  }, err => {
    if (!state.gps) return;
    if (err.code === 1) { stopGps(); live.innerHTML = '❌ Permiso de ubicación denegado. Actívelo en los ajustes del navegador para este sitio, o ingrese las coordenadas manualmente.'; }
    else if (err.code === 3 && !g.best) { finish(); }
    else if (!g.best) live.innerHTML = '⏳ Aún sin señal GPS (' + esc(err.message || 'sin posición') + '). Siga esperando o ingrese las coordenadas manualmente.';
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
  g.timer = setTimeout(finish, 60000);
}
function applyGps(pos) {
  const c = pos.coords;
  state.coord = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, altitude: c.altitude, source: 'gps', capturedAt: new Date(pos.timestamp || Date.now()).toISOString(), status: 'ok' };
  $('#gpsLive').innerHTML = `✓ Ubicación tomada: ${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} (±${Math.round(c.accuracy)} m)`;
  fillCoordInputs(); markDirty();
}

/* ---------- fotos ---------- */
async function processImage(file) {
  const type = file.type || 'image/jpeg';
  if (!state.settings.resize || !/^image\/(jpeg|png|webp)/.test(type)) return { data: await file.arrayBuffer(), type };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 1920; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && type === 'image/jpeg') { bmp.close && bmp.close(); return { data: await file.arrayBuffer(), type }; }
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close && bmp.close();
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('sin blob');
    return { data: await blob.arrayBuffer(), type: 'image/jpeg' };
  } catch (e) {
    return { data: await file.arrayBuffer(), type };
  }
}
async function addFiles(fileList) {
  const msg = $('#photoMsg');
  for (const file of fileList) {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) { toast('Archivo ignorado: no es una imagen', 'err'); continue; }
    msg.textContent = 'Procesando foto…';
    try {
      const { data, type } = await processImage(file);
      if (!data || !data.byteLength) throw new Error('La foto está vacía');
      state.newPhotos.push({ id: uuid(), data, type, name: file.name || 'foto.jpg', createdAt: nowIso() });
      markDirty();
    } catch (e) { toast('No se pudo leer la foto: ' + e.message, 'err'); }
  }
  msg.textContent = state.newPhotos.length ? `${state.newPhotos.length} foto(s) nueva(s) se guardarán al tocar «Guardar registro».` : '';
  renderThumbs();
}
function renderThumbs() {
  clearUrls();
  const box = $('#thumbs');
  const saved = state.savedPhotos.filter(p => !state.removedPhotoIds.includes(p.id));
  const items = [...saved.map(p => ({ p, saved: true })), ...state.newPhotos.map(p => ({ p, saved: false }))];
  box.innerHTML = '';
  items.forEach(({ p, saved }) => {
    const url = URL.createObjectURL(new Blob([p.data], { type: p.type })); state.urls.push(url);
    const d = document.createElement('div'); d.className = 'thumb' + (saved ? '' : ' new');
    d.innerHTML = `<img src="${url}" alt="Foto"><span>${saved ? '✓ guardada' : 'sin guardar'}</span><button type="button" class="x" aria-label="Quitar foto">✕</button>`;
    d.querySelector('img').onclick = () => { $('#viewerImg').src = url; $('#viewer').showModal(); };
    d.querySelector('.x').onclick = async () => {
      if (!(await confirmBox('Quitar fotografía', saved ? 'La foto se eliminará de este registro al guardar. ¿Continuar?' : '¿Quitar esta foto que aún no se ha guardado?', 'Quitar', 'danger'))) return;
      if (saved) state.removedPhotoIds.push(p.id); else state.newPhotos = state.newPhotos.filter(x => x !== p);
      markDirty(); renderThumbs();
    };
    box.appendChild(d);
  });
}

/* ---------- duplicados (informativo, no bloquea) ---------- */
function checkDup() {
  const lum = F().luminaria.value.trim().toUpperCase();
  const el = $('#dupInfo');
  if (!lum) { el.hidden = true; return; }
  const n = active().filter(r => r.luminaria === lum && (!state.editing || r.id !== state.editing.id)).length;
  el.hidden = !n;
  el.textContent = n ? `ℹ️ Ya hay ${n} registro(s) con la luminaria ${lum}. Se creará uno distinto con su propio ID único.` : '';
}

/* ---------- borrador ---------- */
let draftT;
function markDirty() { dirty = true; clearTimeout(draftT); draftT = setTimeout(saveDraft, 600); }
async function saveDraft() {
  if (!dirty || $('#view-form').hidden) return;
  const f = F(); const fields = {};
  FIELDS.forEach(k => (fields[k] = f[k].value));
  try {
    await DB.setMeta('draft', { editingId: state.editing ? state.editing.id : null, fields, coord: state.coord, newPhotos: state.newPhotos, removedPhotoIds: state.removedPhotoIds, at: nowIso() });
  } catch (e) { if (e.quota) $('#draftInfo').textContent = '⚠️ ' + e.message; }
}
async function clearDraft() { clearTimeout(draftT); dirty = false; try { await DB.delMeta('draft'); } catch (e) { } }

async function newRecord() {
  const draft = await DB.getMeta('draft');
  if (draft) {
    const target = draft.editingId ? state.records.find(r => r.id === draft.editingId) : null;
    const what = draft.editingId ? `la edición de ${esc(target ? target.consecutivo : 'un registro')}` : 'un registro nuevo';
    const r = await ask('Borrador sin terminar', `Hay ${what} sin guardar (${fmtDate(draft.at)}${draft.newPhotos && draft.newPhotos.length ? `, ${draft.newPhotos.length} foto(s)` : ''}).`, [
      { label: 'Descartar borrador', value: 'discard', kind: 'danger' }, { label: 'Continuar', value: 'resume', kind: 'primary' }]);
    if (r === 'resume') return openForm(target || null, draft);
    if (r !== 'discard') return;
    if (!(await confirmBox('Descartar borrador', 'Se perderá lo escrito y las fotos sin guardar del borrador. Los registros guardados no se tocan.', 'Descartar', 'danger'))) return;
    await clearDraft();
  }
  openForm(null);
}

/* ---------- guardar ---------- */
async function save(ev) {
  ev.preventDefault();
  const f = F();
  const lum = f.luminaria.value.trim().toUpperCase();
  if (!lum) { toast('Escriba el código de luminaria', 'err'); f.luminaria.focus(); return; }
  // números
  const vals = {};
  for (const k of NUMS) {
    const n = num(f[k].value);
    if (Number.isNaN(n)) { toast(`Valor no numérico en ${f[k].closest('label').firstChild.textContent.trim()}`, 'err'); f[k].focus(); return; }
    vals[k] = n;
  }
  // coordenadas
  let coord = null;
  const lat = num(f.lat.value), lon = num(f.lon.value);
  if (lat == null && lon == null) coord = { lat: null, lon: null, accuracy: null, source: null, status: 'pendiente', capturedAt: null };
  else {
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) { toast('Complete latitud y longitud con números, o deje ambas vacías (pendientes).', 'err'); f.lat.focus(); return; }
    if (sameAsCurrent(lat, lon)) coord = { ...state.coord, status: 'ok' };   // GPS o manual sin cambios: se conserva tal cual
    else coord = { lat, lon, accuracy: null, altitude: null, source: 'manual', capturedAt: nowIso(), status: 'ok' };
    const chk = Exporter.checkCoord(coord);
    if (chk.level === 'error') { toast(chk.msg, 'err'); f.lat.focus(); return; }
    if (chk.level === 'advertencia') {
      const btns = [{ label: 'Corregir', value: 'fix' }, { label: 'Guardar así', value: 'keep' }];
      if (/invertidas/.test(chk.msg)) btns.splice(1, 0, { label: 'Intercambiar lat/lon', value: 'swap', kind: 'primary' });
      const r = await ask('Revise las coordenadas', `<p>${esc(chk.msg)}.</p><p>Latitud: <b>${lat}</b><br>Longitud: <b>${lon}</b></p><p class="hint">En Colombia la latitud está entre −4 y 13 y la longitud es negativa (entre −82 y −67).</p>`, btns);
      if (r === 'swap') { coord.lat = lon; coord.lon = lat; state.coord = coord; fillCoordInputs(); }
      else if (r !== 'keep') return;
    }
  }
  const btn = $('#btnSave'); btn.disabled = true; btn.textContent = 'Guardando y verificando…';
  try {
    const now = nowIso();
    const base = state.editing || { id: uuid(), createdAt: now, brigada: state.settings.brigada, deleted: false };
    const rec = { ...base };
    FIELDS.forEach(k => { if (!NUMS.includes(k)) rec[k] = f[k].value.trim(); });
    Object.assign(rec, vals);
    rec.luminaria = lum;
    rec.arbolId = rec.arbolId.toUpperCase();
    rec.coord = coord;
    rec.updatedAt = now;
    const newPhotos = state.newPhotos.map(p => ({ ...p, recordId: rec.id, size: p.data.byteLength }));
    const keptSaved = state.savedPhotos.filter(p => !state.removedPhotoIds.includes(p.id)).length;
    rec.photoCount = keptSaved + newPhotos.length;
    const res = await DB.saveRecord(rec, newPhotos, state.removedPhotoIds);
    if (res.photoCount !== rec.photoCount) throw new Error(`Se esperaban ${rec.photoCount} fotos y se verificaron ${res.photoCount}. Revise el registro.`);
    await clearDraft();
    if (f.responsable.value.trim() && !state.settings.responsable) { state.settings.responsable = f.responsable.value.trim(); DB.setMeta('settings', state.settings); }
    await loadRecords();
    toast(`✓ ${res.record.consecutivo} guardado y verificado${res.photoCount ? ` (${res.photoCount} foto${res.photoCount > 1 ? 's' : ''})` : ''}${coord.status === 'pendiente' ? ' · coordenadas pendientes' : ''}`, 'ok');
    learnSpecies(rec);
    stopGps(); clearUrls();
    if (!state.persistAsked) { state.persistAsked = true; requestPersist(true); }
    show('list');
  } catch (e) {
    toast(e.message || String(e), 'err');
    if (e.quota) updateStorage();
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar registro';
  }
}

async function cancelForm() {
  if (dirty && !(await confirmBox('Cancelar', 'Se descartarán los cambios y fotos sin guardar de este formulario. Los datos ya guardados no se tocan.', 'Descartar cambios', 'danger'))) return;
  await clearDraft(); stopGps(); clearUrls(); show('list');
}

async function deleteRecord() {
  const r = state.editing; if (!r) return;
  const ok = await confirmBox('Eliminar registro', `¿Enviar a la papelera el registro <b>${esc(r.consecutivo)}</b> (luminaria ${esc(r.luminaria)})?<br><small>Podrá recuperarlo desde Respaldo › Papelera. Sus fotos se conservan.</small>`, 'Eliminar', 'danger');
  if (!ok) return;
  const cur = await DB.get('records', r.id);
  cur.deleted = true; cur.deletedAt = nowIso(); cur.updatedAt = nowIso();
  await DB.putRecordOnly(cur);
  await clearDraft(); await loadRecords(); toast('Registro enviado a la papelera'); show('list');
}

/* ---------- especies ---------- */
function learnSpecies(rec) {
  if (rec.especieComun && !SPECIES.some(s => s[0].toLowerCase() === rec.especieComun.toLowerCase())) SPECIES.push([rec.especieComun, rec.especieCientifica || '']);
  fillSpecies();
}
function fillSpecies() {
  $('#dlComun').innerHTML = SPECIES.map(s => `<option value="${esc(s[0])}">`).join('');
  $('#dlCient').innerHTML = [...new Set(SPECIES.map(s => s[1]).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('');
}

/* ================= exportación ================= */
async function gather() {
  await loadRecords();
  const recs = active().slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const byRec = new Map();
  for (const r of recs) byRec.set(r.id, await DB.photosOf(r.id));
  return { recs, byRec, ...Exporter.buildRows(recs, byRec) };
}
async function renderExportCheck() {
  const box = $('#exportCheck');
  box.innerHTML = 'Revisando registros…';
  const recs = active();
  const c = { ok: 0, pendiente: 0, advertencia: 0, error: 0 };
  const issues = [];
  for (const r of recs) {
    const k = Exporter.checkCoord(r.coord); c[k.level]++;
    if (k.level === 'advertencia' || k.level === 'error') issues.push(`${esc(r.consecutivo)} (lum. ${esc(r.luminaria)}): ${esc(k.msg)}`);
  }
  const photos = recs.reduce((s, r) => s + (r.photoCount || 0), 0);
  box.innerHTML = `<b>${recs.length}</b> registros · <b>${photos}</b> fotos<br>
    ✓ ${c.ok} con coordenadas válidas (${Exporter.CRS})<br>
    ${c.pendiente ? `⏳ <b>${c.pendiente}</b> con coordenadas pendientes: salen en Excel/CSV sin coordenadas y <b>no</b> aparecen en el KMZ.<br>` : ''}
    ${c.advertencia + c.error ? `⚠️ <b>${c.advertencia + c.error}</b> con alertas:<ul>${issues.slice(0, 10).map(i => `<li>${i}</li>`).join('')}${issues.length > 10 ? `<li>… y ${issues.length - 10} más</li>` : ''}</ul>` : ''}
    <small>Orden de columnas: Latitud, luego Longitud. En KMZ se escriben como longitud,latitud (estándar KML).</small>`;
}
async function doExport(kind) {
  const log = $('#exportLog');
  const btns = $$('[data-exp]'); btns.forEach(b => (b.disabled = true));
  try {
    const { recs, rows, photoRows } = await gather();
    if (!recs.length) { toast('No hay registros para exportar', 'err'); return; }
    const errs = rows.filter(r => r.chk.level === 'error' || r.chk.level === 'advertencia');
    if (errs.length && !(await confirmBox('Hay coordenadas con alertas', `${errs.length} registro(s) tienen alertas de coordenadas (fuera de Colombia o posiblemente invertidas). Se exportarán marcados en la columna «Alerta de validación»${kind === 'kmz' ? '; los no válidos no se incluyen en el KMZ' : ''}. ¿Continuar?`, 'Exportar igual'))) return;
    const st = Exporter.stamp();
    const base = `bitacora_campo_${st}`;
    let blob, name, note = '';
    if (kind === 'xlsx') { blob = await Exporter.excel(rows, photoRows); name = base + '.xlsx'; }
    if (kind === 'csv') { blob = Exporter.csv(Exporter.COLS, rows.map(r => r.values), 'std'); name = base + '.csv'; }
    if (kind === 'csv-es') { blob = Exporter.csv(Exporter.COLS, rows.map(r => r.values), 'es'); name = base + '_excel.csv'; }
    if (kind === 'kmz') {
      const res = await Exporter.kmz(rows, photoRows, $('#kmzPhotos').checked, `Bitácora Forestal ${Exporter.fmtDate(nowIso())}`);
      blob = res.blob; name = base + '.kmz';
      note = ` · ${res.placed} punto(s), ${res.photos} foto(s)` + (res.placed < recs.length ? ` · ${recs.length - res.placed} sin coordenadas válidas no incluidos` : '');
    }
    if (kind === 'zip') {
      if (!photoRows.length && !(await confirmBox('Sin fotografías', 'No hay fotos registradas. ¿Generar el ZIP solo con las tablas?', 'Generar'))) return;
      blob = await Exporter.photosZip(rows, photoRows); name = base + '_fotos.zip'; note = ` · ${photoRows.length} foto(s)`;
    }
    await deliver(blob, name);
    const line = document.createElement('div');
    line.textContent = `✓ ${name} (${bytes(blob.size)})${note}`;
    log.prepend(line);
    await DB.setMeta('lastExport', nowIso());
    toast('Archivo generado. Los registros siguen guardados.', 'ok');
  } catch (e) {
    toast('Error al exportar: ' + (e.message || e) + '. Sus datos no se modificaron.', 'err');
  } finally { btns.forEach(b => (b.disabled = false)); }
}

/* ================= respaldo ================= */
async function renderBackup() {
  const lb = await DB.getMeta('lastBackup');
  $('#lastBackup').innerHTML = lb ? `Última copia de seguridad: <b>${fmtDate(lb)}</b>` : '<span class="warntxt">Aún no se ha hecho ninguna copia de seguridad.</span>';
  $('#setBrigada').value = state.settings.brigada; $('#setResp').value = state.settings.responsable || ''; $('#setResize').checked = !!state.settings.resize;
  const del = state.records.filter(r => r.deleted);
  $('#trash').innerHTML = del.length ? del.map(r => `<li class="item"><div class="itop"><b>${esc(r.consecutivo)}</b> · Lum. ${esc(r.luminaria)}<span class="idate">eliminado ${fmtDate(r.deletedAt)}</span></div>
    <div class="row"><button class="btn small" data-restore="${esc(r.id)}">Recuperar</button><button class="btn small danger" data-purge="${esc(r.id)}">Borrar definitivamente</button></div></li>`).join('') : '<li class="hint">La papelera está vacía.</li>';
  $('#version').textContent = 'Versión ' + APP_VERSION + ' · Los datos se guardan solo en este dispositivo.';
  updateStorage(); checkOfflineReady();
}
async function makeBackup() {
  const btn = $('#btnBackup'); btn.disabled = true; btn.textContent = 'Generando copia…';
  try {
    const records = await DB.getAll('records');
    const photos = await DB.getAll('photos');
    const meta = { seq: await DB.getMeta('seq', 0), settings: state.settings, app: APP_VERSION };
    const blob = await Exporter.backup(records, photos, meta);
    // Verificar la copia antes de entregarla
    const check = await Exporter.parseBackup(blob);
    if (check.data.records.length !== records.length || check.photos.length !== photos.length) throw new Error('La copia generada no pasó la verificación.');
    const name = `respaldo_bitacora_${state.settings.brigada}_${Exporter.stamp()}.zip`;
    download(blob, name);
    await DB.setMeta('lastBackup', nowIso());
    toast(`✓ Copia verificada: ${records.length} registros, ${photos.length} fotos (${bytes(blob.size)})`, 'ok');
    renderBackup();
  } catch (e) { toast('No se pudo crear la copia: ' + (e.message || e), 'err'); }
  finally { btn.disabled = false; btn.textContent = '💾 Crear copia de seguridad'; }
}
async function restore(file) {
  try {
    const { data, photos, missing } = await Exporter.parseBackup(file);
    const ok = await confirmBox('Restaurar copia', `La copia del <b>${fmtDate(data.createdAt)}</b> contiene <b>${data.records.length}</b> registros y <b>${data.photos.length}</b> fotos.${missing.length ? `<br>⚠️ ${missing.length} foto(s) dañadas o faltantes en la copia no se restaurarán.` : ''}<br><br>No se borrará nada de lo que ya hay en el dispositivo.`, 'Restaurar');
    if (!ok) return;
    const res = await DB.mergeBackup(data.records, photos, (data.meta && data.meta.seq) || 0);
    // recalcular conteo de fotos verificado
    await loadRecords();
    for (const r of state.records) {
      const n = (await DB.photosOf(r.id)).length;
      if (r.photoCount !== n) { r.photoCount = n; await DB.putRecordOnly(r); }
    }
    await loadRecords();
    await ask('Restauración terminada', `Registros agregados: <b>${res.added}</b><br>Actualizados (la copia era más reciente): <b>${res.updated}</b><br>Sin cambios: <b>${res.skipped}</b><br>Fotos agregadas: <b>${res.photosAdded}</b>`, [{ label: 'Aceptar', value: 'ok', kind: 'primary' }]);
    renderBackup();
  } catch (e) { toast('No se pudo restaurar: ' + (e.message || e), 'err'); }
}

/* ================= inicio ================= */
async function init() {
  updateNet();
  addEventListener('online', updateNet); addEventListener('offline', updateNet);
  try { await DB.open(); }
  catch (e) { document.body.innerHTML = `<p style="padding:20px">No se pudo abrir el almacenamiento local: ${esc(e.message)}. Si está en modo incógnito, abra la aplicación en una ventana normal.</p>`; return; }

  const s = await DB.getMeta('settings');
  if (s) state.settings = { ...state.settings, ...s };
  if (!state.settings.brigada) {
    state.settings.brigada = 'B' + Math.random().toString(36).slice(2, 5).toUpperCase();
    await DB.setMeta('settings', state.settings);
  }
  await loadRecords();
  fillSpecies();
  state.records.filter(r => r.especieComun).forEach(r => learnSpecies(r));

  // navegación
  $$('.tabs button').forEach(b => b.onclick = () => b.dataset.view === 'form' ? (!$('#view-form').hidden ? null : newRecord()) : show(b.dataset.view));
  $('#list').onclick = e => { const li = e.target.closest('.item'); if (li) { const r = state.records.find(x => x.id === li.dataset.id); if (r) editRecord(r); } };
  $('#list').onkeydown = e => { if (e.key === 'Enter') $('#list').onclick(e); };
  $('#q').oninput = e => { state.query = e.target.value; renderList(); };
  $('#filters').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; state.filter = c.dataset.f; $$('#filters .chip').forEach(x => x.classList.toggle('on', x === c)); renderList(); };

  // formulario
  const f = F();
  $('#form').addEventListener('submit', save);
  $('#form').addEventListener('input', e => {
    if (e.target.name === 'lat' || e.target.name === 'lon') return onCoordTyped();
    if (e.target.name === 'luminaria') checkDup();
    if (e.target.name === 'cap') { const c = num(f.cap.value); if (c && !Number.isNaN(c)) f.dap.value = (c / Math.PI).toFixed(1); }
    if (e.target.name === 'especieComun') { const sp = SPECIES.find(x => x[0].toLowerCase() === f.especieComun.value.trim().toLowerCase()); if (sp && !f.especieCientifica.value) f.especieCientifica.value = sp[1]; }
    markDirty();
  });
  $('#form').addEventListener('change', markDirty);
  $('#btnGps').onclick = startGps;
  $('#btnGpsStop').onclick = () => state.gps && state.gps.finish();
  $('#btnClearCoord').onclick = async () => {
    if (!state.coord) return;
    if (await confirmBox('Borrar coordenadas', 'Las coordenadas de este registro quedarán como pendientes. ¿Continuar?', 'Borrar', 'danger')) { state.coord = null; fillCoordInputs(); markDirty(); }
  };
  $('#camIn').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#galIn').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#btnCancel').onclick = cancelForm;
  $('#btnDelete').onclick = deleteRecord;

  // exportar y respaldo
  $$('[data-exp]').forEach(b => b.addEventListener('click', e => { if (e.target.closest('label.inline')) return; doExport(b.dataset.exp); }));
  $('#btnBackup').onclick = makeBackup;
  $('#restoreIn').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) restore(file); };
  $('#btnPersist').onclick = () => requestPersist(false);
  $('#btnCheckOffline').onclick = async () => toast((await checkOfflineReady()) ? '✓ Lista para trabajar sin conexión' : 'Aún no está lista: abra la app con conexión una vez más', 'ok');
  $('#btnSaveSettings').onclick = async () => {
    const b = $('#setBrigada').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!b) { toast('El código de brigada no puede quedar vacío', 'err'); return; }
    state.settings = { brigada: b, responsable: $('#setResp').value.trim(), resize: $('#setResize').checked };
    await DB.setMeta('settings', state.settings); toast('Ajustes guardados ✓', 'ok');
  };
  $('#trash').onclick = async e => {
    const rid = e.target.dataset.restore, pid = e.target.dataset.purge;
    if (rid) { const r = await DB.get('records', rid); r.deleted = false; r.deletedAt = null; r.updatedAt = nowIso(); await DB.putRecordOnly(r); await loadRecords(); renderBackup(); toast('Registro recuperado ✓', 'ok'); }
    if (pid) {
      const r = state.records.find(x => x.id === pid);
      if (!(await confirmBox('Borrar definitivamente', `El registro <b>${esc(r.consecutivo)}</b> y sus ${r.photoCount || 0} foto(s) se borrarán para siempre de este dispositivo. Esta acción no se puede deshacer.`, 'Borrar para siempre', 'danger'))) return;
      await DB.purgeRecord(pid); await loadRecords(); renderBackup(); toast('Registro borrado definitivamente');
    }
  };
  addEventListener('pagehide', () => { if (dirty) saveDraft(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); });

  renderList();
  setupSW();
  updateStorage();
  // Si quedó un borrador (p. ej. el celular cerró la app al abrir la cámara), avisar
  const draft = await DB.getMeta('draft');
  if (draft) toast('Tiene un registro sin terminar. Toque «Nuevo» para continuarlo.');
}
async function editRecord(r) {
  const draft = await DB.getMeta('draft');
  if (draft && draft.editingId === r.id) return openForm(r, draft);
  if (draft) {
    const ok = await confirmBox('Borrador pendiente', 'Hay otro registro sin terminar. Si abre este, ese borrador se descartará.', 'Descartar y abrir', 'danger');
    if (!ok) return;
    await clearDraft();
  }
  openForm(r);
}
init();
