/* Exportaciones 100 % locales: Excel (.xlsx), CSV, KMZ, ZIP de fotos y copia de seguridad. */
'use strict';
const Exporter = (() => {
  const COLS = [
    { key: 'id', header: 'ID único', type: 'text', w: 38 },
    { key: 'consecutivo', header: 'N.º registro', type: 'text', w: 15 },
    { key: 'createdAt', header: 'Fecha registro', type: 'date', w: 19 },
    { key: 'updatedAt', header: 'Última modificación', type: 'date', w: 19 },
    { key: 'luminaria', header: 'Código luminaria', type: 'text', w: 16 },
    { key: 'arbolId', header: 'ID árbol', type: 'text', w: 12 },
    { key: 'especieComun', header: 'Nombre común', type: 'text', w: 20 },
    { key: 'especieCientifica', header: 'Nombre científico', type: 'text', w: 24 },
    { key: 'cap', header: 'CAP (cm)', type: 'dec', w: 10 },
    { key: 'dap', header: 'DAP (cm)', type: 'dec', w: 10 },
    { key: 'altura', header: 'Altura total (m)', type: 'dec', w: 14 },
    { key: 'alturaFuste', header: 'Altura fuste (m)', type: 'dec', w: 14 },
    { key: 'diametroCopa', header: 'Diámetro copa (m)', type: 'dec', w: 15 },
    { key: 'estado', header: 'Estado fitosanitario', type: 'text', w: 18 },
    { key: 'interferencia', header: 'Interferencia con luminaria', type: 'text', w: 22 },
    { key: 'tratamiento', header: 'Tratamiento recomendado', type: 'text', w: 22 },
    { key: 'emplazamiento', header: 'Emplazamiento', type: 'text', w: 15 },
    { key: 'comuna', header: 'Comuna', type: 'text', w: 12 },
    { key: 'barrio', header: 'Barrio / vereda', type: 'text', w: 18 },
    { key: 'direccion', header: 'Dirección / referencia', type: 'text', w: 28 },
    { key: 'lat', header: 'Latitud', type: 'coord', w: 13 },
    { key: 'lon', header: 'Longitud', type: 'coord', w: 13 },
    { key: 'accuracy', header: 'Precisión estimada (m)', type: 'dec', w: 13 },
    { key: 'coordSource', header: 'Origen coordenada', type: 'text', w: 15 },
    { key: 'coordStatus', header: 'Estado coordenada', type: 'text', w: 15 },
    { key: 'coordAt', header: 'Fecha coordenada', type: 'date', w: 19 },
    { key: 'crs', header: 'Sistema de referencia', type: 'text', w: 20 },
    { key: 'responsable', header: 'Responsable', type: 'text', w: 20 },
    { key: 'nFotos', header: 'N.º fotos', type: 'int', w: 9 },
    { key: 'archivosFotos', header: 'Archivos de fotos', type: 'text', w: 40 },
    { key: 'observaciones', header: 'Observaciones', type: 'text', w: 40 },
    { key: 'alerta', header: 'Alerta de validación', type: 'text', w: 30 }
  ];
  const CRS = 'WGS84 (EPSG:4326)';

  // Límites aproximados de Colombia (continental + San Andrés) para detectar errores
  const CO = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function stamp() { return fmtDate(new Date().toISOString()).replace(/[-:]/g, '').replace(' ', '_').slice(0, 13); }
  function safe(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'SN';
  }

  /** Valida una coordenada. Devuelve {level:'ok'|'pendiente'|'advertencia'|'error', msg} */
  function checkCoord(c) {
    if (!c || c.status === 'pendiente' || c.lat == null || c.lon == null) return { level: 'pendiente', msg: 'Coordenadas pendientes' };
    const { lat, lon } = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { level: 'error', msg: 'Coordenada no numérica' };
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { level: 'error', msg: 'Coordenada fuera de rango geográfico (posible inversión latitud/longitud)' };
    if (lat === 0 && lon === 0) return { level: 'error', msg: 'Coordenada 0,0 (no válida)' };
    const inCO = (a, b) => a >= CO.latMin && a <= CO.latMax && b >= CO.lonMin && b <= CO.lonMax;
    if (!inCO(lat, lon)) {
      if (inCO(lon, lat)) return { level: 'advertencia', msg: 'Latitud y longitud parecen invertidas' };
      return { level: 'advertencia', msg: 'Coordenada fuera de Colombia' };
    }
    return { level: 'ok', msg: '' };
  }

  /** Aplana registros + fotos a filas de exportación. */
  function buildRows(records, photosByRecord) {
    const photoRows = [];
    const rows = records.map(r => {
      const c = r.coord || {};
      const chk = checkCoord(c);
      const photos = photosByRecord.get(r.id) || [];
      const files = photos.map((p, i) => {
        const ext = (p.type || '').includes('png') ? 'png' : (p.type || '').includes('webp') ? 'webp' : 'jpg';
        const file = `${safe(r.consecutivo)}_LUM-${safe(r.luminaria)}_F${String(i + 1).padStart(2, '0')}.${ext}`;
        photoRows.push({ file, photo: p, record: r, n: i + 1 });
        return file;
      });
      const hasCoord = chk.level !== 'pendiente' && chk.level !== 'error';
      return {
        record: r, chk, files,
        values: {
          id: r.id, consecutivo: r.consecutivo, createdAt: r.createdAt, updatedAt: r.updatedAt,
          luminaria: r.luminaria, arbolId: r.arbolId, especieComun: r.especieComun, especieCientifica: r.especieCientifica,
          cap: r.cap, dap: r.dap, altura: r.altura, alturaFuste: r.alturaFuste, diametroCopa: r.diametroCopa,
          estado: r.estado, interferencia: r.interferencia, tratamiento: r.tratamiento, emplazamiento: r.emplazamiento,
          comuna: r.comuna, barrio: r.barrio, direccion: r.direccion,
          lat: hasCoord ? c.lat : null, lon: hasCoord ? c.lon : null,
          accuracy: hasCoord ? c.accuracy : null,
          coordSource: c.source === 'gps' ? 'GPS del dispositivo' : c.source === 'manual' ? 'Ingreso manual' : '',
          coordStatus: chk.level === 'pendiente' ? 'PENDIENTE' : chk.level === 'error' ? 'NO VÁLIDA' : 'Registrada',
          coordAt: hasCoord ? c.capturedAt : '',
          crs: hasCoord ? CRS : '',
          responsable: r.responsable, nFotos: photos.length, archivosFotos: files.join(' | '),
          observaciones: r.observaciones, alerta: chk.msg
        }
      };
    });
    return { rows, photoRows };
  }

  /* ---------------- XLSX ---------------- */
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function x(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sheetXml(cols, objs) {
    const STY = { header: 1, coord: 2, dec: 3, int: 4 };
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    out += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    out += '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('') + '</cols><sheetData>';
    out += '<row r="1">' + cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${STY.header}"><is><t>${x(c.header)}</t></is></c>`).join('') + '</row>';
    objs.forEach((o, ri) => {
      const r = ri + 2;
      out += `<row r="${r}">`;
      cols.forEach((c, ci) => {
        let v = o[c.key];
        const ref = colName(ci) + r;
        if (v === null || v === undefined || v === '') return;
        if (c.type === 'coord' || c.type === 'dec' || c.type === 'int') {
          const n = Number(v);
          if (Number.isFinite(n)) { out += `<c r="${ref}" s="${STY[c.type]}"><v>${n}</v></c>`; return; }
        }
        if (c.type === 'date') v = fmtDate(v);
        out += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
      });
      out += '</row>';
    });
    out += '</sheetData>';
    if (objs.length) out += `<autoFilter ref="A1:${colName(cols.length - 1)}${objs.length + 1}"/>`;
    return out + '</worksheet>';
  }
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.000000"/><numFmt numFmtId="165" formatCode="0.0#"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4D2E"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  async function xlsx(sheets) {
    const files = [];
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
      (sheets.some(s => s.rows.length) ? '<definedNames>' + sheets.map((s, i) => s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(s.name)}'!$A$1:$${colName(s.cols.length - 1)}$${s.rows.length + 1}</definedName>` : '').join('') + '</definedNames>' : '') +
      '</workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    files.push({ name: 'xl/styles.xml', data: STYLES });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.cols, s.rows) }));
    return ZipLib.build(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  const PHOTO_COLS = [
    { key: 'archivo', header: 'Archivo de foto', type: 'text', w: 44 },
    { key: 'carpeta', header: 'Ruta en el ZIP', type: 'text', w: 52 },
    { key: 'n', header: 'Foto N.º', type: 'int', w: 8 },
    { key: 'recordId', header: 'ID único del registro', type: 'text', w: 38 },
    { key: 'consecutivo', header: 'N.º registro', type: 'text', w: 15 },
    { key: 'luminaria', header: 'Código luminaria', type: 'text', w: 16 },
    { key: 'arbolId', header: 'ID árbol', type: 'text', w: 12 },
    { key: 'fotoId', header: 'ID único de la foto', type: 'text', w: 38 },
    { key: 'tomada', header: 'Fecha foto', type: 'date', w: 19 },
    { key: 'kb', header: 'Tamaño (KB)', type: 'int', w: 11 }
  ];
  function photoObjs(photoRows) {
    return photoRows.map(p => ({
      archivo: p.file, carpeta: 'fotos/' + p.file, n: p.n, recordId: p.record.id, consecutivo: p.record.consecutivo,
      luminaria: p.record.luminaria, arbolId: p.record.arbolId, fotoId: p.photo.id, tomada: p.photo.createdAt,
      kb: Math.round((p.photo.data.byteLength || 0) / 1024)
    }));
  }

  async function excel(rows, photoRows) {
    return xlsx([
      { name: 'Registros', cols: COLS, rows: rows.map(r => r.values) },
      { name: 'Fotos', cols: PHOTO_COLS, rows: photoObjs(photoRows) }
    ]);
  }

  /* ---------------- CSV ---------------- */
  function csv(cols, objs, mode) {
    // mode 'std': coma + punto decimal (universal, SIG). mode 'es': punto y coma + coma decimal (Excel en español).
    const sep = mode === 'es' ? ';' : ',';
    const q = v => {
      const s = String(v);
      return /[",;\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const cell = (c, v) => {
      if (v === null || v === undefined || v === '') return '';
      if (c.type === 'date') return q(fmtDate(v));
      if (c.type === 'coord' || c.type === 'dec' || c.type === 'int') {
        const n = Number(v);
        if (!Number.isFinite(n)) return q(v);
        const s = c.type === 'coord' ? n.toFixed(7).replace(/0+$/, '').replace(/\.$/, '') : String(n);
        return mode === 'es' ? s.replace('.', ',') : s;
      }
      const s = String(v);
      // En Excel español, conservar ceros a la izquierda de códigos numéricos
      if (mode === 'es' && /^0\d+$/.test(s)) return '"=""' + s + '"""';
      return q(s);
    };
    const lines = [cols.map(c => q(c.header)).join(sep)];
    for (const o of objs) lines.push(cols.map(c => cell(c, o[c.key])).join(sep));
    return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  }

  /* ---------------- KMZ ---------------- */
  async function markerPng() {
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fillStyle = '#2E9E44'; g.fill();
      g.lineWidth = 6; g.strokeStyle = '#FFFFFF'; g.stroke();
      const b = await new Promise(r => cv.toBlob(r, 'image/png'));
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    } catch (e) { return null; }
  }
  function h(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/]]>/g, ']]&gt;'); }

  async function kmz(rows, photoRows, withPhotos, title) {
    const icon = await markerPng();
    const files = [];
    const valid = rows.filter(r => r.chk.level === 'ok' || r.chk.level === 'advertencia');
    const validIds = new Set(valid.map(r => r.record.id));
    const photoMap = new Map();
    if (withPhotos) for (const p of photoRows) {
      if (!validIds.has(p.record.id)) continue;
      const arr = photoMap.get(p.record.id) || []; arr.push(p); photoMap.set(p.record.id, arr);
    }
    const labels = { luminaria: 'Código luminaria', arbolId: 'ID árbol', consecutivo: 'N.º registro', especieComun: 'Nombre común', especieCientifica: 'Nombre científico', cap: 'CAP (cm)', dap: 'DAP (cm)', altura: 'Altura total (m)', alturaFuste: 'Altura fuste (m)', diametroCopa: 'Diámetro copa (m)', estado: 'Estado fitosanitario', interferencia: 'Interferencia con luminaria', tratamiento: 'Tratamiento recomendado', emplazamiento: 'Emplazamiento', comuna: 'Comuna', barrio: 'Barrio / vereda', direccion: 'Dirección', lat: 'Latitud', lon: 'Longitud', accuracy: 'Precisión estimada (m)', coordSource: 'Origen coordenada', responsable: 'Responsable', createdAt: 'Fecha registro', observaciones: 'Observaciones', alerta: 'Alerta', id: 'ID único' };

    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${h(title)}</name>` +
      `<description>${h('Generado sin conexión por Bitácora Forestal · Campo. Coordenadas ' + CRS + '. Precisión según GPS del dispositivo; no es levantamiento topográfico.')}</description>` +
      `<Style id="arbol"><IconStyle><scale>0.9</scale><Icon><href>${icon ? 'files/marcador.png' : 'http://maps.google.com/mapfiles/kml/paddle/grn-circle.png'}</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><LabelStyle><color>ffffffff</color><scale>0.8</scale></LabelStyle></Style>` +
      `<Folder><name>Árboles (${valid.length})</name>`;
    for (const r of valid) {
      const v = r.values;
      const name = `${v.luminaria || 'SIN LUM'} - ${v.arbolId || v.consecutivo}`;
      const tableRows = Object.keys(labels).filter(k => v[k] !== null && v[k] !== undefined && v[k] !== '')
        .map(k => `<tr><td style="color:#555;padding:2px 8px 2px 0;vertical-align:top"><b>${h(labels[k])}</b></td><td>${h(['createdAt'].includes(k) ? fmtDate(v[k]) : v[k])}</td></tr>`).join('');
      const imgs = (photoMap.get(r.record.id) || []).map(p => `<p><img src="files/${h(p.file)}" width="360"/><br/><small>${h(p.file)}</small></p>`).join('');
      const desc = `<table style="font-family:Arial;font-size:12px">${tableRows}</table>${imgs}`;
      const ext = Object.keys(labels).filter(k => v[k] !== null && v[k] !== undefined && v[k] !== '')
        .map(k => `<Data name="${h(labels[k])}"><value>${h(k === 'createdAt' ? fmtDate(v[k]) : v[k])}</value></Data>`).join('');
      kml += `<Placemark><name>${h(name)}</name><styleUrl>#arbol</styleUrl><description><![CDATA[${desc}]]></description>` +
        `<ExtendedData>${ext}</ExtendedData><Point><coordinates>${v.lon},${v.lat},0</coordinates></Point></Placemark>`;
    }
    kml += '</Folder></Document></kml>';
    files.push({ name: 'doc.kml', data: kml });
    if (icon) files.push({ name: 'files/marcador.png', data: icon });
    for (const arr of photoMap.values()) for (const p of arr) files.push({ name: 'files/' + p.file, data: new Uint8Array(p.photo.data) });
    return { blob: await ZipLib.build(files, 'application/vnd.google-earth.kmz'), placed: valid.length, photos: [...photoMap.values()].reduce((s, a) => s + a.length, 0) };
  }

  /* ---------------- ZIP de fotos ---------------- */
  async function photosZip(rows, photoRows) {
    const objs = photoObjs(photoRows);
    const files = photoRows.map(p => ({ name: 'fotos/' + p.file, data: new Uint8Array(p.photo.data), date: new Date(p.photo.createdAt) }));
    files.push({ name: 'relacion_fotos.csv', data: csv(PHOTO_COLS, objs, 'std') });
    files.push({ name: 'relacion_fotos_excel_es.csv', data: csv(PHOTO_COLS, objs, 'es') });
    files.push({ name: 'registros_y_fotos.xlsx', data: await excel(rows, photoRows) });
    files.push({ name: 'LEAME.txt', data: 'Carpeta "fotos": imágenes del trabajo de campo.\r\nCada archivo se nombra N.º registro + código de luminaria + número de foto.\r\nUse "relacion_fotos.csv" o la hoja "Fotos" de "registros_y_fotos.xlsx" para relacionar cada imagen con su registro mediante el ID único (columna "ID único del registro").\r\nCoordenadas en ' + CRS + '.\r\n' });
    return ZipLib.build(files);
  }

  /* ---------------- Copia de seguridad ---------------- */
  const BACKUP_FORMAT = 'bitacora-forestal-respaldo';
  async function backup(records, photos, meta) {
    const files = [];
    const photoMeta = photos.map(p => {
      const ext = (p.type || '').includes('png') ? 'png' : (p.type || '').includes('webp') ? 'webp' : 'jpg';
      const file = `fotos/${p.id}.${ext}`;
      files.push({ name: file, data: new Uint8Array(p.data) });
      return { id: p.id, recordId: p.recordId, type: p.type, name: p.name, createdAt: p.createdAt, size: p.data.byteLength, file };
    });
    const json = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), meta, records, photos: photoMeta };
    files.unshift({ name: 'respaldo.json', data: JSON.stringify(json) });
    return ZipLib.build(files);
  }
  async function parseBackup(file) {
    const entries = await ZipLib.read(file);
    const j = entries.get('respaldo.json');
    if (!j) throw new Error('Este archivo no es una copia de seguridad de Bitácora Forestal (falta respaldo.json).');
    const data = JSON.parse(ZipLib.decode(j));
    if (data.format !== BACKUP_FORMAT) throw new Error('Formato de copia de seguridad no reconocido.');
    const photos = [];
    const missing = [];
    for (const p of data.photos) {
      const bytes = entries.get(p.file);
      if (!bytes || bytes.byteLength !== p.size) { missing.push(p.file); continue; }
      photos.push({ id: p.id, recordId: p.recordId, type: p.type, name: p.name, createdAt: p.createdAt, data: bytes.slice().buffer });
    }
    return { data, photos, missing };
  }

  return { COLS, PHOTO_COLS, CRS, checkCoord, buildRows, excel, csv, kmz, photosZip, backup, parseBackup, stamp, fmtDate };
})();
