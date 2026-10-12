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
  let cur = null, expectCode = false;
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
    if ((m = t.match(/^(\d{5,8})\s+(\d{2,5})\s+(.+)$/)) && !/°/.test(t)) {
      // short name and color are separate columns; the color is the last cell (see splitArticle)
      const [ozn, color] = splitArticle(lines[i], m[3]);
      cur = { article: m[1], variant: m[2], ozn, colorText: color, colorCode: '', desc: '', barLen: 0, cuts: [] };
      out.blocks.push(cur);
      expectCode = true;
      continue;
    }
    if (!cur) continue;
    if ((m = t.match(/^Číslo tyče\s*\d+\s+(.+?)\s+(\d{4,5})(?:\s+\S+)?$/))) {
      if (!cur.desc) cur.desc = m[1];
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
  const lines = [];
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
      lines.push(s);
    }
  }
  return lines;
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

if (typeof module !== 'undefined') module.exports = { parseRef2men };
