// Runs against `wrangler pages dev dist --d1 DB --binding ALLOW_ANON=1` (default http://localhost:8788):
// two browsers share data through the server, and a backup round-trips.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const base = process.argv[2] || 'http://localhost:8788/';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async () => { const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(base); await p.waitForFunction(() => mode !== 'loading', null, { timeout: 15000 }); return p; };
  const a = await open(), c = await open();
  console.log('mode', await a.evaluate(() => mode));
  // A adds a system in the catalog
  await a.click('#tabs [data-tab=catalog]'); await a.click('[data-act=cat-tab][data-kind=systems]');
  await a.click('[data-act=cat-new]'); await a.fill('#e-name', 'Testsystém ' + Date.now()); await a.click('[data-act=cat-save]');
  const name = await a.evaluate(() => [...D.systems.values()].map(s => s.name).find(n => n.startsWith('Testsystém')));
  await c.waitForTimeout(6500);
  console.log('B sees A\'s system:', await c.evaluate(n => [...D.systems.values()].some(s => s.name === n), name));
  // backup from A, delete the system in A, restore in B
  await a.click('[data-act=cat-tab][data-kind=systems]').catch(() => {});
  await a.click('#tabs [data-tab=catalog]');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-act=backup]')]);
  const file = path.join(process.cwd(), 'backup.json'); await dl.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('backup', dl.suggestedFilename(), 'systems', bk.systems.length);
  const id = await a.evaluate(n => [...D.systems.values()].find(s => s.name === n).id, name);
  await a.evaluate(i => del('systems', i), id); await a.waitForTimeout(1500);
  c.on('dialog', d => d.accept());
  await c.click('#tabs [data-tab=catalog]');
  await c.setInputFiles('#restore-file', file); await c.waitForTimeout(2500);
  await a.waitForTimeout(6000);
  console.log('A sees restored system:', await a.evaluate(i => D.systems.has(i), id));
  console.log('errors', errs);
  await b.close();
})();
