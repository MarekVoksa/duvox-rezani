// REF2MEN import against the fake db: pictures, finish guess, finish buttons, and the learned mapping on a second import.
// PDF: argv[2] (default: the sample in the project files). pdf.js: PDFJS_DIR (cdnjs is not reachable from the test box).
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const pdfPath = process.argv[2] || '/mnt/project-files/uploads/REF2MEN-Optimalizace-Velickova.pdf';
const pdfjs = process.env.PDFJS_DIR;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8'), fake = fs.readFileSync(path.join(__dirname, 'fakedb.js'), 'utf8');
  if (pdfjs) await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(pdfjs, r.request().url().split('/').pop())) }));
  await p.route('http://t/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>' + fake + '</script></head><body>' + html + '</body></html>' }));
  await p.goto('http://t/'); await p.waitForTimeout(500);
  await p.setInputFiles('#imp-file', pdfPath); await p.waitForFunction(() => imp, null, { timeout: 20000 }); await p.waitForTimeout(300);
  const state = () => p.evaluate(() => imp && imp.blocks.map(b => `${b.article} on=${b.on} fin=${b.finish} color=${b.colorId ? C(b.colorId).name : '-'} img=${!!b.img}`));
  console.log('first import', await state());
  await p.screenshot({ path: 'imp1.png', fullPage: true });
  // tick the first two, create their profiles; switch the first to "Dekor/bílá" to see the color picker appear, then back
  for (const i of [0, 1]) { await p.click(`[data-act=imp-toggle][data-i="${i}"]`); await p.waitForTimeout(200); await p.click(`[data-act=imp-new-profile][data-i="${i}"]`); await p.waitForTimeout(200); }
  await p.click('[data-act=finish][data-ctx="imp:0"][data-v=dekor-bila]'); await p.waitForTimeout(200);
  console.log('after dekor/bílá: go disabled', await p.$eval('[data-act=imp-go]', x => x.disabled), 'color picker label', await p.$eval('[data-ctx="imp:0"][data-kind=colors]', x => x.closest('.f-pick').firstElementChild.textContent));
  await p.click('[data-act=finish][data-ctx="imp:0"][data-v=bila]'); await p.waitForTimeout(200);
  await p.click('[data-act=imp-go]'); await p.waitForTimeout(500);
  console.log('job groups', await p.$$eval('[data-g] h3', x => x.map(h => h.textContent)), 'imgs', await p.$$eval('[data-g] img.pimg', x => x.length));
  await p.screenshot({ path: 'job1.png', fullPage: true });
  await p.click('[data-act=close-job]'); await p.waitForTimeout(200);
  await p.setInputFiles('#imp-file', pdfPath); await p.waitForFunction(() => imp, null, { timeout: 20000 }); await p.waitForTimeout(300);
  console.log('second import', await state());
  console.log('errors', errs);
  await b.close();
})();
