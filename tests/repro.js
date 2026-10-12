const { chromium } = require('playwright');
async function slow(p, sel){ const el=await p.$(sel); console.log('slow', sel, !!el); if(!el) return; await el.evaluate(e=>e.scrollIntoView({block:'center'})); await p.waitForFunction(()=>document.getElementById('toast').hidden); const bb=await el.boundingBox(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.mouse.down(); await p.waitForTimeout(150); await p.mouse.up(); }
(async () => {
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs=[]; p.on('pageerror', e => errs.push(e.message));
  const html = require('fs').readFileSync(process.argv[2]||require('path').join(__dirname,'../dist/index.html'),'utf8'); const fake=require('fs').readFileSync(require('path').join(__dirname,'fakedb.js'),'utf8');
  await p.route('http://t/', r => r.fulfill({contentType:'text/html', body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>'+fake+'</script></head><body>'+html+'</body></html>'}));
  await p.goto('http://t/'); await p.waitForTimeout(500);
  await p.click('#tabs [data-tab=catalog]'); await p.click('[data-act=cat-new]'); await p.fill('#e-name','Synego R72'); await p.click('[data-act=cat-save]'); await p.waitForTimeout(200);
  await p.click('[data-act=cat-tab][data-kind=colors]'); await p.click('[data-act=cat-new]'); await p.fill('#e-name','Zlatý dub'); await p.click('[data-act=cat-save]'); await p.waitForTimeout(200);
  await p.click('#tabs [data-tab=jobs]'); await p.click('[data-act=new-job]'); await p.waitForTimeout(400);
  await p.click('[data-act=open-pick][data-kind=profiles]'); await p.waitForTimeout(700);
  p.on('console',m=>console.log('>',m.text())); console.log('--press'); await slow(p,'#pick-list .opt'); console.log('--released'); await p.waitForTimeout(700);
  p.on('console',m=>console.log('>',m.text())); console.log('--press'); await slow(p,'#pick-list .opt'); console.log('--released'); await p.waitForTimeout(700);
  await p.fill('[id^=add-len-]','1450'); await p.fill('[id^=add-qty-]','4'); await p.waitForTimeout(700);
  await slow(p,'[data-act=add-cut]'); await p.waitForTimeout(700);
  const r = await p.evaluate(()=>({btns:[...document.querySelectorAll('.pickbtn b')].map(b=>b.textContent), rows:document.querySelectorAll('tr[data-c]').length}));
  console.log(JSON.stringify(r), errs);
  await b.close();
})();
