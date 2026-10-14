// REF2MEN text parsing without a browser: an article without a 5-digit number (reinforcement "1 1999")
// must become its own block, not add its pieces to the frame before it.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/ref2men.js'), 'utf8');
const { parseRef2men } = new Function(src + '; return { parseRef2men };')();
const lines = [
  'Seznam řezů     Zakázka: 2608000     Datum: 13.10.2026     Strana 1',
  'Firma s.r.o. / Firma s.r.o.',
  'Číslo artiklu     Var     Ozn.     Barva artiklu',
  '550900 1701 BLR 68     WEISS',
  '159 / 159 / 159 /',
  'Číslo tyče 1     BLENDRAHMEN 68 PULS BRID     6000     JŘ',
  'Č.pozice     Pole     Funkce     Poloha     Délka     Úh1     Úh2',
  '1     [01] 00 RÁM     Vlevo     1476     45,0°     45,0°',
  '2     [01] 00 RÁM     Vpravo     2236     45,0°     45,0°',
  'Zbytek: 1003',
  'Číslo artiklu     Var     Ozn.     Barva artiklu',
  '1 1999',
  '/ / /',
  'Číslo tyče 1     Dummy Funktion Armování     9900     JŘ',
  'Č.pozice     Pole     Funkce     Poloha     Délka     Úh1     Úh2',
  '3     [00] 00 ARMOVÁNÍ     Vlevo     1525     90,0°     90,0°',
];
const r = parseRef2men(lines);
const got = r.blocks.map(b => `${b.article} ${b.ozn} [${b.cuts.map(c => c.len + ' ' + c.angles).join(', ')}]`);
console.log(got);
const want = ['550900 BLR 68 [1476 45°/45°, 2236 45°/45°]', '1 Dummy Funktion Armování [1525 90°/90°]'];
if (JSON.stringify(got) !== JSON.stringify(want)) { console.log('FAIL, expected', want); process.exit(1); }
console.log('ok');
