// Server part for the Cloudflare deployment (used by server/worker.js and functions/ for Pages): a tiny document store on D1, behind Cloudflare Access.
//   GET    /api/changes?since=REV   documents changed after REV (deleted ones come back with data: null)
//   PUT    /api/docs/COLL/ID        save one document (JSON body)
//   DELETE /api/docs/COLL/ID        delete one document
//   POST   /api/bulk                save many documents [{coll, id, data}] (backup restore)
//   GET    /api/me                  the signed-in email
// Every request must carry a valid Cloudflare Access token (env TEAM_DOMAIN + POLICY_AUD),
// so the data stays private even if the Access gate in front of the site is misconfigured.
// For local development only, ALLOW_ANON=1 skips the check.

const COLLS = new Set(['systems', 'profiles', 'colors', 'finishes', 'armatures', 'stock', 'jobs', 'history', 'config']);
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_DOC = 900 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL, by TEXT, PRIMARY KEY (coll, id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS docs_rev ON docs (rev)')
  ]);
  schemaReady = true;
}
// rev is a single increasing counter, so a client only has to remember the last one it saw
const upsert = (db, coll, id, data, by) => db.prepare(
  'INSERT INTO docs (coll, id, data, rev, by) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(rev), 0) + 1 FROM docs), ?4) ' +
  'ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, rev = excluded.rev, by = excluded.by').bind(coll, id, data, by);

// ---- Cloudflare Access token check ----
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
let keys = null, keysAt = 0;
async function accessKeys(team) {
  if (keys && Date.now() - keysAt < 3600e3) return keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  keys = (await r.json()).keys; keysAt = Date.now();
  return keys;
}
async function checkAccess(request, env) {
  if (env.ALLOW_ANON === '1') return { email: 'local' };
  const team = String(env.TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!team || !env.POLICY_AUD) return { error: json({ error: 'not_configured' }, 503) };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { error: json({ error: 'unauthenticated' }, 401) };
  try {
    const [h, p, s] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64url(h))), payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    let jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
    if (!jwk) { keys = null; jwk = (await accessKeys(team)).find(k => k.kid === header.kid); }
    if (!jwk || header.alg !== 'RS256') throw new Error('key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(h + '.' + p));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !aud.includes(env.POLICY_AUD) || payload.iss !== `https://${team}` || payload.exp * 1000 < Date.now()) throw new Error('claims');
    return { email: payload.email || payload.sub || '' };
  } catch (e) {
    return { error: json({ error: 'unauthenticated' }, 401) };
  }
}

export async function handleApi(request, env, path) {
  const who = await checkAccess(request, env);
  if (who.error) return who.error;
  if (!env.DB) return json({ error: 'no_database' }, 503);
  const db = env.DB;
  await ensureSchema(db);
  const m = request.method;

  if (path[0] === 'me' && m === 'GET') return json({ email: who.email });

  if (path[0] === 'changes' && m === 'GET') {
    const since = Math.max(0, parseInt(new URL(request.url).searchParams.get('since') || '0', 10) || 0);
    const { results } = await db.prepare('SELECT coll, id, data, rev FROM docs WHERE rev > ?1 ORDER BY rev LIMIT 2000').bind(since).all();
    return json({ docs: results.map(r => ({ coll: r.coll, id: r.id, rev: r.rev, data: r.data === null ? null : JSON.parse(r.data) })), more: results.length === 2000 });
  }

  if (path[0] === 'docs' && path.length === 3) {
    const [, coll, id] = path;
    if (!COLLS.has(coll) || !ID.test(id)) return json({ error: 'bad_path' }, 400);
    if (m === 'DELETE') { await upsert(db, coll, id, null, who.email).run(); return json({ ok: true }); }
    if (m === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_DOC) return json({ error: 'too_large' }, 413);
      let data; try { data = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'bad_json' }, 400);
      await upsert(db, coll, id, JSON.stringify(data), who.email).run();
      return json({ ok: true });
    }
  }

  if (path[0] === 'bulk' && m === 'POST') {
    let list; try { list = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!Array.isArray(list) || list.length > 500) return json({ error: 'bad_request' }, 400);
    const stmts = [];
    for (const d of list) {
      if (!d || !COLLS.has(d.coll) || !ID.test(d.id) || !d.data || typeof d.data !== 'object') return json({ error: 'bad_doc', doc: d && d.id }, 400);
      const text = JSON.stringify(d.data);
      if (text.length > MAX_DOC) return json({ error: 'too_large', doc: d.id }, 413);
      stmts.push(upsert(db, d.coll, d.id, text, who.email));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  return json({ error: 'not_found' }, 404);
}
