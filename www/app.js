'use strict';
/* Menu di casa - frontend. Dati condivisi su Google Sheets via Apps Script; localStorage solo come cache/coda offline. */
const $ = s => document.querySelector(s);
const LS = (k, v) => v === undefined ? JSON.parse(localStorage.getItem(k) || 'null') : localStorage.setItem(k, JSON.stringify(v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const SL = ['pranzo', 'cena'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
const mondayOf = d => addDays(d, -dow(d));
const fmt = (d, o) => new Date(d + 'T12:00:00Z').toLocaleDateString('it-IT', Object.assign({ timeZone: 'UTC' }, o));

let cfg = LS('cfg') || { url: '', token: '' };
let S = LS('cache') || { Pasti: [], Menu: [], Spesa: [], Impostazioni: [] };
let Q = LS('queue') || [];
let view = 'menu', weekStart = mondayOf(today()), filter = 'todo', sync = { state: 'idle' }, busy = false;

/* ---------- icone ---------- */
const P = {
  menu: 'M4 11l8-7 8 7M6 10v10h12V10', week: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11', cart: 'M3 4h2l2.5 11h10L20 8H6M10 20h.01M17 20h.01',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4', left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3', check: 'M5 12l5 5 9-10'
};
const ic = (n, c) => `<svg class="ic ${c || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;

/* ---------- dati e sincronizzazione ---------- */
const persist = () => { LS('cache', S); LS('queue', Q); };
let kt; const kick = () => { clearTimeout(kt); kt = setTimeout(() => syncNow(), 400); };
function putMany(sheet, rows) {
  const chk = sheet === 'Menu' || sheet === 'Pasti';
  const out = rows.map(row => {
    const a = S[sheet], i = a.findIndex(r => r.id === row.id);
    const m = Object.assign({}, i < 0 ? {} : a[i], row);
    if (i < 0) a.push(m); else a[i] = m;
    return Object.assign({}, m, { ifUpdatedAt: chk && i >= 0 ? (m.updatedAt || '') : '' });
  });
  Q.push({ action: 'upsert', sheet, rows: out }); persist(); kick();
}
const put = (sheet, row) => putMany(sheet, [row]);
function del(sheet, ids) { S[sheet] = S[sheet].filter(r => ids.indexOf(r.id) < 0); Q.push({ action: 'delete', sheet, ids }); persist(); kick(); }

async function api(body) {
  const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: cfg.token }, body)) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'errore');
  return j;
}
async function syncNow(manual) {
  if (!cfg.url || busy) return;
  busy = true; setSync('work');
  try {
    let conflicts = 0;
    const before = JSON.stringify(S);
    while (Q.length) {
      const op = Q[0], j = await api(op);
      Q.shift();
      if (op.action === 'upsert') {
        conflicts += j.result.conflicts.length;
        j.result.saved.forEach(s => {
          const r = S[op.sheet].find(x => x.id === s.id); if (r) r.updatedAt = s.updatedAt;
          Q.forEach(o => o.rows && o.sheet === op.sheet && o.rows.forEach(x => { if (x.id === s.id && x.ifUpdatedAt) x.ifUpdatedAt = s.updatedAt; }));
        });
      }
      persist();
    }
    const j = await api({ action: 'getAll' });
    if (!Q.length) { S = j.data; persist(); }
    setSync('ok');
    if (conflicts) toast('Alcune modifiche erano già cambiate sull’altro telefono');
    else if (manual) toast('Modifiche sincronizzate');
    if (JSON.stringify(S) !== before && !(document.activeElement && document.activeElement.matches('#app input'))) render();
  } catch (e) { setSync(e.message === 'unauthorized' ? 'auth' : 'off'); }
  finally { busy = false; }
}
const syncText = () => ({ work: 'Sincronizzo…', ok: 'Sincronizzato', auth: 'Codice non valido', off: Q.length ? 'Offline · modifiche salvate' : 'Offline', idle: Q.length ? 'In attesa' : 'Pronto' }[sync.state]);
function setSync(s) { sync.state = s; document.querySelectorAll('.sync').forEach(b => { b.className = 'sync ' + s; b.querySelector('span').textContent = syncText(); }); }

/* ---------- impostazioni e generatore ---------- */
const getSet = k => (S.Impostazioni.find(r => r.id === k) || { valore: '' }).valore || '';
const list = k => getSet(k).split(/[,;\n]/).map(norm).filter(Boolean);
const LEG = ['fagioli', 'ceci', 'lenticchie', 'piselli', 'legumi', 'fave', 'soia', 'borlotti'];
function pool(slot) {
  const bad = list('esclusi').concat(list('allergie'), getSet('legumi') === '1' ? [] : LEG);
  return S.Pasti.filter(p => p.attivo !== '0' && (!p.categoria || p.categoria === 'entrambi' || p.categoria === slot))
    .filter(p => { const t = norm(p.nome + ' ' + p.ingredienti); return !bad.some(w => t.indexOf(w) >= 0); });
}
const days7 = ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
const order = ws => days7(ws).reduce((a, d) => a.concat(SL.map(s => [d, s])), []);
function pickedMap(skip, onlyLocked, ws) {
  const o = {};
  order(ws).forEach(([d, s]) => {
    const m = S.Menu.find(x => x.data === d && x.slot === s), p = m && S.Pasti.find(x => x.id === m.pastoId);
    if (p && d + s !== skip && (!onlyLocked || m.bloccato === '1')) o[d + s] = p;
  });
  return o;
}
/* Punteggio a regole: penalita' per ripetizioni (settimana, giorno, pasto precedente, settimane passate), bonus per gradimenti. */
function choose(d, s, picked, avoid) {
  const ws = mondayOf(d), O = order(ws), i = O.findIndex(x => x[0] === d && x[1] === s);
  const all = Object.values(picked), other = picked[d + SL[1 - SL.indexOf(s)]];
  const prev = i > 0 ? picked[O[i - 1][0] + O[i - 1][1]] : null, yd = picked[addDays(d, -1) + s];
  const hist = S.Menu.filter(m => m.data < ws && m.data >= addDays(ws, -28));
  const gr = list('graditi'), ng = list('nonGraditi');
  const same = (a, p, f) => a && norm(a[f]) && norm(a[f]) === norm(p[f]);
  let best = null, bs = -1e9;
  pool(s).forEach(p => {
    let sc = Math.random() * 3;
    if (all.some(x => x.id === p.id)) sc -= 100;
    if (p.id === avoid) sc -= 50;
    ['proteina', 'carbo', 'contorno'].forEach((f, j) => { sc -= all.filter(x => same(x, p, f)).length * [6, 4, 3][j]; });
    if (same(other, p, 'proteina')) sc -= 30; if (same(other, p, 'carbo')) sc -= 20;
    if (same(prev, p, 'proteina')) sc -= 20; if (same(prev, p, 'carbo')) sc -= 15;
    if (same(yd, p, 'proteina')) sc -= 8; if (same(yd, p, 'carbo')) sc -= 8;
    sc -= hist.filter(h => h.pastoId === p.id).length * 8;
    const t = norm(p.nome + ' ' + p.ingredienti);
    if (gr.some(w => t.indexOf(w) >= 0)) sc += 10; if (ng.some(w => t.indexOf(w) >= 0)) sc -= 25;
    if (sc > bs) { bs = sc; best = p; }
  });
  return best ? { p: best, repeat: all.some(x => x.id === best.id) } : null;
}
const rowOf = (d, s, p) => ({ id: d + '_' + s, data: d, slot: s, pastoId: p.id, nome: p.nome, bloccato: '0', preparato: '0' });
function generate(keep) {
  const picked = keep ? pickedMap(null, true, weekStart) : {}, rows = []; let limited = false;
  order(weekStart).forEach(([d, s]) => {
    if (picked[d + s]) return;
    const r = choose(d, s, picked); if (!r) { limited = true; return; }
    if (r.repeat) limited = true;
    picked[d + s] = r.p; rows.push(rowOf(d, s, r.p));
  });
  if (rows.length) putMany('Menu', rows);
  return { limited };
}
function changeMeal(d, s) {
  const m = S.Menu.find(x => x.id === d + '_' + s);
  if (m && m.bloccato === '1') return toast('Pasto bloccato: sbloccalo per cambiarlo');
  const r = choose(d, s, pickedMap(d + s, false, mondayOf(d)), m && m.pastoId);
  if (!r) return toast('Nessun pasto disponibile: aggiungine altri');
  put('Menu', rowOf(d, s, r.p)); rebuildSpesa(mondayOf(d)); render();
  toast(r.repeat ? 'Pasto sostituito · varietà limitata' : 'Pasto sostituito');
}
const slug = n => 'm-' + n.replace(/[^a-z0-9]+/g, '-');
function rebuildSpesa(ws) {
  const want = {};
  S.Menu.filter(m => days7(ws).indexOf(m.data) >= 0).forEach(m => {
    const p = S.Pasti.find(x => x.id === m.pastoId); if (!p) return;
    String(p.ingredienti).split(/[,;\n]/).forEach(raw => { const n = norm(raw); if (n && !want[n]) want[n] = cap(raw.trim()); });
  });
  const auto = S.Spesa.filter(x => x.origine === 'menu'), ids = Object.keys(want).map(slug);
  const add = Object.keys(want).filter(n => !auto.some(x => x.id === slug(n))).map(n => ({ id: slug(n), nome: want[n], spuntato: '0', origine: 'menu' }));
  const gone = auto.filter(x => ids.indexOf(x.id) < 0).map(x => x.id);
  if (add.length) putMany('Spesa', add);
  if (gone.length) del('Spesa', gone);
}

/* ---------- viste ---------- */
const head = (eb, t) => `<header class="top"><div><p class="eyebrow">${esc(eb)}</p><h1>${esc(t)}</h1></div><div class="tools"><button class="sync ${sync.state}" data-act="sync" aria-label="Sincronizza ora"><i></i><span>${syncText()}</span></button><button class="icon" data-act="settings" aria-label="Impostazioni">${ic('sliders')}</button></div></header>`;
const empty = (t, x, b) => `<div class="empty"><h2>${t}</h2><p class="muted">${x}</p>${b || ''}</div>`;
const rowAt = (d, s) => S.Menu.find(m => m.data === d && m.slot === s);
const pastoOf = m => m && S.Pasti.find(x => x.id === m.pastoId);

function card(d, s) {
  const m = rowAt(d, s), p = pastoOf(m);
  if (!m) return `<article class="card"><p class="label">${cap(s)}</p><p class="muted">Non ancora scelto</p></article>`;
  const tags = (m.bloccato === '1' ? ' · bloccato' : '') + (m.preparato === '1' ? ' · preparato' : '');
  return `<article class="card ${m.preparato === '1' ? 'done' : ''}"><p class="label">${cap(s)}${tags}</p><h2>${esc(m.nome)}</h2><p class="muted clamp">${esc(p ? p.ingredienti : '')}</p>
  <div class="row"><button class="link" data-act="change" data-d="${d}" data-s="${s}">Cambia pasto</button><button class="link" data-act="open" data-d="${d}" data-s="${s}">Dettagli</button></div></article>`;
}
function vMenu() {
  const t = today(), tm = addDays(t, 1), has = rowAt(t, 'pranzo') || rowAt(t, 'cena');
  const todo = S.Spesa.filter(x => x.spuntato !== '1').length;
  let h = head(cap(fmt(t, { weekday: 'long', day: 'numeric', month: 'long' })), 'Menu di oggi');
  if (!has) return h + empty('Nessun menu per oggi', 'Genera il menu della settimana: ci pensiamo noi.', '<button class="btn" data-act="genthis">Genera settimana</button>');
  const line = s => { const m = rowAt(tm, s); return `<p><b>${cap(s)}</b> ${m ? esc(m.nome) : '<span class="muted">non scelto</span>'}</p>`; };
  return h + card(t, 'pranzo') + card(t, 'cena') + `<section class="card soft"><p class="label">Domani · ${esc(fmt(tm, { weekday: 'long', day: 'numeric' }))}</p>${line('pranzo')}${line('cena')}</section>
  <div class="two"><button class="btn ghost" data-go="week">Settimana</button><button class="btn ghost" data-go="spesa">Lista della spesa${todo ? ' · ' + todo : ''}</button></div>`;
}
function vWeek() {
  const t = today(), ds = days7(weekStart);
  let h = head('Settimana', fmt(ds[0], { day: 'numeric', month: 'short' }) + ' – ' + fmt(ds[6], { day: 'numeric', month: 'short' }));
  h += `<div class="weeknav"><button class="icon" data-act="prevw" aria-label="Settimana precedente">${ic('left')}</button><button class="link" data-act="thisw">Questa settimana</button><button class="icon" data-act="nextw" aria-label="Settimana successiva">${ic('right')}</button></div>
  <div class="two"><button class="btn" data-act="gen">Genera settimana</button><button class="btn ghost" data-act="regen">Rigenera non bloccati</button></div>`;
  return h + ds.map(d => `<section class="day"><h3 class="${d === t ? 'today' : ''}">${cap(fmt(d, { weekday: 'long' }))} <span>${esc(fmt(d, { day: 'numeric', month: 'short' }))}</span></h3>` +
    SL.map(s => { const m = rowAt(d, s); return `<button class="meal ${m && m.preparato === '1' ? 'done' : ''}" data-act="open" data-d="${d}" data-s="${s}"><span class="label">${cap(s)}</span><span class="nm">${m ? esc(m.nome) : '<span class="muted">Non scelto</span>'}</span>${m && m.bloccato === '1' ? ic('lock', 'tag') : ''}${m && m.preparato === '1' ? ic('check', 'tag') : ''}</button>`; }).join('') + '</section>').join('');
}
function vPasti() {
  const h = head(S.Pasti.length + (S.Pasti.length === 1 ? ' piatto' : ' piatti'), 'I miei pasti') + '<button class="btn wide" data-act="addp">+ Aggiungi pasto</button>';
  if (!S.Pasti.length) return h + empty('Nessun piatto ancora', 'Aggiungi i piatti che mangiate abitualmente: bastano nome e ingredienti.');
  return h + S.Pasti.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'it')).map(p => `<button class="card item-p" data-act="editp" data-id="${esc(p.id)}"><span class="nm">${esc(p.nome)}</span><span class="muted clamp">${esc(p.ingredienti)}</span><span class="label">${p.categoria === 'pranzo' ? 'Pranzo' : p.categoria === 'cena' ? 'Cena' : 'Pranzo e cena'}${p.attivo === '0' ? ' · escluso' : ''}</span></button>`).join('');
}
function vSpesa() {
  const all = S.Spesa.slice().sort((a, b) => (a.spuntato === '1') - (b.spuntato === '1') || a.nome.localeCompare(b.nome, 'it'));
  const todo = all.filter(x => x.spuntato !== '1').length, rows = filter === 'todo' ? all.filter(x => x.spuntato !== '1') : all;
  return head(todo ? todo + ' da comprare' : 'Tutto acquistato', 'Lista della spesa') +
    `<form id="addf" class="addrow"><input class="in" id="newitem" placeholder="Aggiungi un prodotto" autocomplete="off" enterkeyhint="done" aria-label="Nuovo prodotto"><button class="btn">Aggiungi</button></form>
    <div class="seg"><button class="${filter === 'todo' ? 'on' : ''}" data-act="filter" data-v="todo">Da comprare</button><button class="${filter === 'all' ? 'on' : ''}" data-act="filter" data-v="all">Tutti</button></div>` +
    (rows.length ? '<ul class="list">' + rows.map(x => `<li><label class="item ${x.spuntato === '1' ? 'done' : ''}"><input type="checkbox" data-tick="${esc(x.id)}" ${x.spuntato === '1' ? 'checked' : ''}><span class="box"></span><span class="txt">${esc(x.nome)}</span></label>${x.origine === 'manuale' ? `<button class="x" data-act="rmitem" data-id="${esc(x.id)}" aria-label="Rimuovi ${esc(x.nome)}">×</button>` : ''}</li>`).join('') + '</ul>'
      : empty(all.length ? 'Tutto fatto' : 'Lista vuota', all.length ? 'Non c’è nient’altro da comprare.' : 'Genera il menu oppure aggiungi un prodotto.')) +
    '<button class="link center" data-act="refill">Aggiorna dal menu</button>';
}
const vSetup = () => `<header class="top"><div><p class="eyebrow">Benvenuti</p><h1>Menu di casa</h1></div></header><p class="muted">Collega l’app al vostro foglio Google. Si fa una sola volta su ogni telefono.</p>
  <div class="card stack"><label>Indirizzo del backend<input class="in" id="f-url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}"></label>
  <label>Codice di accesso<input class="in" id="f-token" autocomplete="off" value="${esc(cfg.token)}"></label><button class="btn" data-act="connect">Collega</button></div>`;

function render() {
  const nav = $('#nav');
  if (!cfg.url) { nav.hidden = true; $('#app').innerHTML = vSetup(); return; }
  nav.hidden = false;
  $('#app').innerHTML = { menu: vMenu, week: vWeek, pasti: vPasti, spesa: vSpesa }[view]();
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.go === view; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

/* ---------- finestre ---------- */
const sheet = h => { const d = $('#dlg'); d.innerHTML = h; if (!d.open) d.showModal(); };
function ask(msg, ok) {
  return new Promise(res => {
    const d = $('#ask'); d.returnValue = 'no';
    d.innerHTML = `<form method="dialog"><p>${esc(msg)}</p><div class="two"><button class="btn ghost" value="no">Annulla</button><button class="btn" value="yes">${esc(ok || 'Conferma')}</button></div></form>`;
    d.onclose = () => res(d.returnValue === 'yes'); d.showModal();
  });
}
let tt; function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), 2400); }
const val = id => ($('#' + id).value || '').trim();

function openMeal(d, s) {
  const m = rowAt(d, s); if (!m) return;
  const p = pastoOf(m);
  sheet(`<p class="label">${cap(fmt(d, { weekday: 'long', day: 'numeric' }))} · ${cap(s)}</p><h2>${esc(m.nome)}</h2><p class="muted">${esc(p ? p.ingredienti : '')}</p>${p && p.note ? `<p>${esc(p.note)}</p>` : ''}
  <div class="stack"><button class="btn" data-act="change" data-d="${d}" data-s="${s}">Cambia pasto</button>
  <button class="btn ghost" data-act="tg" data-f="bloccato" data-d="${d}" data-s="${s}">${m.bloccato === '1' ? 'Sblocca pasto' : 'Blocca pasto'}</button>
  <button class="btn ghost" data-act="tg" data-f="preparato" data-d="${d}" data-s="${s}">${m.preparato === '1' ? 'Non preparato' : 'Segna come preparato'}</button>
  <button class="link" data-act="close">Chiudi</button></div>`);
}
function formPasto(id) {
  const p = S.Pasti.find(x => x.id === id) || { categoria: 'entrambi', attivo: '1' };
  const cats = [['entrambi', 'Pranzo e cena'], ['pranzo', 'Solo pranzo'], ['cena', 'Solo cena']];
  sheet(`<h2>${id ? 'Modifica pasto' : 'Nuovo pasto'}</h2><div class="stack">
  <label>Nome<input class="in" id="p-nome" value="${esc(p.nome)}" placeholder="Riso e uova con zucchine"></label>
  <label>Ingredienti, separati da virgola<textarea class="in" id="p-ing" rows="3">${esc(p.ingredienti)}</textarea></label>
  <label>Quando<select class="in" id="p-cat">${cats.map(c => `<option value="${c[0]}" ${p.categoria === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></label>
  <details><summary>Altri dettagli</summary><div class="stack">
  <label>Proteina principale<input class="in" id="p-pro" value="${esc(p.proteina)}" placeholder="pollo, uova, pesce…"></label>
  <label>Carboidrato principale<input class="in" id="p-car" value="${esc(p.carbo)}" placeholder="riso, pasta, patate…"></label>
  <label>Verdura o contorno<input class="in" id="p-con" value="${esc(p.contorno)}"></label>
  <label>Note<input class="in" id="p-note" value="${esc(p.note)}"></label>
  <label class="chk"><input type="checkbox" id="p-att" ${p.attivo !== '0' ? 'checked' : ''}> Usa nella generazione</label></div></details>
  <button class="btn" data-act="savep" data-id="${esc(id || '')}">Salva</button>
  ${id ? `<button class="btn danger" data-act="delp" data-id="${esc(id)}">Elimina pasto</button>` : ''}<button class="link" data-act="close">Annulla</button></div>`);
}
function openSettings() {
  const ta = (k, l) => `<label>${l}<textarea class="in" id="s-${k}" rows="2">${esc(getSet(k))}</textarea></label>`;
  sheet(`<h2>Preferenze</h2><div class="stack">${ta('esclusi', 'Alimenti esclusi (separati da virgola)')}${ta('allergie', 'Allergie e intolleranze')}${ta('graditi', 'Alimenti graditi')}${ta('nonGraditi', 'Alimenti non graditi')}
  <label class="chk"><input type="checkbox" id="s-legumi" ${getSet('legumi') === '1' ? 'checked' : ''}> Usa i legumi</label>
  <p class="muted">Controlla sempre le etichette: l’app non verifica gli ingredienti dei prodotti.</p>
  <details><summary>Collegamento al foglio</summary><div class="stack"><label>Indirizzo del backend<input class="in" id="f-url" value="${esc(cfg.url)}"></label><label>Codice di accesso<input class="in" id="f-token" value="${esc(cfg.token)}"></label></div></details>
  <button class="btn" data-act="saves">Salva</button><button class="link" data-act="close">Chiudi</button></div>`);
}

/* ---------- azioni ---------- */
const hasWeek = () => days7(weekStart).some(d => S.Menu.some(m => m.data === d));
function finish(r) { rebuildSpesa(weekStart); render(); toast(r.limited ? 'Menu aggiornato · varietà limitata: aggiungi altri pasti' : 'Menu aggiornato'); }
const A = {
  sync: () => syncNow(true),
  close: () => $('#dlg').close(),
  settings: openSettings,
  async connect() {
    const u = val('f-url'), t = val('f-token');
    if (u.indexOf('https://') !== 0 || !t) return toast('Inserisci indirizzo e codice');
    const old = cfg; cfg = { url: u, token: t };
    try { await api({ action: 'ping' }); LS('cfg', cfg); render(); syncNow(); toast('Collegato'); }
    catch (e) { cfg = old; toast('Collegamento non riuscito: controlla indirizzo e codice'); }
  },
  async saves() {
    putMany('Impostazioni', ['esclusi', 'allergie', 'graditi', 'nonGraditi'].map(k => ({ id: k, valore: val('s-' + k) })).concat([{ id: 'legumi', valore: $('#s-legumi').checked ? '1' : '0' }]));
    const u = val('f-url'), t = val('f-token');
    if (u && u.indexOf('https://') === 0 && (u !== cfg.url || t !== cfg.token)) { cfg = { url: u, token: t }; LS('cfg', cfg); }
    $('#dlg').close(); toast('Preferenze salvate'); syncNow();
  },
  genthis() { weekStart = mondayOf(today()); A.gen(); },
  async gen() {
    if (!S.Pasti.some(p => p.attivo !== '0')) { toast('Aggiungi prima qualche pasto'); view = 'pasti'; return render(); }
    if (hasWeek() && !(await ask('Questa settimana ha già un menu. Vuoi sostituirlo, compresi i pasti bloccati?', 'Genera settimana'))) return;
    finish(generate(false));
  },
  async regen() {
    if (!hasWeek()) return A.gen();
    if (!(await ask('Sostituire tutti i pasti non bloccati?', 'Rigenera'))) return;
    finish(generate(true));
  },
  change(el) { $('#dlg').open && $('#dlg').close(); changeMeal(el.dataset.d, el.dataset.s); },
  open: el => openMeal(el.dataset.d, el.dataset.s),
  tg(el) { const m = S.Menu.find(x => x.id === el.dataset.d + '_' + el.dataset.s), f = el.dataset.f; put('Menu', { id: m.id, [f]: m[f] === '1' ? '0' : '1' }); $('#dlg').close(); render(); toast(f === 'bloccato' ? (m[f] === '1' ? 'Pasto bloccato' : 'Pasto sbloccato') : (m[f] === '1' ? 'Segnato come preparato' : 'Segno rimosso')); },
  prevw() { weekStart = addDays(weekStart, -7); render(); },
  nextw() { weekStart = addDays(weekStart, 7); render(); },
  thisw() { weekStart = mondayOf(today()); render(); },
  addp: () => formPasto(''),
  editp: el => formPasto(el.dataset.id),
  savep(el) {
    const nome = val('p-nome'), ing = val('p-ing');
    if (!nome || !ing) return toast('Servono almeno nome e ingredienti');
    put('Pasti', { id: el.dataset.id || 'p-' + uid(), nome, ingredienti: ing, categoria: $('#p-cat').value, proteina: val('p-pro'), carbo: val('p-car'), contorno: val('p-con'), note: val('p-note'), attivo: $('#p-att').checked ? '1' : '0' });
    $('#dlg').close(); render(); toast('Pasto salvato');
  },
  async delp(el) {
    if (!(await ask('Eliminare questo pasto dalla raccolta? I menu già creati restano invariati.', 'Elimina'))) return;
    del('Pasti', [el.dataset.id]); $('#dlg').close(); render(); toast('Pasto eliminato');
  },
  filter(el) { filter = el.dataset.v; render(); },
  rmitem(el) { del('Spesa', [el.dataset.id]); render(); },
  refill() { rebuildSpesa(weekStart); render(); toast('Lista aggiornata'); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) A[el.dataset.act](el);
  const g = e.target.closest('[data-go]'); if (g) { view = g.dataset.go; render(); window.scrollTo(0, 0); }
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.tick) { put('Spesa', { id: t.dataset.tick, spuntato: t.checked ? '1' : '0' }); render(); } });
document.addEventListener('submit', e => {
  if (e.target.id !== 'addf') return; e.preventDefault();
  const v = val('newitem'); if (!v) return;
  put('Spesa', { id: 'x-' + uid(), nome: cap(v), spuntato: '0', origine: 'manuale' }); render(); toast('Aggiunto alla spesa'); $('#newitem').focus();
});

/* ---------- avvio ---------- */
$('#nav').querySelectorAll('button').forEach(b => b.insertAdjacentHTML('afterbegin', ic(b.dataset.icon)));
render(); syncNow();
setInterval(() => { if (!document.hidden) syncNow(); }, 20000);
addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncNow(); if (!document.activeElement || !document.activeElement.matches('#app input')) render(); } });
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js');
