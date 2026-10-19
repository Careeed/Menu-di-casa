/**
 * Menu di casa - backend Google Apps Script
 * Script collegato al foglio Google (Estensioni > Apps Script).
 * Protocollo: POST con corpo JSON (Content-Type text/plain, evita il preflight CORS)
 *   { token, action, sheet, rows, ids, ifUpdatedAt }
 * Azioni: ping, getAll, upsert, delete
 */

const SCHEMA = {
  Pasti: ['id', 'nome', 'categoria', 'ingredienti', 'proteina', 'carbo', 'contorno', 'note', 'attivo', 'updatedAt'],
  Menu: ['id', 'data', 'slot', 'pastoId', 'nome', 'bloccato', 'preparato', 'updatedAt'],
  Spesa: ['id', 'nome', 'spuntato', 'origine', 'updatedAt'],
  Impostazioni: ['id', 'valore', 'updatedAt']
};

// ---------- Setup (da eseguire una volta a mano) ----------
function setup() {
  Object.keys(SCHEMA).forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (sheet_('Pasti').getLastRow() < 2) {
    const now = new Date().toISOString();
    [
      ['Riso e uova con zucchine', 'entrambi', 'riso, uova, zucchine, olio extravergine', 'uova', 'riso', 'zucchine'],
      ['Pasta al pomodoro e parmigiano', 'pranzo', 'pasta, passata di pomodoro, parmigiano', 'formaggio', 'pasta', 'pomodoro'],
      ['Pollo con riso e verdure', 'entrambi', 'petto di pollo, riso, verdure miste', 'pollo', 'riso', 'verdure miste'],
      ['Tacchino con patate e funghi', 'cena', 'fettine di tacchino, patate, funghi', 'tacchino', 'patate', 'funghi'],
      ['Pesce con patate e verdure', 'cena', 'filetto di pesce, patate, verdure', 'pesce', 'patate', 'verdure'],
      ['Frittata con contorno e pane', 'cena', 'uova, pane, insalata', 'uova', 'pane', 'insalata'],
      ['Pasta con tonno e pomodoro', 'pranzo', 'pasta, tonno, pomodoro', 'pesce', 'pasta', 'pomodoro']
    ].forEach(function (r, i) {
      sheet_('Pasti').appendRow(['seed' + (i + 1)].concat(r.slice(0, 1), r.slice(1), ['', '1', now]).slice(0, 10));
    });
  }
  if (sheet_('Impostazioni').getLastRow() < 2) {
    const now = new Date().toISOString();
    [['esclusi', 'latte, lattosio'], ['graditi', ''], ['nonGraditi', ''], ['allergie', ''], ['legumi', '0'], ['rev', '0']]
      .forEach(function (r) { sheet_('Impostazioni').appendRow([r[0], r[1], now]); });
  }
  Logger.log('TOKEN: ' + props.getProperty('TOKEN'));
}

// ---------- Endpoint ----------
function doGet() {
  return json_({ ok: true, name: 'Menu di casa', hint: 'Usa POST' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || !safeEq_(String(req.token || ''), token)) return json_({ ok: false, error: 'unauthorized' });

    if (req.action === 'ping') return json_({ ok: true, now: new Date().toISOString() });
    if (req.action === 'getAll') return json_({ ok: true, data: getAll_(), serverTime: new Date().toISOString() });

    if (req.action === 'upsert' || req.action === 'delete') {
      if (!SCHEMA[req.sheet]) return json_({ ok: false, error: 'bad_sheet' });
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
      try {
        const out = req.action === 'upsert' ? upsert_(req.sheet, req.rows || []) : delete_(req.sheet, req.ids || []);
        bumpRev_();
        return json_({ ok: true, result: out, serverTime: new Date().toISOString() });
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ ok: false, error: 'bad_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- Logica ----------
function getAll_() {
  const out = {};
  Object.keys(SCHEMA).forEach(function (n) { out[n] = read_(n); });
  return out;
}

/** Upsert per id. Se la riga ha ifUpdatedAt e la versione sul foglio e' diversa -> conflitto (non scrive). */
function upsert_(name, rows) {
  const sh = sheet_(name), head = SCHEMA[name];
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const stamps = last > 1 ? sh.getRange(2, head.length, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const now = new Date().toISOString();
  const saved = [], conflicts = [], toAppend = [];
  rows.forEach(function (row) {
    if (!row.id) return;
    const idx = ids.indexOf(String(row.id));
    if (idx >= 0 && row.ifUpdatedAt && stamps[idx] !== String(row.ifUpdatedAt)) {
      conflicts.push(row.id);
      return;
    }
    row.updatedAt = now;
    const values = head.map(function (h) { return row[h] === undefined || row[h] === null ? '' : String(row[h]); });
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, head.length).setValues([values]);
      stamps[idx] = now;
    } else {
      toAppend.push(values);
      ids.push(String(row.id));
      stamps.push(now);
    }
    saved.push({ id: row.id, updatedAt: now });
  });
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, head.length).setValues(toAppend);
  return { saved: saved, conflicts: conflicts };
}

function delete_(name, idList) {
  const sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return { deleted: 0 };
  const set = {};
  idList.forEach(function (i) { set[String(i)] = true; });
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  let n = 0;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (set[String(ids[i][0])]) { sh.deleteRow(i + 2); n++; }
  }
  return { deleted: n };
}

function bumpRev_() {
  const sh = sheet_('Impostazioni'), last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === 'rev') {
      const c = sh.getRange(i + 2, 2);
      c.setValue(String((parseInt(c.getValue(), 10) || 0) + 1));
      return;
    }
  }
  sh.appendRow(['rev', '1', new Date().toISOString()]);
}

// ---------- Utilita ----------
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const head = SCHEMA[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@'); // niente conversioni automatiche di date e numeri
  }
  return sh;
}

function read_(name) {
  const sh = sheet_(name), head = SCHEMA[name], last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, head.length).getValues().map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = String(r[i]); });
    return o;
  });
}

function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
