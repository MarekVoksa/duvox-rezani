// ---- Optimizer: 1D bar cutting with a simplicity weighting ----
// Material is valued in mm of fresh bar. A remnant on the shelf is worth
// KEEP_VALUE per mm, so cutting from stock is cheap and keeping a usable
// leftover gives part of its length back.
const KEEP_VALUE = 0.3;

function genPatterns(cap, lens, cnt, kf) {
  // Returns arrays of counts (one per item) that fit in cap.
  // Each piece consumes len + its kerf (wider for angled cuts); the last cut needs no kerf, hence C = cap + kerf.
  const d = lens.length, w = lens.map((l, i) => l + kf[i]), C = cap + Math.max(0, ...kf);
  const out = new Map();
  const add = c => { const k = c.join(','); if (!out.has(k)) out.set(k, c.slice()); };
  const zero = () => new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    if (!cnt[i]) continue;
    const n = Math.min(cnt[i], Math.floor(C / w[i]));
    if (n > 0) { const c = zero(); c[i] = n; add(c); }
  }
  for (let i = 0; i < d; i++) {
    if (!cnt[i]) continue;
    const maxA = Math.min(cnt[i], Math.floor(C / w[i]));
    for (let a = maxA; a >= 1 && a > maxA - 30; a--) {
      const rem = C - a * w[i];
      for (let j = 0; j < d; j++) {
        if (j === i || !cnt[j]) continue;
        const b = Math.min(cnt[j], Math.floor(rem / w[j]));
        if (b < 1) continue;
        const c = zero(); c[i] = a; c[j] = b; add(c);
        const rem2 = rem - b * w[j];
        let bestK = -1, bestM = 0, bestFill = 0;
        for (let k = 0; k < d; k++) {
          if (k === i || k === j || !cnt[k]) continue;
          const m = Math.min(cnt[k], Math.floor(rem2 / w[k]));
          if (m * w[k] > bestFill) { bestFill = m * w[k]; bestK = k; bestM = m; }
        }
        if (bestK >= 0) { const c3 = c.slice(); c3[bestK] = bestM; add(c3); }
      }
    }
  }
  // Best fill regardless of how many lengths (least-waste pattern), bounded search.
  const order = lens.map((_, i) => i).filter(i => cnt[i]).sort((x, y) => w[y] - w[x]);
  let best = 0, bestC = null, nodes = 0;
  const cur = zero();
  const dfs = (p, used) => {
    if (++nodes > 4000) return;
    if (used > best) { best = used; bestC = cur.slice(); }
    if (p >= order.length || best === C) return;
    const i = order[p];
    const max = Math.min(cnt[i], Math.floor((C - used) / w[i]));
    for (let n = max; n >= 0; n--) { cur[i] = n; dfs(p + 1, used + n * w[i]); if (best === C) break; }
    cur[i] = 0;
  };
  dfs(0, 0);
  if (bestC && best > 0) add(bestC);
  return [...out.values()];
}

function runGreedy(lens, demand, o, remnants, lam, kf) {
  const cnt = demand.slice();
  const rems = remnants.map(r => ({ len: r.len, avail: r.ids.length, ids: r.ids.slice() }));
  const bars = [];
  let left = cnt.reduce((a, b) => a + b, 0);
  while (left > 0) {
    let best = null;
    const options = [{ src: 'new', len: o.barLen, value: o.barLen }];
    for (const r of rems) if (r.avail > 0) options.push({ src: 'stock', len: r.len, value: KEEP_VALUE * r.len, rem: r });
    for (const opt of options) {
      const cap = opt.len - (opt.src === 'new' ? o.trim : o.trim / 2);
      if (cap <= 0) continue;
      for (const c of genPatterns(cap, lens, cnt, kf)) {
        let pieces = 0, used = 0, distinct = 0, n = 0;
        for (let i = 0; i < c.length; i++) if (c[i]) { pieces += c[i] * lens[i]; used += c[i] * (lens[i] + kf[i]); distinct++; n += c[i]; }
        const leftover = Math.max(0, cap - used);
        const keep = leftover >= o.threshold ? leftover : 0;
        const cost = opt.value - pieces - KEEP_VALUE * keep + lam * o.barLen * (distinct - 1);
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && n > best.n)) best = { cost, c, opt, leftover, keep, n, distinct };
      }
    }
    if (!best) break;
    const pieces = [];
    best.c.forEach((k, i) => { for (let t = 0; t < k; t++) pieces.push(i); cnt[i] -= k; left -= k; });
    let stockId = null;
    if (best.opt.src === 'stock') { best.opt.rem.avail--; stockId = best.opt.rem.ids.shift(); }
    bars.push({ src: best.opt.src, len: best.opt.len, value: best.opt.value, pieces, lens, leftover: best.leftover, keep: best.keep > 0, distinct: best.distinct, stockId });
  }
  return { bars, unplaced: left };
}

function evalPlan(bars, o, w) {
  let cost = 0, changes = 0;
  for (const b of bars) {
    const pieces = b.pieces.reduce((a, i) => a + b.lens[i], 0);
    cost += b.value - pieces - (b.keep ? KEEP_VALUE * b.leftover : 0);
    changes += b.distinct - 1;
  }
  return cost + w * o.barLen * changes;
}

// Cut angles in degrees (90 = square). The saw blade goes through kerf / sin(angle) of the bar's length.
const angleKerf = (kerf, a) => kerf / Math.sin(Math.max(15, Math.min(165, +a || 90)) * Math.PI / 180);

// cuts: [{len, qty, label, a1, a2}], o: {barLen,kerf,trim,threshold,simplicity(0..100)}, remnants: [{len, id}] (one per physical piece)
function optimize(cuts, o, remnants) {
  const errors = [];
  const cap = o.barLen - o.trim;
  // one item per length + angles; a piece's kerf is the average of its two end cuts
  const items = new Map();
  for (const c of cuts) {
    const len = +c.len, qty = Math.round(+c.qty || 0), a1 = +c.a1 || 45, a2 = +c.a2 || 45;
    if (!(len > 0) || qty < 1) continue;
    if (len > cap) { errors.push(`${len} mm je delší než použitelná tyč (${cap} mm)`); continue; }
    const k = len + '|' + a1 + '|' + a2;
    if (!items.has(k)) items.set(k, { len, a1, a2, kerf: (angleKerf(o.kerf, a1) + angleKerf(o.kerf, a2)) / 2, qty: 0, labels: [] });
    const e = items.get(k); e.qty += qty;
    for (let i = 0; i < qty; i++) e.labels.push(c.label || '');
  }
  const list = [...items.values()].sort((a, b) => b.len - a.len || a.a1 + a.a2 - b.a1 - b.a2);
  const lens = list.map(e => e.len), kf = list.map(e => e.kerf), demand = list.map(e => e.qty);
  const remMap = new Map();
  for (const r of remnants) {
    if (!remMap.has(r.len)) remMap.set(r.len, []);
    remMap.get(r.len).push(r.id);
  }
  const rems = [...remMap.entries()].map(([len, ids]) => ({ len, ids })).sort((a, b) => a.len - b.len);
  const s = Math.max(0, Math.min(100, o.simplicity)) / 100;
  const w = 0.002 + 0.5 * s * s;
  let best = null;
  for (const lam of [0, 0.005, 0.01, 0.02, 0.035, 0.05, 0.08, 0.12, 0.18, 0.25, 0.4, 0.6]) {
    const r = runGreedy(lens, demand, o, rems, lam, kf);
    if (r.unplaced) continue;
    const score = evalPlan(r.bars, o, w);
    if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 && r.bars.length < best.bars.length)) best = { score, bars: r.bars };
  }
  if (!best) return { bars: [], patterns: [], stats: null, errors: errors.concat(list.length ? ['Nepodařilo se umístit všechny kusy'] : []) };
  // assign labels, sort pieces longest first so each length is cut in one go
  const queues = list.map(e => e.labels.slice());
  const bars = best.bars.map(b => {
    const ps = b.pieces.slice().sort((x, y) => lens[y] - lens[x] || y - x).map(i => ({ item: i, len: lens[i], a1: list[i].a1, a2: list[i].a2, label: queues[i].shift() || '' }));
    return { src: b.src, len: b.len, stockId: b.stockId, pieces: ps, leftover: Math.floor(b.leftover), keep: b.keep, distinct: b.distinct };
  });
  // group identical bars into patterns: stock first, then most repeated
  const pmap = new Map();
  for (const b of bars) {
    const key = b.src + ':' + b.len + ':' + b.pieces.map(p => p.item).join(',');
    if (!pmap.has(key)) pmap.set(key, { key, src: b.src, len: b.len, count: 0, leftover: b.leftover, keep: b.keep, bars: [] });
    const p = pmap.get(key); p.count++; p.bars.push(b);
  }
  const patterns = [...pmap.values()].map(p => {
    const groups = [];
    p.bars[0].pieces.forEach(pc => {
      let g = groups.find(x => x.item === pc.item);
      if (!g) { g = { item: pc.item, len: pc.len, a1: pc.a1, a2: pc.a2, n: 0 }; groups.push(g); }
      g.n++;
    });
    const labels = {};
    for (const b of p.bars) for (const pc of b.pieces) if (pc.label) (labels[pc.item] = labels[pc.item] || []).push(pc.label);
    groups.forEach(g => { g.labels = labels[g.item] || []; });
    return { src: p.src, len: p.len, count: p.count, leftover: p.leftover, keep: p.keep, groups, stockIds: p.bars.map(b => b.stockId).filter(Boolean) };
  }).sort((a, b) => (a.src === b.src ? b.count - a.count || b.groups.length - a.groups.length : a.src === 'stock' ? -1 : 1));
  const newBars = bars.filter(b => b.src === 'new').length;
  const stockUsed = bars.filter(b => b.src === 'stock').map(b => b.len);
  const scrap = bars.reduce((a, b) => a + (b.keep ? 0 : b.leftover), 0);
  const kept = bars.filter(b => b.keep).map(b => b.leftover);
  const piecesLen = bars.reduce((a, b) => a + b.pieces.reduce((x, p) => x + p.len, 0), 0);
  const material = newBars * o.barLen + stockUsed.reduce((a, b) => a + b, 0);
  const changes = bars.reduce((a, b) => a + b.distinct - 1, 0);
  const setup = list.map((e, i) => ({ item: i, len: e.len, a1: e.a1, a2: e.a2, qty: e.qty }));
  return { bars, patterns, setup, errors, stats: { newBars, stockUsed, scrap, kept, piecesLen, material, changes, pieceCount: demand.reduce((a, b) => a + b, 0) } };
}

if (typeof module !== 'undefined') module.exports = { optimize, genPatterns };
