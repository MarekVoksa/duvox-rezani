// "Seznam přířezů celk." import: detected on the same button, only frames/sashes kept, armování catalog filled,
// profile paired with an armature, and the job's armování list (screen + PDF).
// PDF: argv[2] (default: the sample in the project files, not in the repo). pdf.js: PDFJS_DIR.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const pdfPath = process.argv[2] || '/mnt/project-files/uploads/hearth/f7b3ee7b-6023-4c5d-a479-5947fc9ec4b3';
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
  const tmp = path.join(require('os').tmpdir(), 'prirezy.pdf'); fs.copyFileSync(pdfPath, tmp);
  await p.setInputFiles('#imp-file', tmp); await p.waitForFunction(() => imp, null, { timeout: 20000 }); await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ kind: imp.kind, order: imp.order, customer: imp.customer, blocks: imp.blocks.map(b => `${b.article} ${b.ozn} ${b.colorText} ${b.cuts.length}`), arms: [...D.armatures.values()].map(a => a.code + ' ' + a.name) }));
  console.log(JSON.stringify(st, null, 1));
  if (st.kind !== 'prirezy' || st.blocks.length !== 5) fail('blocks');
  // a golden oak provedení for the import (the document has no color codes)
  await p.evaluate(() => {
    put('colors', { id: 'cw', name: 'Bílá', ref: '159', hex: '#fff' }); put('colors', { id: 'cg', name: 'Golden oak', ref: '2178001', hex: '#b07a3a' });
    const f = ensureFinish('cg', 'cw', 'cg'); imp.blocks.forEach(b => { b.on = true; b.finishId = f.id; });
    render();
  });
  for (let i = 0; i < 5; i++) { const btn = await p.$(`[data-act=imp-new-profile][data-i="${i}"]`); if (btn) { await btn.click(); await p.waitForTimeout(100); } }
  // pair FLG 60 with 244516 (the doc uses 244526 for the bigger sashes)
  const flg = await p.evaluate(() => imp.blocks.findIndex(b => /FLG 60/.test(b.ozn)));
  await p.selectOption(`[data-imp-arm="${flg}"]`, 'arm-244516');
  await p.screenshot({ path: 'pr-imp.png', fullPage: true });
  await p.click('[data-act=imp-go]'); await p.waitForTimeout(400);
  const job = await p.evaluate(() => ({ name: curJob().name, groups: curJob().groups.map(g => `${pName(P(g.profileId))}: ${g.cuts.length} lengths, ${g.cuts.reduce((a, c) => a + c.qty, 0)} pcs, angles ${[...new Set(g.cuts.map(angTxt))].join(' ')}`), flgArm: (P(curJob().groups.find(g => /FLG 60/.test(pName(P(g.profileId)))).profileId) || {}).armatureId }));
  console.log(JSON.stringify(job, null, 1));
  if (job.flgArm !== 'arm-244516') fail('pairing');
  await p.click('[data-act=arm-open]'); await p.waitForTimeout(200);
  const list = await p.evaluate(() => armList(curJob()).map(x => `${x.title} (${x.code}) ${x.pieces.length} ks: ` + x.rows.slice(0, 3).map(r => `${r.n}x ${r.len} [${labelSummary(r.labels)}]`).join('; ')));
  console.log(list);
  const total = await p.evaluate(() => armList(curJob()).reduce((a, x) => a + x.pieces.length, 0));
  // 40 frame + 52 sash (all now 244516) + 9 door frame + 12 + 3 door sash (lock side has two) = 116
  console.log('armature pieces', total); if (total !== 116) fail('armature count ' + total);
  await p.screenshot({ path: 'pr-arm.png', fullPage: true });
  const pg = await p.evaluate(async () => { const j = curJob(); const r = { name: j.name, date: today() }; return (await pdfPages(r, armPdfBlocks(armList(j)))).map(x => Object.values(x.bytes)); });
  pg.forEach((x, i) => fs.writeFileSync(`pr-arm-${i}.jpg`, Buffer.from(x)));
  console.log('pdf pages', pg.length);
  console.log('text', (await p.evaluate(() => armText(curJob()))).split('\n').slice(0, 6));
  await p.click('#tabs [data-tab=catalog]'); await p.click('[data-act=cat-tab][data-kind=armatures]'); await p.waitForTimeout(150);
  console.log('catalog', await p.$$eval('.cat .opt', x => x.map(o => o.textContent.trim().replace(/\s+/g, ' '))));
  console.log('errors', errs); if (errs.length) fail('errors');
  await b.close();
})();
