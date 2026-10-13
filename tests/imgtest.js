// Pulls the profile pictures out of a REF2MEN PDF and writes them as PNGs (for eyeballing).
// PDF: argv[2] (default: the sample in the project files). pdf.js: PDFJS_DIR (cdnjs is not reachable from the test box).
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const pdfPath = process.argv[2] || '/mnt/project-files/uploads/REF2MEN-Optimalizace-Velickova.pdf';
const pdfjs = process.env.PDFJS_DIR;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  if (pdfjs) await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(pdfjs, r.request().url().split('/').pop())) }));
  await p.route('http://t/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>' }));
  await p.goto('http://t/'); await p.waitForTimeout(500);
  const bytes = fs.readFileSync(pdfPath).toString('base64');
  const res = await p.evaluate(async b64 => {
    const file = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'x.pdf');
    const lines = await pdfLines(file), parsed = parseRef2men(lines);
    await pdfProfileImages(lines, parsed.blocks);
    return parsed.blocks.map(b => ({ article: b.article, img: b.img }));
  }, bytes);
  for (const r of res) {
    console.log(r.article, r.img ? Math.round(r.img.length * 0.75 / 1024) + ' KB' : 'no picture');
    if (r.img) fs.writeFileSync(`icon-${r.article}.png`, Buffer.from(r.img.split(',')[1], 'base64'));
  }
  console.log('errors', errs);
  await b.close();
})();
