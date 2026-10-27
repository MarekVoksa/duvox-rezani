// REF2MEN text parsing without a browser: an article without a 5-digit number (reinforcement "1 1999")
// must become its own block, not add its pieces to the frame before it.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/ref2men.js'), 'utf8');
const { parseRef2men, parsePrirezy } = new Function(src + '; return { parseRef2men, parsePrirezy };')();
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

// positions with a letter (the same windows for house A and B), written "5 A" or "2A"
const svyp = parseRef2men([
  'Seznam řezů     Zakázka: 2608001     Datum: 27.10.2026     Strana 1',
  'Stavba / Firma s.r.o.',
  'Číslo artiklu     Var     Ozn.     Barva artiklu',
  '567295 1741 Dv.kří Z     Dekor / bílá',
  '7512 / 159 / 159 / 601',
  'Číslo tyče 1     Dveřní křídlo Z SYNEGO     6500     JŘ',
  'Č.pozice     Pole     Funkce     Poloha     Délka     Úh1     Úh2',
  '1A     [01] 01 DV.KŘÍDLO     Vlevo     2223     45,0°     45,0°',
  '5 A     [01] 01 DV.KŘÍDLO     Nahoře     975     45,0°     45,0°',
]);
const g2 = svyp.blocks.map(b => `${b.article} ${b.colorCode} [${b.cuts.map(c => c.len + ' ' + c.label).join(', ')}]`);
console.log(g2);
if (JSON.stringify(g2) !== JSON.stringify(['567295 7512/159/159/601 [2223 P1A Dv.křídlo vlevo, 975 P5A Dv.křídlo nahoře]'])) { console.log('FAIL řezy positions'); process.exit(1); }
const pr = parsePrirezy([
  'Seznam přířezů celk.     27.10.2026     Str. :     1',
  'Počet pozic.........:     19     Číslo objednávky....:     2608001',
  'FUNKCE..............: RÁM     GOLDEN OAK/WEISS',
  '6 A     567625     41BLR72 MD SYNMD (23/28/1,:2.158) l.|     2     2.281     135,0 135,0',
  '2A     567625     41BLR72 MD SYNMD (23/28/1,:     783) p.|     1     906     135,0 135,0',
  'FUNKCE..............: ARMOVÁNÍ     RÁM',
  '6 A     306619     111U-Armování     23/28/1,5 mm     l.|     2     2.158',
  '2A     306619     111U-Armování     23/28/1,5 mm     p.|     1     783',
]);
const g3 = pr.blocks.map(b => `${b.article} ${b.ozn} [${b.cuts.map(c => c.len + ' ' + c.label + ' ' + (c.armCodes || []).join()).join(', ')}]`);
console.log(g3, pr.armatures);
if (JSON.stringify(g3) !== JSON.stringify(['567625 BLR72 MD SYNMD [2281 P6A Rám vlevo 306619, 2281 P6A Rám vlevo 306619, 906 P2A Rám vpravo 306619]'])) { console.log('FAIL přířezy positions'); process.exit(1); }
console.log('ok');
