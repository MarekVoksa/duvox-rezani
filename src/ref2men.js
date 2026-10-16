// ---- REF2MEN "Seznam řezů" PDF import ----
// Reads the text of the PDF and returns one block per article (profile + color) with its cuts.
// Line shapes (from a REF2MEN export):
//   "Seznam řezů Zakázka: 2608282 Datum: 12.10.2026 Strana 1"
//   "550410 1701 Kří Z 60 bílá"                 article, variant, short name, color name
//   "159 / 159 / 159 /"                          color codes
//   "Číslo tyče 1 Křídlo Z60 BRID 6000 JŘ"       bar number, long name, bar length
//   "1 [01] 01 KŘÍDLO Vlevo 1346 45,0° 45,0°"    position, field, function + side, length, angles
function parseRef2men(lines) {
  const out = { order: '', customer: '', blocks: [] };
  let cur = null, expectCode = false, expectArticle = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\s+/g, ' ').trim();
    if (!t) continue;
    let m;
    if ((m = t.match(/Zakázka:\s*(\S+)/))) {
      if (!out.order) out.order = m[1];
      const next = (lines[i + 1] || '').replace(/\s+/g, ' ').trim();
      if (!out.customer && next && !/^Č\.\s?pozice/.test(next)) out.customer = next.split(' / ')[0].trim();
      continue;
    }
    if (expectCode) {
      expectCode = false;
      if (/^[\w.-]+\s*\//.test(t)) { cur.colorCode = t.replace(/\s+/g, ''); continue; }
    }
    // every article starts with this header row: whatever follows belongs to the next article, never to the previous one
    // (REF2MEN also lists e.g. steel reinforcement as article "1 1999" with no name or color)
    if (/^Číslo artiklu\b/.test(t)) { cur = null; expectArticle = true; continue; }
    const art = expectArticle ? t.match(/^(\d+)\s+(\d{1,5})(?:\s+(.+))?$/) : t.match(/^(\d{5,8})\s+(\d{2,5})\s+(.+)$/);
    expectArticle = false;
    if ((m = art) && !/°/.test(t)) {
      // short name and color are separate columns; the color is the last cell (see splitArticle)
      const [ozn, color] = m[3] ? splitArticle(lines[i], m[3]) : ['', ''];
      cur = { article: m[1], variant: m[2], ozn, colorText: color, colorCode: '', desc: '', barLen: 0, cuts: [], line: i };
      out.blocks.push(cur);
      expectCode = true;
      continue;
    }
    if (!cur) continue;
    if ((m = t.match(/^Číslo tyče\s*\d+\s+(.+?)\s+(\d{4,5})(?:\s+\S+)?$/))) {
      if (!cur.desc) { cur.desc = m[1]; if (!cur.ozn) cur.ozn = m[1]; }
      if (!cur.barLen) cur.barLen = +m[2];
      continue;
    }
    if ((m = t.match(/^(\d+)\s+\[(\d+)\]\s*(\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)°\s+(\d+(?:[.,]\d+)?)°$/))) {
      const len = parseFloat(m[5].replace(',', '.'));
      const what = m[4].toLowerCase().replace(/^./, c => c.toUpperCase());
      const a1 = m[6].replace(',0', ''), a2 = m[7].replace(',0', '');
      cur.cuts.push({ len, pos: m[1], field: `${m[2]}/${m[3]}`, label: `P${m[1]} ${what}`, angles: `${a1}°/${a2}°` });
    }
  }
  // merge blocks of the same article + color (they can repeat across pages)
  const merged = new Map();
  for (const b of out.blocks) {
    const k = b.article + '|' + b.variant + '|' + b.colorText + '|' + b.colorCode;
    if (merged.has(k)) merged.get(k).cuts.push(...b.cuts); else merged.set(k, b);
  }
  out.blocks = [...merged.values()].filter(b => b.cuts.length);
  return out;
}
// ---- REF2MEN "Seznam přířezů celk." (all cut pieces of an order, grouped by FUNKCE) ----
// Only frames, sashes and door sashes are kept, plus the reinforcement (armování) that belongs to them.
//   "FUNKCE..............: RÁM     GOLDEN OAK"                                 function, color
//   "4  599000  90BLR 68  BRILL (35/28/1,:1.670) h.-  1  1.792  135,0 135,0"   position, article, variant+name, (armature type: length), place, qty, length, angles
//   "FUNKCE..............: ARMOVÁNÍ     RÁM"                                   reinforcement for frames
//   "4  244516  111Armování  35/28/1,5 mm  h.-  1  1.670"                        position, article, variant+name, place, qty, length
const isPrirezy = lines => lines.slice(0, 20).some(l => /Seznam přířezů celk/i.test(l));
const PR_FUNCS = { 'RÁM': 'Rám', 'KŘÍDLO': 'Křídlo', 'DV.KŘÍDLO': 'Dv. křídlo' };
const PR_PLACES = { 'h.-': 'nahoře', 'd.-': 'dole', 'l.|': 'vlevo', 'p.|': 'vpravo', 'sv|': 'svisle', 'vo-': 'vodorovně' };
const prNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
// REF2MEN writes a mitre as 135°: the app counts it as 45°
const prAng = s => { const a = parseFloat(String(s).replace(',', '.')); return a > 90 ? Math.round((180 - a) * 10) / 10 : a; };
function parsePrirezy(lines) {
  const out = { kind: 'prirezy', order: '', customer: '', blocks: [], armatures: [] };
  const blocks = new Map(), arms = [];
  let sec = null;   // {kind: 'profile'|'arm'|null, func, color}
  const ROW = /^(\d+) (\S+) (\d{2,3})(.+?) ?(h\.-|d\.-|l\.\||p\.\||sv\||vo-) (\d+) (\d[\d.]*)(?: (\d+(?:,\d+)?) (\d+(?:,\d+)?))?$/;
  for (const raw of lines) {
    const t = raw.replace(/\s+/g, ' ').trim();
    let m;
    if ((m = t.match(/Číslo objednávky\.*:\s*(\S+)/)) && !out.order) out.order = m[1];
    if ((m = raw.match(/Stavba\.*:\s*(.+?)(?:\s{3,}|$)/)) && !out.customer) out.customer = m[1].trim();
    if ((m = raw.match(/^FUNKCE\.*:\s*(.+)$/))) {
      const [func, second = ''] = m[1].split(/\s{3,}/).map(x => x.trim());
      if (func === 'ARMOVÁNÍ') sec = PR_FUNCS[second] ? { kind: 'arm', func: second } : null;
      else sec = PR_FUNCS[func] ? { kind: 'profile', func, color: second } : null;
      continue;
    }
    if (!sec || !(m = t.match(ROW))) continue;
    const [, pos, article, variant, mid, place, qty, len, a1, a2] = m;
    if (sec.kind === 'arm') { arms.push({ code: article, name: mid.trim(), parent: sec.func, pos, place, qty: +qty, len: prNum(len) }); continue; }
    const am = mid.match(/\(\s*([^:)]*?)\s*:\s*([\d.]+)\s*\)\s*$/);
    const name = (am ? mid.slice(0, am.index) : mid).trim();
    const k = article + '|' + variant + '|' + sec.color;
    if (!blocks.has(k)) blocks.set(k, { article, variant, ozn: name, colorText: sec.color, colorCode: '', desc: '', func: sec.func, barLen: 0, cuts: [] });
    const piece = { len: prNum(len), pos, place, func: sec.func, label: `P${pos} ${PR_FUNCS[sec.func]} ${PR_PLACES[place]}`, angles: `${a1 ? prAng(a1) : 90}°/${a2 ? prAng(a2) : 90}°`, armLen: am ? prNum(am[2]) : 0 };
    for (let i = 0; i < +qty; i++) blocks.get(k).cuts.push({ ...piece });
  }
  // each piece's reinforcement: the ARMOVÁNÍ rows of its function with the same position, place and length (a door's lock side can have two)
  for (const b of blocks.values()) for (const c of b.cuts) {
    if (!c.armLen) continue;
    c.armCodes = [...new Set(arms.filter(a => a.parent === c.func && a.pos === c.pos && a.place === c.place && a.len === c.armLen).map(a => a.code))];
  }
  const used = new Set([...blocks.values()].flatMap(b => b.cuts.flatMap(c => c.armCodes || [])));
  out.armatures = [...new Map(arms.filter(a => used.has(a.code)).map(a => [a.code, { code: a.code, name: a.name }])).values()];
  out.blocks = [...blocks.values()];
  return out;
}

// The raw line keeps wide gaps between columns ("Kří Z 60      bílá"); use them to split name and color.
function splitArticle(raw, rest) {
  const cells = raw.trim().split(/\s{3,}|\t/).map(s => s.trim()).filter(Boolean);
  if (cells.length >= 2) {
    const color = cells[cells.length - 1];
    const ozn = rest.slice(0, rest.lastIndexOf(color)).trim();
    if (ozn) return [ozn, color];
  }
  const parts = rest.split(' ');
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

// pdf.js text items -> lines; columns further apart than ~2 characters are joined with a wide gap.
async function pdfLines(file) {
  await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [], meta = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 8;
      let r = rows.find(r => Math.abs(r.y - y) < h * 0.4);
      if (!r) { r = { y, h, items: [] }; rows.push(r); }
      r.items.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of r.items) {
        if (end !== null) s += it.x - end > r.h * 1.2 ? '     ' : (it.x - end > r.h * 0.15 ? ' ' : '');
        s += it.s; end = it.x + it.w;
      }
      lines.push(s); meta.push({ page: n, y: r.y, h: r.h, x: r.items[0].x });
    }
  }
  lines.meta = meta; lines.pdf = pdf;   // positions, so the profile pictures can be cut out later
  return lines;
}
// REF2MEN draws a small cross-section of the profile left of the article number.
// Render the page and cut that cell out: between the "Číslo artiklu" header and the color-code line, left of the number.
async function pdfProfileImages(lines, blocks) {
  if (!lines.meta || !lines.pdf) return;
  const pages = new Map();
  for (const b of blocks) {
    const m = lines.meta[b.line], hdr = lines.meta[b.line - 1], code = lines.meta[b.line + 1];
    if (!m || !hdr || hdr.page !== m.page) continue;
    try {
      if (!pages.has(m.page)) pages.set(m.page, await renderPdfPage(lines.pdf, m.page));
      const bottom = code && code.page === m.page ? code.y - code.h * 0.9 : m.y - m.h * 2.2;
      b.img = cropIcon(pages.get(m.page), hdr.x - 4, m.x - 1, hdr.y - hdr.h * 0.4, bottom);
    } catch (e) { /* a missing picture never blocks the import */ }
  }
}
async function renderPdfPage(pdf, n) {
  const page = await pdf.getPage(n), vp = page.getViewport({ scale: 4 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { ctx, vp };
}
function cropIcon({ ctx, vp }, x1, x2, yTop, yBottom) {
  const [ax, ay] = vp.convertToViewportPoint(x1, yTop), [bx, by] = vp.convertToViewportPoint(x2, yBottom);
  const sx = Math.max(0, Math.round(Math.min(ax, bx))), sy = Math.max(0, Math.round(Math.min(ay, by)));
  const w = Math.round(Math.abs(bx - ax)), h = Math.round(Math.abs(by - ay));
  if (w < 10 || h < 10) return null;
  const d = ctx.getImageData(sx, sy, w, h).data, dark = new Uint8Array(w * h), rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    if (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11 < 150) { dark[y * w + x] = 1; rows[y]++; cols[x]++; }
  }
  // table borders run across the whole cell; ignore them and keep the drawing inside
  const lineR = y => rows[y] > w * 0.85, lineC = x => cols[x] > h * 0.85;
  let x0 = w, y0 = h, xm = -1, ym = -1;
  for (let y = 0; y < h; y++) if (!lineR(y)) for (let x = 0; x < w; x++) if (dark[y * w + x] && !lineC(x)) { if (x < x0) x0 = x; if (x > xm) xm = x; if (y < y0) y0 = y; if (y > ym) ym = y; }
  if (xm - x0 < 12 || ym - y0 < 12) return null;
  const pad = 4, cw = xm - x0 + 1 + 2 * pad, ch = ym - y0 + 1 + 2 * pad, k = Math.min(1, 160 / Math.max(cw, ch));
  const out = document.createElement('canvas'); out.width = Math.round(cw * k); out.height = Math.round(ch * k);
  const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
  o.imageSmoothingQuality = 'high';
  o.drawImage(ctx.canvas, sx + x0 - pad, sy + y0 - pad, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

let pdfJsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  const add = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nepodařilo se načíst čtečku PDF')); document.head.appendChild(s); });
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  // The worker script runs in this page (no separate worker thread is allowed here).
  pdfJsLoading ||= add(base + 'pdf.worker.min.js').then(() => add(base + 'pdf.min.js'));
  return pdfJsLoading;
}

if (typeof module !== 'undefined') module.exports = { parseRef2men, parsePrirezy, isPrirezy };
