// ---- Data store: shared database when the page runs inside Claude, this browser otherwise ----
const LKEY = 'duvox-rezani.data.v2', UKEY = 'duvox-rezani.ui.v2';
const COLLS = ['systems', 'profiles', 'colors', 'stock', 'jobs', 'history'];
const D = {}; COLLS.forEach(c => D[c] = new Map());
const DEFAULT_SETTINGS = { kerf: 4, trim: 10, threshold: 500, barLen: 6000 };
let settings = { ...DEFAULT_SETTINGS };
let db = null, mode = 'loading';
let ui = { tab: 'jobs', jobId: null, result: null, catTab: 'profiles' };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UKEY) || '{}')); } catch (e) {}
// transient UI state (not saved)
let pick = null;      // {ctx, kind, q}
let edit = null;      // {kind, id|null}
let confirmKey = null;
let imp = null;       // REF2MEN import being reviewed
const stockForm = { profileId: null, colorId: null };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const today = () => new Date().toISOString().slice(0, 10);
const czDate = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d}. ${+m}. ${y}`; };
const pl = (n, a, b, c) => n === 1 ? a : n >= 2 && n <= 4 ? b : c;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plain = o => JSON.parse(JSON.stringify(o));

function saveUi() { try { localStorage.setItem(UKEY, JSON.stringify(ui)); } catch (e) {} }
function loadLocal() {
  try {
    const o = JSON.parse(localStorage.getItem(LKEY) || 'null');
    if (o) { COLLS.forEach(c => D[c] = new Map((o[c] || []).map(d => [d.id, d]))); settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) }; }
  } catch (e) {}
}
function saveLocal() {
  if (mode !== 'local') return;
  try { const o = { settings }; COLLS.forEach(c => o[c] = [...D[c].values()]); localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) {}
}
function dbFail(e) { toast(e && e.code === 'not_granted' ? 'Nemáte oprávnění zapisovat. Požádejte Marka o přístup.' : 'Uložení se nepovedlo: ' + (e && e.message || e)); }
function put(c, doc) {
  doc.updated = new Date().toISOString();
  D[c].set(doc.id, doc);
  if (db) db.collection(c).doc(doc.id).set(plain(doc)).catch(dbFail); else saveLocal();
}
function del(c, id) {
  D[c].delete(id);
  if (db) db.collection(c).doc(id).delete().catch(dbFail); else saveLocal();
}
function putSettings() { if (db) db.doc('config/settings').set(plain(settings)).catch(dbFail); else saveLocal(); }

// Re-render on database changes, but never while someone is typing or pressing a button:
// replacing the page under a finger swallows the tap.
let pending = false, pressing = false;
function schedule() {
  const a = document.activeElement;
  const typing = a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['checkbox', 'range'].includes(a.type);
  if (pressing || typing) { pending = true; return; }
  render();
}
const flush = () => setTimeout(() => { if (pending && !pressing) { pending = false; schedule(); } }, 0);
document.addEventListener('pointerdown', () => { pressing = true; }, true);
const release = () => { setTimeout(() => { pressing = false; flush(); }, 0); };
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);
document.addEventListener('focusout', flush);

async function boot() {
  render();
  let h = null;
  try { h = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) {}
  if (h) {
    db = h; mode = 'db';
    COLLS.forEach(c => db.collection(c).onSnapshot(snap => {
      D[c] = new Map(snap.docs.map(d => [d.id, { ...plain(d.data()), id: d.id }]));
      schedule();
    }, e => toast('Chyba databáze: ' + e.message)));
    db.doc('config/settings').onSnapshot(s => { if (s.exists) { settings = { ...DEFAULT_SETTINGS, ...plain(s.data()) }; schedule(); } });
  } else {
    mode = 'local'; loadLocal();
    let seen = false; try { seen = !!localStorage.getItem(LKEY); } catch (e) {}
    if (!seen) loadExamples();
  }
  render();
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

// ---- catalog helpers ----
const P = id => D.profiles.get(id), C = id => D.colors.get(id);
// A profile is shown as "system + name" (Synego R72); the name alone is used when it already starts with the system.
// Profiles belong to a system (Synego, Brillant…) and are shown as "system + name" (Synego R72).
const SY = id => D.systems.get(id);
const sysName = p => p ? (p.systemId ? (SY(p.systemId) || {}).name || '' : p.system || '') : '';
const pName = p => { if (!p) return 'Neznámý profil'; const s = sysName(p); return s && !norm(p.name).startsWith(norm(s)) ? `${s} ${p.name}` : p.name; };
const pShort = (p, j) => p && j && j.systemId && p.systemId === j.systemId ? p.name : pName(p);
const sortedSystems = () => [...D.systems.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
function jobSystems(j) {
  const s = new Set((j.groups || []).map(g => sysName(P(g.profileId))).filter(Boolean));
  if (j.systemId && SY(j.systemId)) s.add(SY(j.systemId).name);
  return [...s];
}
const cName = c => c ? c.name : 'Neznámá barva';
const pSub = p => p && p.code ? 'art. ' + p.code : '';
const cSub = c => c ? [c.code, c.finish].filter(Boolean).join(' · ') : '';
const swatch = c => c && c.hex ? `<span class="sw" style="background:${esc(c.hex)}"></span>` : '<span class="sw" style="background:repeating-linear-gradient(135deg,#fff 0 4px,#ddd 4px 6px)"></span>';
const hay = (o, kind) => norm(kind === 'profiles' ? [pName(o), o.code, (o.aliases || []).join(' ')].join(' ') : [o.name, o.code, o.finish, (o.aliases || []).join(' ')].join(' '));
const oName = (kind, o) => kind === 'profiles' ? pName(o) : o.name;
function search(kind, q) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  return [...D[kind].values()].filter(o => toks.every(t => hay(o, kind).includes(t))).sort((a, b) => oName(kind, a).localeCompare(oName(kind, b), 'cs'));
}
const stockKey = (profileId, colorId) => profileId + '|' + colorId;
function stockFor(g) {
  const out = [];
  for (const s of D.stock.values()) if (s.profileId === g.profileId && s.colorId === g.colorId) for (let i = 0; i < s.qty; i++) out.push({ len: s.len, id: s.id });
  return out;
}
function summarizeLens(lens) {
  const m = new Map(); lens.forEach(l => m.set(l, (m.get(l) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[0] - a[0]).slice(0, 5).map(([l, n]) => (n > 1 ? n + '× ' : '') + num(l)).join(', ') + (m.size > 5 ? '…' : '');
}
function usage(kind, id) {
  if (kind === 'systems') return [...D.profiles.values()].filter(p => p.systemId === id).length;
  const f = kind === 'profiles' ? 'profileId' : 'colorId';
  let n = 0;
  for (const s of D.stock.values()) if (s[f] === id) n++;
  for (const j of D.jobs.values()) for (const g of j.groups || []) if (g[f] === id) n++;
  return n;
}

// ---- example data ----
function exampleData() {
  const d = today();
  const systems = [{ id: 'ex-sys-synego', name: 'Synego' }, { id: 'ex-sys-geneo', name: 'Geneo' }];
  const profiles = [
    { id: 'ex-p-synego-ram', systemId: 'ex-sys-synego', name: 'rám', code: '', barLen: 6000, aliases: [] },
    { id: 'ex-p-synego-kridlo', systemId: 'ex-sys-synego', name: 'křídlo', code: '', barLen: 6000, aliases: [] },
    { id: 'ex-p-synego-sloupek', systemId: 'ex-sys-synego', name: 'sloupek', code: '', barLen: 6000, aliases: [] },
    { id: 'ex-p-geneo-ram', systemId: 'ex-sys-geneo', name: 'rám', code: '', barLen: 6000, aliases: [] },
    { id: 'ex-p-geneo-kridlo', systemId: 'ex-sys-geneo', name: 'křídlo', code: '', barLen: 6000, aliases: [] }
  ];
  const colors = [
    { id: 'ex-c-bila', name: 'Bílá', code: '', finish: 'hladká', hex: '#f4f4f0' },
    { id: 'ex-c-antracit-obo', name: 'Antracit', code: 'RAL 7016', finish: 'fólie oboustranně', hex: '#383e42' },
    { id: 'ex-c-antracit-bila', name: 'Antracit / bílá', code: 'RAL 7016', finish: 'fólie venku, uvnitř bílá', hex: '#383e42' },
    { id: 'ex-c-zlaty-dub', name: 'Zlatý dub', code: '', finish: 'fólie oboustranně', hex: '#a8692e' },
    { id: 'ex-c-orech', name: 'Ořech', code: '', finish: 'fólie oboustranně', hex: '#6b3f23' }
  ];
  const cuts = list => list.map(([len, qty, label], i) => ({ id: 'c' + i, len, qty, label }));
  const jobs = [{ id: 'ex-job-1', name: 'Ukázka: 3 okna a dveře', created: d, simplicity: 60, groups: [
    { id: 'g1', profileId: 'ex-p-synego-ram', colorId: 'ex-c-bila', barLen: 6000, useStock: true, selected: true, cuts: cuts([[1500, 4, 'O1 O2 nahoře/dole'], [1450, 4, 'O1 O2 boky'], [1320, 5, 'O3'], [2100, 2, 'Dveře boky'], [1000, 1, 'Dveře nahoře'], [780, 3, 'O4'], [640, 6, 'Fixy']]) },
    { id: 'g2', profileId: 'ex-p-synego-kridlo', colorId: 'ex-c-bila', barLen: 6000, useStock: true, selected: true, cuts: cuts([[1426, 4, 'O1 O2'], [1376, 4, 'O1 O2'], [1246, 4, 'O3']]) },
    { id: 'g3', profileId: 'ex-p-geneo-ram', colorId: 'ex-c-antracit-bila', barLen: 6000, useStock: true, selected: false, cuts: cuts([[1180, 2, 'O5'], [980, 2, 'O5'], [600, 4, 'O6']]) }
  ] }];
  const stock = [
    { id: 'ex-s-1', profileId: 'ex-p-synego-ram', colorId: 'ex-c-bila', len: 2350, qty: 1, source: 'Ukázka', date: d },
    { id: 'ex-s-2', profileId: 'ex-p-synego-ram', colorId: 'ex-c-bila', len: 1100, qty: 2, source: 'Ukázka', date: d },
    { id: 'ex-s-3', profileId: 'ex-p-synego-kridlo', colorId: 'ex-c-bila', len: 1620, qty: 1, source: 'Ukázka', date: d }
  ];
  for (const a of [systems, profiles, colors, jobs, stock]) a.forEach(o => o.example = true);
  return { systems, profiles, colors, jobs, stock };
}
function loadExamples() { const ex = exampleData(); for (const c of Object.keys(ex)) ex[c].forEach(o => put(c, o)); }
function removeExamples() { for (const c of COLLS) for (const o of [...D[c].values()]) if (o.example) del(c, o.id); }
const hasExamples = () => COLLS.some(c => [...D[c].values()].some(o => o.example));

// ---- pasted lists ----
// Accepts "1450 4", "1450x4", "4 x 1450", "1450;4;O1", "1450 mm 4 ks", CSV with a header row.
function parseList(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const nums = [...line.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => ({ v: parseFloat(m[0].replace(',', '.')), s: m.index, e: m.index + m[0].length }));
    if (!nums.length) continue;
    const lenN = nums.reduce((a, b) => (b.v > a.v ? b : a));
    if (lenN.v < 20) continue;
    const qtyN = nums.filter(n => n !== lenN && Number.isInteger(n.v) && n.v > 0 && n.v < 1000)[0];
    let label = line;
    for (const n of [lenN, qtyN].filter(Boolean).sort((a, b) => b.s - a.s)) label = label.slice(0, n.s) + ' ' + label.slice(n.e);
    label = label.replace(/\b(mm|pcs|ks|kus[uyů]?|x|×)\b/gi, ' ').replace(/[;,\t|*×]+/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ id: uid(), len: lenN.v, qty: qtyN ? qtyN.v : 1, label });
  }
  return out;
}

// ---- views ----
function simpText(v) { return v <= 10 ? 'nejméně odpadu' : v <= 40 ? 'hlavně málo odpadu' : v <= 70 ? 'vyváženě' : v < 100 ? 'hlavně jednoduše' : 'nejjednodušší řezání'; }
const curJob = () => ui.jobId && D.jobs.get(ui.jobId);

function pickerHtml(ctx, kind, selId) {
  const o = kind === 'profiles' ? P(selId) : C(selId);
  const open = pick && pick.ctx === ctx && pick.kind === kind;
  const label = kind === 'profiles' ? 'Profil' : 'Barva';
  return `<div class="f-pick" style="display:grid;gap:4px;min-width:0"><span class="small muted" style="font-weight:700">${label}</span>
    <button class="pickbtn ${o ? '' : 'empty-pick'}" data-act="open-pick" data-ctx="${ctx}" data-kind="${kind}" aria-expanded="${open}">
      <b>${kind === 'colors' && o ? `<span class="sw" style="display:inline-block;vertical-align:-3px;margin-right:6px;width:16px;height:16px;background:${esc(o.hex || '#ffffff')}"></span>` : ''}${o ? esc(oName(kind, o)) : 'Vyberte…'}</b>
      <small>${o ? esc(kind === 'profiles' ? pSub(o) : cSub(o)) || '&nbsp;' : 'z katalogu'}</small>
    </button></div>`;
}
function pickBoxHtml() {
  const kindTxt = pick.kind === 'profiles' ? 'profil' : 'barvu';
  return `<div class="pickbox"><input id="pick-q" value="${esc(pick.q)}" placeholder="Hledat ${kindTxt} (název, kód, ${pick.kind === 'profiles' ? 'systém' : 'povrch'})…" autocomplete="off">
    <div class="picklist" id="pick-list">${pickListHtml()}</div>
    <div><button class="link" data-act="close-pick">Zavřít</button></div></div>`;
}
function pickSystem() {
  if (pick.kind !== 'profiles' || pick.all) return null;
  if (pick.ctx.startsWith('g:')) { const j = curJob(); return j && j.systemId && SY(j.systemId) ? j.systemId : null; }
  if (pick.ctx.startsWith('imp:')) return imp && imp.systemId && SY(imp.systemId) ? imp.systemId : null;
  return null;
}
function pickListHtml() {
  const sys = pickSystem();
  const res = search(pick.kind, pick.q).filter(o => !sys || o.systemId === sys).slice(0, 40);
  const allLink = sys ? `<button class="link" data-act="pick-all">Zobrazit profily všech systémů</button>` : '';
  const items = res.map(o => `<button class="opt" data-act="pick" data-id="${o.id}">${pick.kind === 'colors' ? swatch(o) : ''}<span>${esc(oName(pick.kind, o))} <small>${esc(pick.kind === 'profiles' ? pSub(o) : cSub(o))}</small></span></button>`).join('');
  const add = pick.q.trim() ? `<button class="opt add" data-act="pick-add">+ Přidat „${esc(pick.q.trim())}“ do katalogu</button>` : '';
  return (items || `<div class="muted small" style="padding:6px">Nic nenalezeno.</div>`) + add + allLink;
}

const views = {
  jobs() {
    if (imp) return importView();
    const j = curJob();
    if (j) return jobEditor(j);
    const jobs = [...D.jobs.values()].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return `
      ${hasExamples() ? `<div class="banner"><span>Obsahuje ukázková data (zakázka, katalog, sklad).</span><span class="actions">${confirmKey === 'ex' ? `<button class="btn danger" data-act="rm-examples">Ano, smazat ukázky</button><button class="btn" data-act="cancel">Ne</button>` : `<button class="btn" data-act="ask" data-key="ex">Smazat ukázky</button>`}</span></div>` : ''}
      <div class="spread"><h1 class="on-navy">Zakázky</h1><span class="actions"><label class="btn" for="imp-file">Import z REF2MEN</label><button class="btn primary" data-act="new-job">Nová zakázka</button></span></div>
      <input type="file" id="imp-file" accept=".pdf,application/pdf" hidden>
      ${jobs.length ? jobs.map(j => {
        const gs = j.groups || [], cut = gs.filter(g => g.cutAt).length;
        return `<button class="card" data-act="open-job" data-id="${j.id}">
          <div class="spread"><b>${esc(j.name || 'Bez názvu')}</b><span class="small muted">${czDate(j.created)}</span></div>
          <div class="small muted">${gs.length ? esc([jobSystems(j).join(', '), [...new Set(gs.map(g => C(g.colorId)).filter(Boolean).map(c => c.name))].join(', ')].filter(Boolean).join(' · ')) : 'Zatím bez profilů'}</div>
          <div class="chips"><span class="chip">${gs.length} ${pl(gs.length, 'profil', 'profily', 'profilů')}</span>${cut ? `<span class="chip ok">nařezáno ${cut} z ${gs.length}</span>` : ''}</div>
        </button>`;
      }).join('') : `<div class="panel empty">Zatím žádné zakázky. Založte první tlačítkem Nová zakázka.</div>`}`;
  },

  sheet() {
    const r = ui.result;
    if (!r) return `<div class="panel empty">Zatím žádný plán. Otevřete zakázku, vyberte profily a stiskněte Spočítat plán.</div>`;
    return renderSheet(r, !r.savedId);
  },

  stock() {
    const q = ui.stockQ || '';
    const toks = norm(q).split(/\s+/).filter(Boolean);
    const groups = new Map();
    for (const s of D.stock.values()) {
      const k = stockKey(s.profileId, s.colorId);
      if (!groups.has(k)) groups.set(k, { p: P(s.profileId), c: C(s.colorId), items: [] });
      groups.get(k).items.push(s);
    }
    const list = [...groups.values()].filter(g => toks.every(t => norm([pName(g.p), pSub(g.p), cName(g.c), cSub(g.c)].join(' ')).includes(t)))
      .sort((a, b) => (pName(a.p) + cName(a.c)).localeCompare(pName(b.p) + cName(b.c), 'cs'));
    const total = [...D.stock.values()].reduce((a, s) => a + s.qty, 0);
    const sf = pick && pick.ctx === 'stock';
    return `
    <div class="spread"><h1 class="on-navy">Sklad zbytků</h1><span class="chip ind">${total} ${pl(total, 'kus', 'kusy', 'kusů')}</span></div>
    <div class="panel">
      <input id="stock-q" value="${esc(q)}" placeholder="Hledat profil nebo barvu…" autocomplete="off">
      <p class="small muted">Zbytky od ${num(settings.threshold)} mm se sem přidají samy, když uložíte plán. V dalším plánu se použijí přednostně.</p>
      ${list.length ? list.map(g => `
        <div style="display:grid;gap:6px"><div style="display:flex;gap:8px;align-items:center">${swatch(g.c)}<h3>${esc(pName(g.p))} · ${esc(cName(g.c))}</h3></div>
          <div class="pieces">${g.items.sort((a, b) => b.len - a.len).map(s => `<span class="piece" title="${esc(s.source)} · ${czDate(s.date)}">${num(s.len)}${s.qty > 1 ? `<span class="qty">×${s.qty}</span>` : ''}<button data-act="stock-minus" data-id="${s.id}" aria-label="Odebrat jeden kus ${num(s.len)} mm">−</button></span>`).join('')}</div>
        </div>`).join('') : `<div class="empty">${D.stock.size ? 'Nic nenalezeno.' : 'Sklad je prázdný.'}</div>`}
    </div>
    <div class="panel">
      <h3>Přidat zbytek ručně</h3>
      <div class="pickers" style="grid-template-columns:1fr 1fr">
        ${pickerHtml('stock', 'profiles', stockForm.profileId)}${pickerHtml('stock', 'colors', stockForm.colorId)}
        ${sf ? pickBoxHtml() : ''}
      </div>
      <div class="row">
        <label class="f">Délka mm<input id="st-len" inputmode="decimal"></label>
        <label class="f" style="flex:0 1 110px">Kusů<input id="st-qty" inputmode="numeric" value="1"></label>
        <button class="btn primary" data-act="stock-add">Přidat do skladu</button>
      </div>
    </div>`;
  },

  history() {
    const hs = [...D.history.values()].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    return `<h1 class="on-navy">Historie</h1>` + (hs.length ? hs.map(h => {
      const bars = h.groups.reduce((a, g) => a + (g.plan.stats ? g.plan.stats.newBars : 0), 0);
      const kept = h.groups.flatMap(g => g.plan.stats ? g.plan.stats.kept : []);
      return `<button class="card" data-act="open-hist" data-id="${h.id}">
        <div class="spread"><b>${esc(h.name || 'Bez názvu')}</b><span class="small muted">${czDate(h.date)}</span></div>
        <div class="small muted">${h.groups.map(g => esc(g.title)).join(' / ')}</div>
        <div class="chips"><span class="chip">${bars} ${pl(bars, 'nová tyč', 'nové tyče', 'nových tyčí')}</span>${kept.length ? `<span class="chip ind">do skladu ${summarizeLens(kept)}</span>` : ''}</div>
      </button>`;
    }).join('') : `<div class="panel empty">Uložené plány se objeví tady, i s tím, co zbylo.</div>`);
  },

  catalog() {
    const kind = ui.catTab;
    if (kind === 'systems') return catalogSystems() + settingsPanels();
    const q = ui.catQ || '';
    const items = search(kind, q);
    const isP = kind === 'profiles';
    return `
    <h1 class="on-navy">Katalog</h1>
    <div class="panel">
      <div class="spread"><div class="seg-ctl" role="group" aria-label="Katalog">
${catTabs()}</div>
        <button class="btn primary" data-act="cat-new">${isP ? 'Nový profil' : 'Nová barva'}</button></div>
      ${edit && !edit.id && edit.kind === kind ? editForm() : ''}
      <input id="cat-q" value="${esc(q)}" placeholder="${isP ? 'Hledat podle názvu, systému, kódu nebo názvu z REF2MEN…' : 'Hledat podle názvu, kódu nebo povrchu…'}" autocomplete="off">
      <div class="cat">${items.map(o => edit && edit.id === o.id ? editForm() : `<button class="opt" data-act="cat-edit" data-id="${o.id}">${isP ? '' : swatch(o)}<span>${esc(oName(kind, o))} <small>${esc(isP ? pSub(o) : cSub(o))}${o.aliases && o.aliases.length ? ` · ${o.aliases.length} ${pl(o.aliases.length, 'jiný název', 'jiné názvy', 'jiných názvů')}` : ''}</small></span><small>Upravit</small></button>`).join('') ||
        `<div class="empty">${D[kind].size ? 'Nic nenalezeno.' : `Katalog je prázdný. ${isP ? 'Přidejte první profil' : 'Přidejte první barvu'} tlačítkem nahoře.`}</div>`}</div>
    </div>
    ${settingsPanels()}`;
  }
};

function settingsPanels() {
  return `
    <div class="panel">
      <h2>Pila a sklad</h2>
      <div class="row">
        <label class="f">Šířka řezu (kotouč) mm<input data-sf="kerf" inputmode="decimal" value="${num(settings.kerf)}"></label>
        <label class="f">Zaříznutí konců na tyč mm<input data-sf="trim" inputmode="decimal" value="${num(settings.trim)}"></label>
      </div>
      <div class="row">
        <label class="f">Zbytky ponechat od mm<input data-sf="threshold" inputmode="numeric" value="${num(settings.threshold)}"></label>
        <label class="f">Výchozí délka tyče mm<input data-sf="barLen" inputmode="numeric" value="${num(settings.barLen)}"></label>
      </div>
      <p class="small muted">Kratší zbytky se počítají jako odpad a do skladu se nepřidávají.</p>
    </div>
    <div class="panel">
      <h2>Data</h2>
      <p class="small muted">${mode === 'db' ? 'Katalog, sklad, zakázky a historie jsou ve sdílené databázi. Všichni, kdo mají přístup k této stránce, vidí stejná data.' : 'Data jsou uložená jen v tomto prohlížeči.'}</p>
      <div class="actions">${hasExamples() ? (confirmKey === 'ex' ? `<button class="btn danger" data-act="rm-examples">Ano, smazat ukázky</button><button class="btn" data-act="cancel">Ne</button>` : `<button class="btn" data-act="ask" data-key="ex">Smazat ukázková data</button>`) : `<button class="btn" data-act="load-examples">Načíst ukázková data</button>`}</div>
    </div>`;
}
function catTabs() {
  const k = ui.catTab;
  return `<div class="seg-ctl" role="group" aria-label="Katalog">
    <button data-act="cat-tab" data-kind="systems" aria-pressed="${k === 'systems'}">Systémy (${D.systems.size})</button>
    <button data-act="cat-tab" data-kind="profiles" aria-pressed="${k === 'profiles'}">Profily (${D.profiles.size})</button>
    <button data-act="cat-tab" data-kind="colors" aria-pressed="${k === 'colors'}">Barvy (${D.colors.size})</button></div>`;
}
function catalogSystems() {
  const list = sortedSystems();
  const count = id => [...D.profiles.values()].filter(p => p.systemId === id).length;
  return `
    <h1 class="on-navy">Katalog</h1>
    <div class="panel">
      <div class="spread">${catTabs()}<button class="btn primary" data-act="cat-new">Nový systém</button></div>
      ${edit && !edit.id && edit.kind === 'systems' ? editForm() : ''}
      <div class="cat">${list.map(s => edit && edit.id === s.id ? editForm() : `<button class="opt" data-act="cat-edit" data-id="${s.id}"><span>${esc(s.name)} <small>${count(s.id)} ${pl(count(s.id), 'profil', 'profily', 'profilů')}</small></span><small>Upravit</small></button>`).join('') || '<div class="empty">Zatím žádné systémy. Přidejte první tlačítkem nahoře.</div>'}</div>
    </div>`;
}

function editForm() {
  const isP = edit.kind === 'profiles';
  const used = edit.id ? usage(edit.kind, edit.id) : 0;
  const delBtn = edit.id ? (confirmKey === 'cat-del' ? `<span class="confirm">${used ? `Používá se ${used}×. ` : ''}Opravdu smazat?<button class="btn danger" data-act="cat-del">Smazat</button></span>` : `<button class="btn danger" data-act="ask" data-key="cat-del">Smazat</button>`) : '';
  if (edit.kind === 'systems') {
    const s = edit.id ? D.systems.get(edit.id) : { name: '' };
    return `<div class="form"><label class="f">Název systému<input id="e-name" value="${esc(s.name)}" placeholder="např. Brillant"></label>
      <div class="actions"><button class="btn primary" data-act="cat-save">Uložit</button><button class="btn" data-act="cat-cancel">Zrušit</button>${used ? (edit.id ? `<span class="small muted">Má ${used} ${pl(used, 'profil', 'profily', 'profilů')}, nelze smazat.</span>` : '') : delBtn}</div></div>`;
  }
  const o = edit.id ? D[edit.kind].get(edit.id) : (isP ? { systemId: ui.lastSystemId || null, name: '', code: '', barLen: settings.barLen, aliases: [] } : { name: '', code: '', finish: '', hex: '', aliases: [] });
  const sysSel = o.systemId || '';
  return `<div class="form">
    ${isP ? `<div class="row">
      <label class="f">Systém<select id="e-system"><option value="">— bez systému —</option>${sortedSystems().map(s => `<option value="${s.id}" ${s.id === sysSel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new">+ Nový systém…</option></select>
        <input id="e-newsys" placeholder="Název nového systému" hidden style="margin-top:6px"></label>
      <label class="f">Profil<input id="e-name" value="${esc(o.name)}" placeholder="např. R72"></label>
    </div>
    <div class="row">
      <label class="f">Číslo artiklu<input id="e-code" value="${esc(o.code)}" placeholder="např. 550900"></label>
      <label class="f" style="flex:0 1 130px">Délka tyče mm<input id="e-bar" inputmode="numeric" value="${num(o.barLen || settings.barLen)}"></label>
    </div>` : `<div class="row">
      <label class="f" style="flex:2 1 200px">Název<input id="e-name" value="${esc(o.name)}" placeholder="např. Antracit"></label>
      <label class="f" style="flex:0 1 90px">Vzorek<input id="e-hex" type="color" value="${esc(o.hex || '#ffffff')}" style="height:44px;padding:2px"></label>
    </div>
    <div class="row">
      <label class="f">Kód (RAL, dekor)<input id="e-code" value="${esc(o.code)}" placeholder="např. RAL 7016"></label>
      <label class="f">Povrch<input id="e-finish" value="${esc(o.finish)}" placeholder="např. fólie oboustranně"></label>
    </div>`}
    <label class="f">Jiné názvy z REF2MEN (doplní se samy při importu), jeden na řádek<textarea id="e-aliases" style="min-height:70px">${esc((o.aliases || []).join('\n'))}</textarea></label>
    <div class="actions"><button class="btn primary" data-act="cat-save">Uložit</button><button class="btn" data-act="cat-cancel">Zrušit</button>
      ${delBtn}</div>
  </div>`;
}

function jobEditor(j) {
  const gs = j.groups || [];
  const sel = gs.filter(g => g.selected);
  const ready = sel.filter(g => g.profileId && g.colorId && g.cuts.some(c => c.len > 0 && c.qty > 0));
  return `
    <div><button class="link on-navy" data-act="close-job">← Všechny zakázky</button></div>
    <div class="panel accent">
      <div class="row">
        <label class="f" style="flex:3 1 220px">Název zakázky<input id="job-name" value="${esc(j.name)}" placeholder="např. 2026-114 RD Kolín"></label>
        <label class="f" style="flex:1 1 150px">Systém<select id="job-system"><option value="">— různé —</option>${sortedSystems().map(s => `<option value="${s.id}" ${s.id === j.systemId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        ${confirmKey === 'job-del' ? `<span class="confirm">Smazat celou zakázku?<button class="btn danger" data-act="del-job">Smazat</button><button class="btn" data-act="cancel">Ne</button></span>` : `<button class="link danger" data-act="ask" data-key="job-del">Smazat zakázku</button>`}
      </div>
      <div class="slider">
        <label class="f" for="simp" style="flex:none">Optimalizovat na</label>
        <input type="range" id="simp" min="0" max="100" step="10" value="${j.simplicity ?? 60}">
        <div class="ends"><span>Nejméně odpadu</span><b id="simp-lbl">${simpText(j.simplicity ?? 60)}</b><span>Nejjednodušší řezání</span></div>
      </div>
    </div>
    ${gs.map((g, gi) => groupPanel(g, gi)).join('')}
    <div class="actions"><button class="btn" data-act="add-group">+ Přidat profil</button><label class="btn" for="imp-file">+ Přidat z REF2MEN PDF</label><input type="file" id="imp-file" accept=".pdf,application/pdf" hidden></div>
    ${gs.length ? `<div class="go ${pick ? 'static' : ''}"><div class="go-in">
      <button class="btn primary big" data-act="optimize" ${ready.length ? '' : 'disabled'}>Spočítat plán</button>
      <span class="sel">${sel.length === gs.length ? 'všechny profily' : `vybráno ${sel.length} z ${gs.length}`}${ready.length < sel.length ? ` · ${sel.length - ready.length} bez profilu, barvy nebo délek` : ''}</span>
      <span style="margin-left:auto;display:flex;gap:12px"><button class="link on-navy" data-act="sel-all">Vybrat vše</button><button class="link on-navy" data-act="sel-none">Nic</button></span>
    </div></div>` : ''}`;
}

function groupPanel(g, gi) {
  const p = P(g.profileId), c = C(g.colorId);
  const avail = g.profileId && g.colorId ? stockFor(g) : [];
  const totalQty = g.cuts.reduce((a, x) => a + (+x.qty || 0), 0);
  const ctx = 'g:' + g.id;
  const open = pick && pick.ctx === ctx;
  return `
  <div class="panel ${g.selected ? '' : 'off'}" data-g="${g.id}">
    <div class="spread" style="flex-wrap:nowrap;align-items:flex-start">
      <label class="ghead toggle"><input type="checkbox" data-gf="selected" ${g.selected ? 'checked' : ''} aria-label="Zahrnout do plánu"><span class="gnum">${gi + 1}</span><h3>${p ? esc(pShort(p, curJob())) : 'Nový profil'}${c ? ' · ' + esc(c.name) : ''}</h3></label>
      <button class="x" data-act="del-group" aria-label="Odebrat profil ze zakázky">×</button>
    </div>
    ${g.cutAt ? `<div class="cutflag"><b>✓ Nařezáno ${czDate(g.cutAt)}</b>${g.selected ? '<span>Znovu vybráno do plánu</span>' : '<span>Proto není vybráno pro nový plán. Zaškrtnutím ho vyberete znovu.</span>'}</div>` : g.selected ? '' : '<div class="small muted offnote">Nevybráno, do plánu se nezapočítá.</div>'}
    <div class="pickers">
      ${pickerHtml(ctx, 'profiles', g.profileId)}${pickerHtml(ctx, 'colors', g.colorId)}
      <label class="f barlen">Tyč mm<input inputmode="numeric" data-gf="barLen" value="${num(g.barLen)}"></label>
      ${open ? pickBoxHtml() : ''}
    </div>
    ${g.cuts.length ? `<div style="overflow-x:auto"><table class="cuts">
      <thead><tr><th class="c-len">Délka mm</th><th class="c-qty">Kusů</th><th>Popis</th><th class="c-x"></th></tr></thead>
      <tbody>${g.cuts.map(x => `<tr data-c="${x.id}">
        <td><input class="len" inputmode="decimal" data-cf="len" value="${num(x.len)}" aria-label="Délka"></td>
        <td><input inputmode="numeric" data-cf="qty" value="${x.qty}" aria-label="Počet kusů"></td>
        <td><input data-cf="label" value="${esc(x.label)}" aria-label="Popis"></td>
        <td class="c-x"><button class="x" data-act="del-cut" aria-label="Odebrat řádek">×</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="small muted">${g.cuts.length} ${pl(g.cuts.length, 'délka', 'délky', 'délek')}, ${totalQty} ${pl(totalQty, 'kus', 'kusy', 'kusů')}</div>` : ''}
    <div class="addrow">
      <input id="add-len-${g.id}" inputmode="decimal" placeholder="Délka mm" aria-label="Nová délka">
      <input id="add-qty-${g.id}" inputmode="numeric" placeholder="Kusů" aria-label="Počet kusů">
      <input class="lbl" id="add-lbl-${g.id}" placeholder="Popis (nepovinné)" aria-label="Popis">
      <button class="btn" data-act="add-cut">Přidat</button>
    </div>
    <details><summary>Vložit seznam</summary>
      <div style="display:grid;gap:8px;margin-top:8px">
        <textarea id="paste-${g.id}" placeholder="Jeden řez na řádek, např.&#10;1450 4 O1 boky&#10;4 x 1320&#10;2100;2;Dveře"></textarea>
        <div><button class="btn" data-act="paste">Přidat řádky</button></div>
      </div>
    </details>
    <label class="toggle"><input type="checkbox" data-gf="useStock" ${g.useStock ? 'checked' : ''}>
      <span>Použít zbytky ze skladu <span class="muted small">${!g.profileId || !g.colorId ? '' : avail.length ? `(${avail.length} ${pl(avail.length, 'vhodný', 'vhodné', 'vhodných')}: ${summarizeLens(avail.map(a => a.len))})` : '(žádné vhodné)'}</span></span></label>
  </div>`;
}

function renderSheet(r, live) {
  return `
  <div class="panel accent">
    <div class="spread"><h1>${esc(r.name || 'Bez názvu')}</h1><span class="muted">${czDate(r.date)}</span></div>
    <div class="small muted">Řez ${num(r.settings.kerf)} mm · zaříznutí ${num(r.settings.trim)} mm · zbytky od ${num(r.settings.threshold)} mm · ${simpText(r.simplicity)}</div>
    ${r.savedId ? `<div class="chips"><span class="chip ok">Uloženo v historii</span></div>` : ''}
  </div>
  ${r.groups.map((gr, gi) => {
    const p = gr.plan, st = p.stats;
    if (!st) return `<div class="panel"><h2>${esc(gr.title)}</h2>${p.errors.map(e => `<div class="err">${esc(e)}</div>`).join('')}</div>`;
    const scrapPct = st.material ? (st.material - st.piecesLen - st.kept.reduce((a, b) => a + b, 0)) / st.material * 100 : 0;
    const ci = new Map(p.setup.map((s, i) => [s.len, i % 8 + 1]));
    const col = len => `var(--p${ci.get(len)})`;
    return `<div class="panel">
      <div class="ghead"><span class="gnum big">${gLetter(gi)}</span><div><h2>${esc(gr.title)}</h2><div class="small muted">${esc(gr.sub)}</div></div></div>
      ${p.errors.map(e => `<div class="err">${esc(e)}</div>`).join('')}
      <div class="stats">
        <div class="stat"><b>${st.newBars}</b><span>${pl(st.newBars, 'nová tyč', 'nové tyče', 'nových tyčí')} ${num(gr.barLen)} mm</span></div>
        <div class="stat"><b>${st.stockUsed.length}</b><span>zbytků ze skladu</span></div>
        <div class="stat"><b>${num(scrapPct.toFixed(1))} %</b><span>odpad vč. prořezu</span></div>
        <div class="stat"><b>${st.kept.length}</b><span>zbytků do skladu</span></div>
      </div>
      ${p.patterns.map((pt, pi) => `
        <div class="pattern">
          <div class="phead"><span class="plabel">${gLetter(gi)}${pi + 1}</span><span class="times">${pt.count}×</span>
            <span class="src ${pt.src}">${pt.src === 'stock' ? `Zbytek ze skladu ${num(pt.len)} mm` : `Nová tyč ${num(pt.len)} mm`}</span>
            <span class="muted small">${pt.groups.length} ${pl(pt.groups.length, 'délka', 'délky', 'délek')}</span></div>
          <div class="bar" role="img" aria-label="Rozvržení tyče">${pt.groups.flatMap(g => Array(g.n).fill(g.len)).map(len => `<div class="seg" style="flex:${len} 1 0;background:${col(len)}">${num(len)}</div>`).join('')}${pt.leftover > 0 ? `<div class="seg left ${pt.keep ? 'keep' : ''}" style="flex:${Math.max(pt.leftover, 1)} 1 0">${pt.leftover >= 300 ? num(pt.leftover) : ''}</div>` : ''}</div>
          <ul class="cl">${pt.groups.map(g => `<li><span class="dot" style="background:${col(g.len)}"></span><span class="q">${g.n}×</span><span class="l">${num(g.len)}</span><span class="lab">${esc(labelSummary(g.labels))}</span></li>`).join('')}</ul>
          <div class="rest ${pt.keep ? 'keep' : 'scrap'}">${pt.keep ? `Zbytek ${num(pt.leftover)} mm do skladu${pt.count > 1 ? ` (${pt.count}×)` : ''}` : pt.leftover > 0 ? `Odpad ${num(pt.leftover)} mm` : 'Bez zbytku'}</div>
        </div>`).join('')}
      <div style="display:grid;gap:6px"><span class="small muted" style="font-weight:700">Celkem podle délek</span>
        <div class="chips">${p.setup.map(s => `<span class="chip"><span class="dot" style="width:12px;height:12px;background:${col(s.len)}"></span>${s.qty}× ${num(s.len)}</span>`).join('')}</div></div>
    </div>`;
  }).join('')}
  <div class="actions">
    ${live ? `<button class="btn primary big" data-act="save-result">Uložit a upravit sklad</button><button class="btn" data-act="back-job">Zpět na zakázku</button>` : `${D.jobs.has(r.jobId) ? '<button class="btn" data-act="back-job">Zpět na zakázku</button>' : ''}<button class="btn" data-act="reuse">Zkopírovat do nové zakázky</button>`}
    <button class="btn" data-act="pdf">Stáhnout PDF k tisku</button>
    <button class="btn" data-act="copy-text">Kopírovat jako text</button>
  </div>
  ${live ? `<p class="small on-navy">Uložením se plán zapíše do historie, použité zbytky se odeberou ze skladu a zbytky „do skladu“ se přidají. Profily se v zakázce označí jako nařezané.</p>` : ''}`;
}
const gLetter = i => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + i % 26);
function labelSummary(labels) {
  const m = new Map(); labels.forEach(l => m.set(l, (m.get(l) || 0) + 1));
  return [...m.entries()].map(([l, n]) => (n > 1 ? n + '× ' : '') + l).join(', ');
}
function sheetText(r) {
  const lines = [`${r.name || 'Bez názvu'} (${czDate(r.date)})`];
  r.groups.forEach((gr, gi) => {
    lines.push('', gLetter(gi) + '  ' + gr.title.toUpperCase());
    if (!gr.plan.stats) { lines.push(...gr.plan.errors); return; }
    gr.plan.patterns.forEach((pt, pi) => lines.push(`${gLetter(gi)}${pi + 1}  ${pt.count}x ${pt.src === 'stock' ? 'zbytek ' : 'tyč '}${pt.len}: ` + pt.groups.map(g => `${g.n}x ${g.len}`).join(' + ') + (pt.leftover > 0 ? (pt.keep ? ` | do skladu ${pt.leftover}` : ` | odpad ${pt.leftover}`) : '')));
  });
  return lines.join('\n');
}

// ---- render ----
function render() {
  pending = false;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'true' : 'false'));
  const n = [...D.stock.values()].reduce((a, s) => a + s.qty, 0);
  $('#n-stock').textContent = n ? ' ' + n : '';
  if (mode === 'loading') { $('#app').innerHTML = `<div class="loading">Načítám data…</div>`; return; }
  $('#app').innerHTML = `<section class="view">${views[ui.tab]()}</section>`;
}
function go(tab) { ui.tab = tab; pick = null; edit = null; confirmKey = null; saveUi(); render(); window.scrollTo(0, 0); }

// ---- actions ----
const gOf = el => { const j = curJob(); const id = el.closest('[data-g]')?.dataset.g; return j && j.groups.find(g => g.id === id); };
const saveJob = () => { const j = curJob(); if (j) put('jobs', j); };
function newGroup() { return { id: uid(), profileId: null, colorId: null, barLen: settings.barLen, useStock: true, selected: true, cuts: [] }; }
function addCut(g) {
  const len = parseFloat(($('#add-len-' + g.id).value || '').replace(',', '.'));
  const qty = parseInt($('#add-qty-' + g.id).value || '1', 10);
  const label = $('#add-lbl-' + g.id).value.trim();
  if (!(len > 0)) { $('#add-len-' + g.id).focus(); return; }
  const same = g.cuts.find(c => c.len === len && c.label === label);
  if (same) same.qty += qty > 0 ? qty : 1; else g.cuts.push({ id: uid(), len, qty: qty > 0 ? qty : 1, label });
  saveJob(); render(); $('#add-len-' + g.id).focus();
}
function choose(id) {
  const f = pick.kind === 'profiles' ? 'profileId' : 'colorId';
  if (pick.ctx === 'stock') stockForm[f] = id;
  else if (pick.ctx.startsWith('imp:')) imp.blocks[+pick.ctx.slice(4)][f] = id;
  else {
    const j = curJob(), g = j && j.groups.find(x => 'g:' + x.id === pick.ctx);
    if (g) { g[f] = id; if (f === 'profileId' && P(id) && P(id).barLen && !g.cuts.length) g.barLen = P(id).barLen; saveJob(); }
  }
  // after a profile, go straight on to the color if none is chosen yet
  const next = pick.kind === 'profiles' ? (pick.ctx === 'stock' ? !stockForm.colorId : pick.ctx.startsWith('imp:') ? !imp.blocks[+pick.ctx.slice(4)].colorId : !(curJob()?.groups.find(x => 'g:' + x.id === pick.ctx) || {}).colorId) : false;
  pick = next ? { ctx: pick.ctx, kind: 'colors', q: '' } : null;
  render();
  if (pick) $('#pick-q')?.focus();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) return;
  const act = t.dataset.act || 'tab';
  const g = gOf(t);
  const j = curJob();
  switch (act) {
    case 'tab': go(t.dataset.tab); break;
    case 'ask': confirmKey = t.dataset.key; render(); break;
    case 'cancel': confirmKey = null; render(); break;
    case 'new-job': { const nj = { id: uid(), name: '', created: today(), simplicity: 60, groups: [newGroup()] }; put('jobs', nj); ui.jobId = nj.id; saveUi(); render(); $('#job-name')?.focus(); break; }
    case 'open-job': ui.jobId = t.dataset.id; saveUi(); render(); window.scrollTo(0, 0); break;
    case 'close-job': ui.jobId = null; pick = null; confirmKey = null; saveUi(); render(); break;
    case 'del-job': del('jobs', j.id); ui.jobId = null; confirmKey = null; saveUi(); render(); toast('Zakázka smazána'); break;
    case 'add-group': j.groups.push(newGroup()); saveJob(); render(); break;
    case 'del-group': j.groups = j.groups.filter(x => x !== g); saveJob(); render(); break;
    case 'sel-all': case 'sel-none': j.groups.forEach(x => x.selected = act === 'sel-all'); saveJob(); render(); break;
    case 'add-cut': addCut(g); break;
    case 'del-cut': g.cuts = g.cuts.filter(c => c.id !== t.closest('[data-c]').dataset.c); saveJob(); render(); break;
    case 'paste': {
      const rows = parseList($('#paste-' + g.id).value);
      if (!rows.length) { toast('V textu jsem nenašel žádné délky'); break; }
      g.cuts.push(...rows); saveJob(); render(); toast(`Přidáno ${rows.length} ${pl(rows.length, 'řádek', 'řádky', 'řádků')}`); break;
    }
    case 'open-pick': {
      const same = pick && pick.ctx === t.dataset.ctx && pick.kind === t.dataset.kind;
      pick = same ? null : { ctx: t.dataset.ctx, kind: t.dataset.kind, q: '' };
      render(); if (pick) $('#pick-q')?.focus(); break;
    }
    case 'close-pick': pick = null; render(); break;
    case 'pick-all': pick.all = true; $('#pick-list').innerHTML = pickListHtml(); break;
    case 'pick': choose(t.dataset.id); break;
    case 'pick-add': {
      const name = pick.q.trim();
      const o = pick.kind === 'profiles' ? { id: uid(), systemId: pickSystem() || ui.lastSystemId || null, name, code: '', barLen: settings.barLen, aliases: [] } : { id: uid(), name, code: '', finish: '', hex: '', aliases: [] };
      put(pick.kind, o); toast(`„${name}“ přidáno do katalogu. Doplnit ho můžete v Katalogu.`); choose(o.id); break;
    }
    case 'optimize': runOptimize(t); break;
    case 'save-result': saveResult(); break;
    case 'back-job': if (ui.result && D.jobs.has(ui.result.jobId)) ui.jobId = ui.result.jobId; go('jobs'); break;
    case 'copy-text': {
      const txt = sheetText(ui.result);
      try { navigator.clipboard.writeText(txt).then(() => toast('Plán zkopírován'), () => toast('Kopírování tady není povolené')); } catch (err) { toast('Kopírování tady není povolené'); }
      break;
    }
    case 'pdf': exportPdf(ui.result, t); break;
    case 'open-hist': { ui.result = plain(D.history.get(t.dataset.id)); go('sheet'); break; }
    case 'reuse': {
      const r = ui.result;
      const nj = { id: uid(), name: (r.name || '') + ' (kopie)', created: today(), simplicity: r.simplicity, groups: r.groups.map(gr => ({ ...plain(gr.group), id: uid(), selected: true, cutAt: null })) };
      put('jobs', nj); ui.jobId = nj.id; go('jobs'); break;
    }
    case 'stock-minus': {
      const s = D.stock.get(t.dataset.id); if (!s) break;
      if (s.qty > 1) { s.qty--; put('stock', s); } else del('stock', s.id);
      render(); break;
    }
    case 'stock-add': {
      const len = parseFloat(($('#st-len').value || '').replace(',', '.')), qty = parseInt($('#st-qty').value || '1', 10);
      if (!stockForm.profileId || !stockForm.colorId) { toast('Vyberte profil a barvu'); break; }
      if (!(len > 0)) { $('#st-len').focus(); break; }
      addStock(stockForm.profileId, stockForm.colorId, len, qty > 0 ? qty : 1, 'Ručně');
      render(); toast('Přidáno do skladu'); break;
    }
    case 'cat-tab': ui.catTab = t.dataset.kind; edit = null; confirmKey = null; saveUi(); render(); break;
    case 'cat-new': edit = { kind: ui.catTab, id: null }; confirmKey = null; render(); $('#e-name')?.focus(); break;
    case 'cat-edit': edit = { kind: ui.catTab, id: t.dataset.id }; confirmKey = null; render(); break;
    case 'cat-cancel': edit = null; confirmKey = null; render(); break;
    case 'cat-save': {
      const name = $('#e-name').value.trim();
      if (!name) { $('#e-name').focus(); toast(edit.kind === 'profiles' ? 'Doplňte název profilu' : 'Doplňte název'); break; }
      if (edit.kind === 'systems') {
        const s = { ...(edit.id ? D.systems.get(edit.id) : { id: uid() }), name };
        put('systems', s); edit = null; render(); toast('Uloženo'); break;
      }
      const aliases = $('#e-aliases').value.split('\n').map(s => s.trim()).filter(Boolean);
      let systemId = edit.kind === 'profiles' ? $('#e-system').value : null;
      if (systemId === '__new') {
        const nm = $('#e-newsys').value.trim();
        if (!nm) { $('#e-newsys').focus(); toast('Doplňte název nového systému'); break; }
        const ex = [...D.systems.values()].find(s => norm(s.name) === norm(nm));
        const s = ex || { id: uid(), name: nm }; if (!ex) put('systems', s); systemId = s.id;
      }
      if (edit.kind === 'profiles') ui.lastSystemId = systemId || null;
      const base = edit.id ? D[edit.kind].get(edit.id) : { id: uid() };
      const o = edit.kind === 'profiles'
        ? { ...base, systemId: systemId || null, name, code: $('#e-code').value.trim(), barLen: parseFloat($('#e-bar').value.replace(',', '.')) || settings.barLen, aliases }
        : { ...base, name, code: $('#e-code').value.trim(), finish: $('#e-finish').value.trim(), hex: $('#e-hex').value, aliases };
      delete o.kind; delete o.system;
      delete o.example;
      put(edit.kind, o); edit = null; render(); toast('Uloženo'); break;
    }
    case 'cat-del': del(edit.kind, edit.id); edit = null; confirmKey = null; render(); toast('Smazáno'); break;
    case 'imp-cancel': imp = null; pick = null; render(); break;
    case 'imp-toggle': imp.blocks[+t.dataset.i].on = !imp.blocks[+t.dataset.i].on; render(); break;
    case 'imp-new-profile': {
      const b = imp.blocks[+t.dataset.i];
      const o = { id: uid(), systemId: imp.systemId || null, name: b.ozn || b.desc || b.article, code: b.article, barLen: b.barLen || settings.barLen, aliases: [] };
      put('profiles', o); b.profileId = o.id; render(); toast('Profil založen. Systém a název můžete upravit v Katalogu.'); break;
    }
    case 'imp-new-color': {
      const b = imp.blocks[+t.dataset.i];
      const o = { id: uid(), name: b.colorText, code: b.colorCode.replace(/\/+$/, ''), finish: '', hex: '', aliases: [] };
      put('colors', o); b.colorId = o.id; render(); toast('Barva založena. Upravit ji můžete v Katalogu.'); break;
    }
    case 'imp-go': finishImport(); break;
    case 'load-examples': loadExamples(); render(); toast('Ukázková data načtena'); break;
    case 'rm-examples': removeExamples(); confirmKey = null; if (ui.jobId && !D.jobs.has(ui.jobId)) ui.jobId = null; render(); toast('Ukázky smazány'); break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target.id || '';
  if (/^add-(len|qty|lbl)-/.test(id)) {
    e.preventDefault(); const g = gOf(e.target);
    if (id.startsWith('add-len')) { if (e.target.value) $('#add-qty-' + g.id).focus(); return; }
    addCut(g);
  } else if (id === 'pick-q') { e.preventDefault(); const first = $('#pick-list .opt'); if (first) first.click(); }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'simp') { $('#simp-lbl').textContent = simpText(+el.value); }
  else if (el.id === 'pick-q') { pick.q = el.value; $('#pick-list').innerHTML = pickListHtml(); }
  else if (el.id === 'cat-q') { ui.catQ = el.value; const pos = el.selectionStart; render(); const n = $('#cat-q'); n.focus(); n.setSelectionRange(pos, pos); }
  else if (el.id === 'stock-q') { ui.stockQ = el.value; const pos = el.selectionStart; render(); const n = $('#stock-q'); n.focus(); n.setSelectionRange(pos, pos); }
});

document.addEventListener('change', e => {
  const el = e.target, j = curJob();
  if (el.id === 'e-system') { $('#e-newsys').hidden = el.value !== '__new'; if (el.value === '__new') $('#e-newsys').focus(); return; }
  if (el.id === 'job-system') { j.systemId = el.value || null; saveJob(); render(); return; }
  if (el.id === 'imp-system') { imp.systemId = el.value || null; render(); return; }
  if (el.id === 'imp-file') { const f = el.files && el.files[0]; el.value = ''; if (f) startImport(f, j ? j.id : null); return; }
  if (el.id === 'simp') { j.simplicity = +el.value; saveJob(); }
  else if (el.id === 'job-name') { j.name = el.value.trim(); saveJob(); }
  else if (el.dataset.gf) {
    const g = gOf(el), f = el.dataset.gf;
    g[f] = f === 'useStock' || f === 'selected' ? el.checked : (parseFloat(el.value.replace(',', '.')) || settings.barLen);
    saveJob(); render();
  } else if (el.dataset.cf) {
    const g = gOf(el), c = g.cuts.find(x => x.id === el.closest('[data-c]').dataset.c), f = el.dataset.cf;
    c[f] = f === 'label' ? el.value : (parseFloat(el.value.replace(',', '.')) || 0);
    saveJob();
  } else if (el.dataset.sf) {
    const v = parseFloat(el.value.replace(',', '.'));
    if (v >= 0) { settings[el.dataset.sf] = v; putSettings(); }
  }
});

function runOptimize(btn) {
  btn.disabled = true; btn.textContent = 'Počítám…';
  setTimeout(() => {
    const j = curJob(), st = settings;
    const o = { kerf: +st.kerf, trim: +st.trim, threshold: +st.threshold, simplicity: j.simplicity ?? 60 };
    const groups = j.groups.filter(g => g.selected && g.profileId && g.colorId && g.cuts.some(c => c.len > 0 && c.qty > 0)).map(g => {
      const p = P(g.profileId), c = C(g.colorId);
      const plan = optimize(g.cuts, { barLen: +g.barLen || st.barLen, ...o }, g.useStock ? stockFor(g) : []);
      return { gid: g.id, group: plain(g), title: `${pName(p)} · ${cName(c)}`, sub: [pSub(p), cSub(c)].filter(Boolean).join(' · '), barLen: +g.barLen || st.barLen, plan };
    });
    ui.result = { id: uid(), jobId: j.id, name: j.name, date: today(), simplicity: o.simplicity, settings: { kerf: o.kerf, trim: o.trim, threshold: o.threshold }, groups, savedId: null };
    go('sheet');
  }, 30);
}

function addStock(profileId, colorId, len, qty, source) {
  const ex = [...D.stock.values()].find(s => s.profileId === profileId && s.colorId === colorId && s.len === len);
  if (ex) { ex.qty += qty; put('stock', ex); }
  else put('stock', { id: uid(), profileId, colorId, len, qty, source, date: today() });
}

function saveResult() {
  const r = ui.result;
  let missing = 0;
  for (const gr of r.groups) {
    const { profileId, colorId } = gr.group;
    for (const b of gr.plan.bars) {
      if (b.src === 'stock') {
        const s = (D.stock.get(b.stockId)) || [...D.stock.values()].find(x => x.profileId === profileId && x.colorId === colorId && x.len === b.len);
        if (s) { if (s.qty > 1) { s.qty--; put('stock', s); } else del('stock', s.id); } else missing++;
      }
      if (b.keep) addStock(profileId, colorId, b.leftover, 1, r.name || 'Bez názvu');
    }
  }
  r.savedId = r.id;
  const h = plain(r);
  h.savedAt = new Date().toISOString();
  h.groups.forEach(gr => { delete gr.plan.bars; });
  put('history', h);
  const j = D.jobs.get(r.jobId);
  if (j) { for (const gr of r.groups) { const g = j.groups.find(x => x.id === gr.gid); if (g) { g.cutAt = r.date; g.selected = false; } } put('jobs', j); }
  saveUi(); render();
  toast(missing ? `Uloženo. ${missing} ${pl(missing, 'použitý zbytek už', 'použité zbytky už', 'použitých zbytků už')} ve skladu nebyl${missing > 1 ? 'y' : ''}.` : 'Uloženo, sklad upraven');
}


// ---- REF2MEN import: match PDF articles to catalog profiles and colors, learn new names ----
const colorAlias = b => `${b.colorText} ${b.colorCode}`.trim();
const hasAlias = (list, s) => (list || []).some(a => norm(a) === norm(s));
function matchProfile(b) {
  const keys = [b.article, b.ozn, b.desc].filter(Boolean).map(norm);
  return [...D.profiles.values()].find(p => p.code && norm(p.code) === norm(b.article)) ||
    [...D.profiles.values()].find(p => (p.aliases || []).some(a => keys.includes(norm(a))));
}
function matchColor(b) { return [...D.colors.values()].find(c => hasAlias(c.aliases, colorAlias(b))); }

async function startImport(file, jobId) {
  toast('Čtu PDF…');
  let parsed;
  try { parsed = parseRef2men(await pdfLines(file)); }
  catch (e) { toast('PDF se nepodařilo přečíst: ' + (e.message || e)); return; }
  if (!parsed.blocks.length) { toast('V PDF jsem nenašel žádné řezy. Je to Seznam řezů z REF2MEN?'); return; }
  imp = { file: file.name, order: parsed.order, customer: parsed.customer, jobId, blocks: parsed.blocks.map(b => {
    const p = matchProfile(b), c = matchColor(b);
    return { ...b, on: !!p, profileId: p ? p.id : null, colorId: c ? c.id : null, auto: { p: !!p, c: !!c } };
  }) };
  // recognized profiles first; the rest (often small door parts) start unticked at the bottom
  imp.blocks.sort((x, y) => (y.auto.p - x.auto.p));
  // the job's system: the one most of the recognized profiles belong to
  const tally = new Map();
  imp.blocks.forEach(b => { const s = b.profileId && P(b.profileId).systemId; if (s) tally.set(s, (tally.get(s) || 0) + 1); });
  const target = jobId && D.jobs.get(jobId);
  imp.systemId = (target && target.systemId) || ([...tally.entries()].sort((x, y) => y[1] - x[1])[0] || [null])[0];
  pick = null; ui.tab = 'jobs'; render(); window.scrollTo(0, 0);
}

function importView() {
  const on = imp.blocks.filter(b => b.on);
  const missing = on.filter(b => !b.profileId || !b.colorId).length;
  const target = imp.jobId && D.jobs.get(imp.jobId);
  const pieces = on.reduce((a, b) => a + b.cuts.length, 0);
  return `
    <div><button class="link on-navy" data-act="imp-cancel">← Zrušit import</button></div>
    <div class="panel accent">
      <h1>Import z REF2MEN</h1>
      <div class="muted">${imp.order ? `Zakázka ${esc(imp.order)}` : esc(imp.file)}${imp.customer ? ' · ' + esc(imp.customer) : ''}</div>
      <label class="f" style="max-width:320px">Systém zakázky<select id="imp-system"><option value="">— různé —</option>${sortedSystems().map(s => `<option value="${s.id}" ${s.id === imp.systemId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <p class="small">${target ? `Profily se přidají do zakázky <b>${esc(target.name || 'Bez názvu')}</b>.` : 'Vytvoří se nová zakázka.'} Ke každému artiklu z PDF vyberte profil a barvu z katalogu. Aplikace si přiřazení zapamatuje, takže příště se doplní samo.</p>
    </div>
    ${impBlocks(true)}
    ${imp.blocks.some(b => !b.auto.p) ? `<div class="spread on-navy" style="margin-top:6px"><h2>Nerozpoznané profily (${imp.blocks.filter(b => !b.auto.p).length})</h2></div>
      <p class="small on-navy" style="margin-top:-6px">Tyto artikly zatím nejsou v katalogu. Zaškrtněte ty, které chcete řezat, a přiřaďte jim profil. Příště se rozpoznají samy.</p>
      <div class="panel" style="gap:2px;padding:8px 10px">${impBlocks(false)}</div>` : ''}
    <div class="go ${pick ? 'static' : ''}"><div class="go-in">
      <button class="btn primary big" data-act="imp-go" ${on.length && !missing ? '' : 'disabled'}>Importovat</button>
      <span class="sel">${on.length} ${pl(on.length, 'profil', 'profily', 'profilů')}, ${pieces} ${pl(pieces, 'kus', 'kusy', 'kusů')}${missing ? ` · u ${missing} chybí profil nebo barva` : ''}</span>
    </div></div>`;
}

function impBlocks(recognized) {
  return imp.blocks.map((b, i) => [b, i]).filter(([b]) => b.auto.p === recognized).map(([b, i]) => {
    const ctx = 'imp:' + i, open = pick && pick.ctx === ctx;
    const n = b.cuts.length;
    const head = `<label class="ghead toggle"><input type="checkbox" data-act="imp-toggle" data-i="${i}" ${b.on ? 'checked' : ''} aria-label="Importovat tento artikl"><span class="gnum">${i + 1}</span><h3 style="font-size:${recognized || b.on ? 21 : 18}px">${esc(recognized ? pShort(P(b.profileId), imp) : b.ozn)} <span class="muted small">art. ${esc(b.article)}${recognized ? '' : ` · ${esc(b.colorText)} · ${n} ${pl(n, 'kus', 'kusy', 'kusů')}`}</span></h3></label>`;
    if (!recognized && !b.on) return `<div class="imp-row">${head}</div>`;
    const lens = new Map(); b.cuts.forEach(c => lens.set(c.len, (lens.get(c.len) || 0) + 1));
    const body = `
      <div class="small muted">V PDF: ${esc(b.ozn)} · ${esc(b.desc)} · barva ${esc(b.colorText)} ${esc(b.colorCode)} · tyč ${num(b.barLen || settings.barLen)} mm</div>
      <div class="chips">${[...lens.entries()].sort((x, y) => y[0] - x[0]).map(([l, k]) => `<span class="chip">${k}× ${num(l)}</span>`).join('')}</div>
      ${b.on ? `<div class="pickers" style="grid-template-columns:1fr 1fr">
        ${pickerHtml(ctx, 'profiles', b.profileId)}${pickerHtml(ctx, 'colors', b.colorId)}
        ${open ? pickBoxHtml() : ''}
      </div>
      <div class="actions">
        ${b.profileId ? (b.auto.p && b.profileId === (matchProfile(b) || {}).id ? '<span class="chip ok">profil rozpoznán</span>' : '') : `<button class="btn" data-act="imp-new-profile" data-i="${i}">Založit profil „${esc(b.ozn)}“</button>`}
        ${b.colorId ? (b.auto.c && b.colorId === (matchColor(b) || {}).id ? '<span class="chip ok">barva rozpoznána</span>' : '') : `<button class="btn" data-act="imp-new-color" data-i="${i}">Založit barvu „${esc(b.colorText)}“</button>`}
      </div>` : ''}`;
    return recognized ? `<div class="panel ${b.on ? '' : 'off'}">${head}${body}</div>` : `<div class="imp-row open">${head}${body}</div>`;
  }).join('');
}

function finishImport() {
  const groups = [];
  for (const b of imp.blocks.filter(b => b.on && b.profileId && b.colorId)) {
    // remember the PDF names so the next import matches on its own
    const p = { ...P(b.profileId), aliases: [...(P(b.profileId).aliases || [])] };
    let changed = false;
    if (!p.code) { p.code = b.article; changed = true; }
    for (const s of [b.article, b.ozn, b.desc]) if (s && norm(s) !== norm(p.code) && !hasAlias(p.aliases, s)) { p.aliases.push(s); changed = true; }
    if (changed) put('profiles', p);
    const c = { ...C(b.colorId), aliases: [...(C(b.colorId).aliases || [])] };
    if (!hasAlias(c.aliases, colorAlias(b))) { c.aliases.push(colorAlias(b)); put('colors', c); }
    const cuts = new Map();
    for (const x of b.cuts) {
      const k = x.len + '|' + x.label;
      if (cuts.has(k)) cuts.get(k).qty++; else cuts.set(k, { id: uid(), len: x.len, qty: 1, label: x.label });
    }
    groups.push({ id: uid(), profileId: b.profileId, colorId: b.colorId, barLen: b.barLen || p.barLen || settings.barLen, useStock: true, selected: true, cuts: [...cuts.values()] });
  }
  let j = imp.jobId && D.jobs.get(imp.jobId);
  if (j) { j = plain(j); j.groups = (j.groups || []).filter(g => g.profileId || g.cuts.length).concat(groups); if (!j.systemId) j.systemId = imp.systemId || null; }
  else j = { id: uid(), name: [imp.order, imp.customer].filter(Boolean).join(' '), created: today(), simplicity: 60, systemId: imp.systemId || null, groups };
  put('jobs', j);
  ui.jobId = j.id; imp = null; pick = null; saveUi(); render(); window.scrollTo(0, 0);
  toast(`Importováno ${groups.length} ${pl(groups.length, 'profil', 'profily', 'profilů')}`);
}

window.addEventListener('pagehide', saveUi);
// Show unexpected errors instead of failing silently, so problems can be reported.
window.addEventListener('error', e => toast('Chyba aplikace: ' + (e.message || e)));
boot();
