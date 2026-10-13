// A plan over two jobs: the same profile + color is optimized together, and saving marks both jobs as cut.
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8').replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '');
  await p.route('http://t/api/**', r => r.fulfill({ status: 404, body: '' }));
  await p.route('http://t/', r => r.fulfill({ contentType: 'text/html', body: html }));
  await p.goto('http://t/'); await p.waitForTimeout(800);
  // second job: same frame profile in white, different lengths
  await p.evaluate(() => {
    const g = { id: uid(), profileId: 'ex-p-synego-ram', colorId: null, finish: 'bila', barLen: 6000, useStock: true, selected: true, cuts: [{ id: uid(), len: 1200, qty: 3, label: 'O9' }] };
    put('jobs', { id: 'job2', name: '2610001 Novák', created: today(), simplicity: 60, groups: [g] });
  });
  await p.click('#tabs [data-tab=sheet]'); await p.waitForTimeout(200);
  console.log('preselected', await p.evaluate(() => ui.planJobs.map(id => D.jobs.get(id).name)));
  await p.click('[data-act=plan-job][data-id=ex-job-1]').catch(async () => { const id = await p.evaluate(() => [...D.jobs.keys()].find(k => k !== 'job2')); await p.click(`[data-act=plan-job][data-id="${id}"]`); });
  await p.waitForTimeout(200);
  console.log('summary', await p.$eval('.go .sel', x => x.textContent));
  await p.screenshot({ path: 'plan1.png', fullPage: true });
  await p.click('[data-act=optimize-plan]'); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ name: ui.result.name, groups: ui.result.groups.map(g => `${g.title} | ${g.sub} | sources ${g.sources.length} | labels ${[...new Set(g.group.cuts.map(c => c.label))].slice(0, 4).join('; ')}`) }));
  console.log(JSON.stringify(r, null, 1));
  await p.screenshot({ path: 'plan2.png', fullPage: true });
  await p.click('[data-act=save-result]'); await p.waitForTimeout(400);
  console.log('cut groups', await p.evaluate(() => [...D.jobs.values()].map(j => j.name + ': ' + j.groups.filter(g => g.cutAt).length + '/' + j.groups.length)));
  await p.click('[data-act=plan-new]'); await p.waitForTimeout(200);
  console.log('after save, builder default', await p.evaluate(() => ui.planJobs.map(id => D.jobs.get(id).name)));
  console.log('errors', errs);
  await b.close();
})();
