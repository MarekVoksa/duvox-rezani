// Colors + provedení, migration of older data, cut angles in the job, the optimization and the PDF.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8').replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '');
  await p.route('http://t/api/**', r => r.fulfill({ status: 404, body: '' }));
  await p.route('http://t/', r => r.fulfill({ contentType: 'text/html', body: html }));
  // older data saved in this browser: colors with REF2MEN names, groups with colorId + finish
  await p.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('duvox-rezani.data.v2', JSON.stringify({ settings: {},
      systems: [{ id: 's1', name: 'Brillant' }],
      profiles: [{ id: 'p1', systemId: 's1', name: 'rám', barLen: 6000, aliases: [] }],
      colors: [{ id: 'cw', name: 'Bílá', code: '', finish: '', hex: '#ffffff', aliases: ['bílá 159/159/159/'] }, { id: 'cz', name: 'Zlatý dub', code: '', finish: 'fólie', hex: '#a8692e', aliases: ['Zlatý dub/bílá 7512/159/7512/'] }],
      stock: [{ id: 'st1', profileId: 'p1', colorId: 'cz', finish: 'dekor', len: 2000, qty: 1 }, { id: 'st2', profileId: 'p1', colorId: null, finish: 'bila', len: 1500, qty: 1 }],
      jobs: [{ id: 'j1', name: '2610 Test', created: '2026-10-13', simplicity: 60, groups: [
        { id: 'g1', profileId: 'p1', colorId: 'cz', finish: 'dekor-bila', barLen: 6000, useStock: true, selected: true, cuts: [{ id: 'c1', len: 1400, qty: 4, label: 'O1' }] },
        { id: 'g2', profileId: 'p1', colorId: 'cw', barLen: 6000, useStock: true, selected: true, cuts: [{ id: 'c2', len: 900, qty: 2, label: 'Dveře' }] }] }],
      history: [] }));
  });
  await p.goto('http://t/'); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({
    refs: [...D.colors.values()].map(c => c.name + '=' + c.ref),
    groups: curJob ? D.jobs.get('j1').groups.map(g => `${g.finishId} ${colorLabel(g)} ${finCodes(F(g.finishId))} old=${'colorId' in g}`) : null,
    stock: [...D.stock.values()].map(s => colorLabel(s) + ' ' + finCodes(F(s.finishId)))
  }));
  console.log('migrated', JSON.stringify(st, null, 1));
  if (!st.refs.includes('Bílá=159') || !st.refs.includes('Zlatý dub=7512')) fail('refs');
  if (!st.groups[0].includes('159/159/7512') || !st.groups[1].includes('159/159/159')) fail('group finishes');
  if (!st.stock.some(s => s.includes('7512/159/7512'))) fail('stock finish');

  // the job: stripes in the heading, angle column, add a 90° piece and a 45/90 piece and a 30° piece
  await p.click('[data-act=open-job]'); await p.waitForTimeout(200);
  console.log('stripes', await p.$$eval('[data-g] .sw3', x => x.length), 'headings', await p.$$eval('[data-g] h3', x => x.map(h => h.textContent)));
  const g1 = '[data-g=g1]';
  for (const [len, qty, ang] of [['1000', '2', '90'], ['800', '1', '45/90'], ['500', '2', '30']]) {
    await p.fill(`${g1} [id^=add-len]`, len); await p.fill(`${g1} [id^=add-qty]`, qty); await p.fill(`${g1} [id^=add-ang]`, ang);
    await p.click(`${g1} [data-act=add-cut]`); await p.waitForTimeout(150);
  }
  const cuts = await p.evaluate(() => D.jobs.get('j1').groups[0].cuts.map(c => `${c.len}x${c.qty}@${angTxt(c)}`));
  console.log('cuts', cuts);
  if (cuts.join() !== '1400x4@45,1000x2@90,800x1@45/90,500x2@30') fail('cuts ' + cuts);
  // duplicate the 45/90 row, then flip the copy's ends
  await p.click(`${g1} tr:nth-child(3) [data-act=dup-cut]`); await p.waitForTimeout(150);
  await p.click(`${g1} tr:nth-child(4) [data-act=flip-cut]`); await p.waitForTimeout(150);
  const dup = await p.evaluate(() => D.jobs.get('j1').groups[0].cuts.map(c => `${c.len}@${angTxt(c)}`));
  console.log('after dup', dup); if (dup.slice(2, 4).join() !== '800@45/90,800@90/45') fail('dup ' + dup);
  // pasted list with angles
  await p.evaluate(() => { document.querySelector('[data-g=g2] details').open = true; });
  await p.fill('#paste-g2', '700 2 Fix 90°\n650;1;Fix 45°/90°'); await p.click('[data-g=g2] [data-act=paste]'); await p.waitForTimeout(150);
  console.log('pasted', await p.evaluate(() => D.jobs.get('j1').groups[1].cuts.map(c => `${c.len}x${c.qty}@${angTxt(c)} ${c.label}`)));
  // building a new provedení in the picker: bílá/zlatý dub (dekor inside)
  await p.click('[data-g=g2] [data-act=open-pick][data-kind=finishes]'); await p.waitForTimeout(150);
  console.log('finish list', await p.$$eval('#pick-list .opt', x => x.map(o => o.textContent.trim())));
  await p.evaluate(() => { document.querySelector('.fin-new').open = true; });
  await p.selectOption('#fd-inside', 'cz'); await p.selectOption('#fd-core', 'cw'); await p.selectOption('#fd-outside', 'cw');
  await p.click('[data-act=fin-draft-use]'); await p.waitForTimeout(200);
  const g2 = await p.evaluate(() => colorLabel(D.jobs.get('j1').groups[1]));
  console.log('g2 now', g2); if (g2 !== 'Bílá/zlatý dub (bílá/dekor)') fail('draft finish ' + g2);
  await p.screenshot({ path: 'fin-job.png', fullPage: true });

  // optimize: angled pieces become their own items, odd angles get a badge
  await p.click('[data-act=optimize]'); await p.waitForTimeout(1500);
  console.log('tab label', await p.$eval('#tabs [data-tab=sheet]', x => x.textContent.trim()));
  const r = await p.evaluate(() => ui.result.groups.map(gr => ({ title: gr.title, sub: gr.sub, setup: gr.plan.setup.map(s => `${s.qty}x${s.len}@${s.a1}/${s.a2}`) })));
  console.log('result', JSON.stringify(r));
  console.log('badges', await p.$$eval('.seg .ang', x => x.map(e => e.textContent)), 'shapes', await p.$$eval('.cl .shape', x => x.length));
  await p.screenshot({ path: 'fin-sheet.png', fullPage: true });
  const blob = await p.evaluate(async () => { const bl = buildPdf(await pdfPages(ui.result)); return bl.size; });
  console.log('pdf bytes', blob);
  const png = await p.evaluate(async () => (await pdfPages(ui.result))[0]);
  fs.writeFileSync('fin-pdf.jpg', Buffer.from(Object.values(png.bytes)));
  // catalog tab
  await p.click('#tabs [data-tab=catalog]'); await p.click('[data-act=cat-tab][data-kind=finishes]'); await p.waitForTimeout(200);
  console.log('catalog finishes', await p.$$eval('.cat .opt', x => x.map(o => o.textContent.trim().replace(/\s+/g, ' '))));
  await p.screenshot({ path: 'fin-cat.png', fullPage: true });
  // the migration does not run twice
  await p.reload(); await p.waitForTimeout(800);
  console.log('after reload finishes', await p.evaluate(() => D.finishes.size), 'stock', await p.evaluate(() => D.stock.size));
  console.log('errors', errs); if (errs.length) fail('errors');
  await b.close();
})();
