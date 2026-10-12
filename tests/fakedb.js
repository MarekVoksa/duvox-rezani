const deepFreeze=o=>{Object.values(o).forEach(v=>v&&typeof v==='object'&&deepFreeze(v));return Object.freeze(o)};
window.claude = { use: async (n) => {
  if (n !== 'db') return null;
  const store = {}; const subs = {};
  const snap = c => ({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, exists: true, data: () => deepFreeze(JSON.parse(JSON.stringify(d))), metadata: {} })) });
  const fire = c => setTimeout(() => (subs[c] || []).forEach(f => f(snap(c))), 80);
  const coll = c => ({ onSnapshot(f) { (subs[c] ||= []).push(f); setTimeout(() => f(snap(c)), 10); return () => {}; },
    doc: id => ({ set: async d => { (store[c] ||= {})[id] = d; fire(c); }, delete: async () => { delete (store[c] || {})[id]; fire(c); } }) });
  // keep re-firing jobs snapshots periodically like a live store with other writers
  setInterval(() => fire('jobs'), 300);
  return { collection: coll, doc: p => ({ onSnapshot() { return () => {}; }, set: async () => {} }) };
} };
