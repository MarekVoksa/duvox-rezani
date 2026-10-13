// ---- PDF export: A4 pages drawn on a canvas (so Czech text needs no embedded font), packed as JPEG pages ----
// White paper; color only on the cut lengths. Each length also gets its own fill pattern so it still reads in black and white.
const PRINT_COLORS = ['#1a237e', '#e53935', '#2e7d32', '#f9a825', '#8e24aa', '#1e88e5', '#6d4c41', '#ef6c00'];
const PDF_DPI = 220, MM = PDF_DPI / 25.4, PAGE_W = 210, PAGE_H = 297, MARGIN = 10, CW = PAGE_W - 2 * MARGIN;
const PFONT = 'Rokkitt, Georgia, serif';

function printPattern(ctx, i) {
  const s = Math.round(2.4 * MM), c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'), col = PRINT_COLORS[i % 8];
  g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = s * 0.3;
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const diag = flip => { for (const o of [-s, 0, s]) flip ? line(o, 0, o + s, s) : line(o, s, o + s, 0); };
  switch (i % 8) {
    case 0: g.fillRect(0, 0, s, s); break;                                                  // solid
    case 1: diag(false); break;                                                             // ////
    case 2: g.beginPath(); g.arc(s / 2, s / 2, s * 0.3, 0, 7); g.fill(); break;             // dots
    case 3: g.fillRect(0, 0, s, s * 0.5); break;                                            // ====
    case 4: g.lineWidth = s * 0.18; diag(false); diag(true); break;                         // xxxx
    case 5: diag(true); break;                                                              // \\\\
    case 6: g.fillRect(0, 0, s * 0.5, s); break;                                            // ||||
    case 7: g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2); break;  // checker
  }
  const p = ctx.createPattern(c, 'repeat'); p.setTransform(new DOMMatrix().scale(1 / MM)); return p;
}

// Build a list of blocks {h, draw(ctx, y), keepNext}; pages are filled top to bottom without splitting a block.
function pdfBlocks(r, ctx, imgs = []) {
  const B = [], font = (w, mm) => { ctx.font = `${w} ${mm}px ${PFONT}`; };
  const text = (s, x, y, w, mm, color = '#000', align = 'left') => { font(w, mm); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); };
  const wrap = (s, w, mm, max) => { font(400, mm); const out = []; let cur = ''; for (const word of s.split(' ')) { const t = cur ? cur + ' ' + word : word; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = word; } else cur = t; } if (cur) out.push(cur); return out; };
  const st = r.settings;
  B.push({ h: 14, draw: (c, y) => {
    text(r.name || 'Bez názvu', 0, y + 6, 700, 7);
    text(czDate(r.date), CW, y + 6, 700, 4.2, '#000', 'right');
    text(`Řez ${num(st.kerf)} mm · zaříznutí ${num(st.trim)} mm · zbytky od ${num(st.threshold)} mm · ${simpText(r.simplicity)}`, 0, y + 11, 400, 3.4, '#444');
  } });
  r.groups.forEach((gr, gi) => {
    const p = gr.plan, s = p.stats, L = gLetter(gi);
    const ci = new Map((p.setup || []).map((x, i) => [x.len, i]));
    const pat = len => printPattern(ctx, ci.get(len) ?? 0);
    const summary = s ? [`${s.newBars}× nová tyč ${num(gr.barLen)} mm`, s.stockUsed.length ? `${s.stockUsed.length}× zbytek ze skladu` : '', s.kept.length ? `${s.kept.length}× zbytek do skladu` : '',
      `odpad ${num((s.material ? (s.material - s.piecesLen - s.kept.reduce((a, b) => a + b, 0)) / s.material * 100 : 0).toFixed(1))} %`].filter(Boolean).join(' · ') : '';
    const im = imgs[gi], iw = im ? Math.min(14, 11 * im.naturalWidth / im.naturalHeight) : 0, tx = im ? 14 + iw + 2.5 : 14;
    B.push({ h: 14, keepNext: true, draw: (c, y) => {
      if (im) { c.drawImage(im, 13.5, y + 1, iw, 11); c.strokeStyle = '#999'; c.lineWidth = 0.2; c.strokeRect(13.5, y + 1, iw, 11); }
      c.fillStyle = '#000'; c.fillRect(0, y + 1.5, 11, 9);
      text(L, 5.5, y + 8.6, 800, 7, '#fff', 'center');
      text(gr.title, tx, y + 6, 700, 5);
      text([gr.sub, summary].filter(Boolean).join('  ·  '), tx, y + 10.6, 400, 3.3, '#333');
    } });
    for (const e of p.errors || []) B.push({ h: 5, draw: (c, y) => text('! ' + e, 0, y + 3.8, 700, 3.4, '#b00') });
    if (!s) return;
    p.patterns.forEach((pt, pi) => {
      const items = pt.groups.map(g => ({ g, lines: wrap(labelSummary(g.labels), 400, 3.1, CW - 36) }));
      const h = 15.6 + items.reduce((a, it) => a + Math.max(1, it.lines.length) * 4.8, 0) + 2;
      B.push({ h, draw: (c, y) => {
        c.strokeStyle = '#000'; c.lineWidth = 0.35; c.strokeRect(0.2, y + 1.2, 3.6, 3.6);      // tick box
        text(`${L}${pi + 1}`, 6, y + 4.9, 800, 5.2);
        text(`${pt.count}×`, 21, y + 4.9, 800, 5.2);
        text(pt.src === 'stock' ? `Zbytek ze skladu ${num(pt.len)} mm` : `Nová tyč ${num(pt.len)} mm`, 33, y + 4.6, 700, 3.9);
        text(pt.keep ? `Zbytek ${num(pt.leftover)} mm do skladu` : pt.leftover > 0 ? `Odpad ${num(pt.leftover)} mm` : 'Bez zbytku', CW, y + 4.6, 700, 3.5, pt.keep ? '#000' : '#555', 'right');
        // bar drawing
        const bx = 6, bw = CW - 6, by = y + 6.6, bh = 7.2;
        const segs = pt.groups.flatMap(g => Array(g.n).fill(g.len)), total = segs.reduce((a, b) => a + b, 0) + Math.max(pt.leftover, 0);
        let x = bx;
        for (const len of segs) {
          const w = len / total * bw;
          c.fillStyle = pat(len); c.fillRect(x, by, w, bh);
          font(800, 4.4); const tw = c.measureText(num(len)).width;
          if (tw + 2 < w) { c.fillStyle = '#fff'; c.fillRect(x + w / 2 - tw / 2 - 0.8, by + bh / 2 - 2.5, tw + 1.6, 5); text(num(len), x + w / 2, by + bh / 2 + 1.5, 800, 4.4, '#000', 'center'); }
          for (const [col, lw] of [['#fff', 1.6], ['#000', 0.7]]) { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x + w, by); c.lineTo(x + w, by + bh); c.stroke(); }  // white halo keeps the divider visible on any pattern
          x += w;
        }
        if (pt.leftover > 0) {
          const w = bx + bw - x;
          c.fillStyle = pt.keep ? '#fff' : '#d8d8d8'; c.fillRect(x, by, w, bh);
          font(400, 3); const lab = pt.keep ? 'sklad' : '';
          if (lab && c.measureText(lab).width + 1 < w) text(lab, x + w / 2, by + bh / 2 + 1, 400, 3, '#000', 'center');
        }
        c.strokeStyle = '#000'; c.lineWidth = 0.6; c.strokeRect(bx, by, bw, bh);
        // cut list
        let ly = by + bh + 4.8;
        for (const it of items) {
          c.fillStyle = pat(it.g.len); c.fillRect(6, ly - 3.4, 3.8, 3.8); c.strokeStyle = '#000'; c.lineWidth = 0.25; c.strokeRect(6, ly - 3.4, 3.8, 3.8);
          text(`${it.g.n}×`, 18.5, ly, 800, 4.6, '#000', 'right');
          text(num(it.g.len), 20, ly, 800, 4.6);
          (it.lines.length ? it.lines : ['']).forEach((ln, k) => text(ln, 36, ly + k * 4.8, 400, 3.1, '#333'));
          ly += Math.max(1, it.lines.length) * 4.8;
        }
        c.strokeStyle = '#bbb'; c.lineWidth = 0.2; c.beginPath(); c.moveTo(0, y + h - 0.6); c.lineTo(CW, y + h - 0.6); c.stroke();
      } });
    });
    B.push({ h: 9, draw: (c, y) => {
      text('Celkem:', 0, y + 4.6, 700, 3.4);
      let x = 14;
      for (const t of p.setup) {
        const lab = `${t.qty}× ${num(t.len)}`; font(700, 3.4); const w = c.measureText(lab).width;
        if (x + w + 6 > CW) break;
        c.fillStyle = pat(t.len); c.fillRect(x, y + 1.9, 3.2, 3.2); c.strokeStyle = '#000'; c.lineWidth = 0.25; c.strokeRect(x, y + 1.9, 3.2, 3.2);
        text(lab, x + 4.4, y + 4.6, 700, 3.4); x += w + 9;
      }
    } });
  });
  // helpers above draw on `ctx`; point it at the page being drawn
  return B.map(b => ({ ...b, draw: (c, y) => { ctx = c; b.draw(c, y); } }));
}

async function pdfPages(r) {
  try { await document.fonts.load(`700 12px Rokkitt`); await document.fonts.load(`400 12px Rokkitt`); await document.fonts.load(`800 12px Rokkitt`); } catch (e) {}
  const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(PAGE_W * MM); c.height = Math.round(PAGE_H * MM); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.setTransform(MM, 0, 0, MM, MARGIN * MM, MARGIN * MM); return { c, x }; };
  const probe = mk();
  // profile pictures (from REF2MEN) next to each profile heading
  const imgs = await Promise.all(r.groups.map(gr => {
    const p = typeof P === 'function' && P(gr.group.profileId);
    if (!p || !p.img) return null;
    const im = new Image(); im.src = p.img;
    return im.decode().then(() => im, () => null);
  }));
  const blocks = pdfBlocks(r, probe.x, imgs), bottom = PAGE_H - 2 * MARGIN - 6;
  // paginate: a profile heading stays with the bar below it
  const pages = [[]]; let y = 0;
  blocks.forEach((b, i) => {
    const need = b.h + (b.keepNext && blocks[i + 1] ? blocks[i + 1].h : 0);
    if (y + need > bottom && pages[pages.length - 1].length) { pages.push([]); y = 0; }
    pages[pages.length - 1].push({ b, y }); y += b.h;
  });
  const out = [];
  for (let n = 0; n < pages.length; n++) {
    const { c, x } = n === 0 ? probe : mk();
    for (const { b, y } of pages[n]) { x.save(); b.draw(x, y); x.restore(); }
    x.font = `400 2.8px ${PFONT}`; x.fillStyle = '#666'; x.textAlign = 'right';
    x.fillText(`${r.name || ''} · ${czDate(r.date)} · strana ${n + 1}/${pages.length}`, CW, PAGE_H - 2 * MARGIN + 2);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
    out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
  }
  return out;
}

function buildPdf(imgs) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (id, body) => { offs[id] = len; add(`${id} 0 obj\n`); body(); add('\nendobj\n'); };
  add('%PDF-1.4\n%âã\n');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Kids [${imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${imgs.length} >>`));
  imgs.forEach((im, i) => {
    const p = 3 + i * 3, cs = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    obj(p, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    obj(p + 1, () => add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(p + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); add(im.bytes); add('\nendstream'); });
  });
  const xref = len, total = 3 + imgs.length * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  add(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

async function exportPdf(r, btn) {
  if (!r) return;
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Připravuji PDF…';
  try {
    const blob = buildPdf(await pdfPages(r));
    const filename = `Rezani ${(r.name || 'plan').replace(/[\\/:*?"<>|]+/g, ' ').trim()} ${r.date}.pdf`;
    let dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) {}
    if (dl) {
      try { await dl.save({ filename, data: blob }); toast('PDF uloženo'); }
      catch (e) { if (e && e.code !== 'declined') toast('PDF se nepodařilo uložit: ' + (e.message || e.code)); }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  } catch (e) { toast('PDF se nepodařilo vytvořit: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.textContent = label; }
}
