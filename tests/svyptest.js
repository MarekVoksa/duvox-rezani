// The two REF2MEN documents of one order are matched to the same catalog profiles by article number:
// import the optimization ("Seznam řezů"), create its profiles, then the přířezy list must recognize them on its own.
// Also: positions with a letter ("5 A") and the decor side taken from the color text.
// PDFs: argv[2] (řezy) and argv[3] (přířezy), defaults are a sample order in the project files (not in the repo). pdf.js: PDFJS_DIR.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path'), os = require('os');
const up = '/mnt/project-files/uploads/hearth/';
const rezy = process.argv[2] || up + '371f1879-d747-4e38-8b1d-ca21ae84b6c0', prirezy = process.argv[3] || up + '0b0f23ed-f7fc-42d9-825e-d0f7d9e8e802';
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8').replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '');
  if (process.env.PDFJS_DIR) await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().split('/').pop())) }));
  await p.route('http://t/api/**', r => r.fulfill({ status: 404, body: '' }));
  await p.route('http://t/', r => r.fulfill({ contentType: 'text/html', body: html }));
  await p.goto('http://t/'); await p.waitForTimeout(600);
  const load = async (src, name) => { const tmp = path.join(os.tmpdir(), name); fs.copyFileSync(src, tmp); await p.evaluate(() => { imp = null; }); await p.setInputFiles('#imp-file', tmp); await p.waitForFunction(() => imp, null, { timeout: 20000 }); await p.waitForTimeout(300); };
  await load(rezy, 'rezy.pdf');
  await p.evaluate(() => { put('colors', { id: 'cw', name: 'Bílá', ref: '159', hex: '#fff' }); put('colors', { id: 'cg', name: 'Zlatý dub', ref: '7512', hex: '#b07a3a' }); });
  await p.click('[data-act=imp-cancel]'); await load(rezy, 'rezy.pdf');
  const r1 = await p.evaluate(() => imp.blocks.map(b => `${b.article} ${b.colorText} ${impCodes(b).join('/')} ${finName(F(b.finishId))} ${b.cuts.length}`));
  console.log(r1);
  if (r1.length !== 8) fail('řezy blocks ' + r1.length);
  const fin = await p.evaluate(() => Object.fromEntries(imp.blocks.map(b => [b.colorText, finType(F(b.finishId))])));
  console.log(fin);
  if (fin['Dekor / bílá'] !== 'dekor/bílá' || fin['Bílá / dekor obrácený kašír'] !== 'bílá/dekor') fail('decor side');
  await p.evaluate(() => { imp.blocks.forEach(b => { b.on = true; }); render(); });
  for (let i = 0; i < 8; i++) { const btn = await p.$(`[data-act=imp-new-profile][data-i="${i}"]`); if (btn) { await btn.click(); await p.waitForTimeout(80); } }
  await p.click('[data-act=imp-go]'); await p.waitForTimeout(300);
  await load(prirezy, 'prirezy.pdf');
  const r2 = await p.evaluate(() => imp.blocks.map(b => `${b.article} ${b.ozn} ${b.colorText} ${b.auto.p ? 'recognized ' + pName(P(b.profileId)) : 'NEW'} ${finName(F(b.finishId)) || 'NO FINISH'} ${b.cuts.length}`));
  console.log(r2);
  if (r2.length !== 6 || r2.some(x => x.includes('NEW'))) fail('přířezy not matched by article');
  if (r2.some(x => x.includes('NO FINISH')) || !r2.some(x => /kašír .* Bílá\/zlatý dub/.test(x))) fail('přířezy finish from the optimization');
  const total = await p.evaluate(() => imp.blocks.reduce((a, b) => a + b.cuts.length, 0)), arms = await p.evaluate(() => imp.blocks.reduce((a, b) => a + b.cuts.filter(c => (c.armCodes || []).length).length, 0));
  console.log('pieces', total, 'with armování', arms);
  console.log('errors', errs); if (errs.length) fail('errors');
  await b.close();
})();
