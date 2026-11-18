// Browser check: Auto indent takes any number of days for lead time and cover (npm run build:preview first).
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'preview-dist', 'gleuhr-inventory-panel-local.html');
const OUT = process.env.SHOTS_DIR || require('os').tmpdir();

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const serumRow = () => p.locator('tr', { hasText: 'Hair Serum' }).first().innerText();

  await p.goto(FILE + '#indent', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  ok((await serumRow()).includes('375'), 'default (own lead 15, cover 60): Hair Serum 375');

  // custom cover: 45 days → 7 × (15 + 45) − 150 = 270
  await p.getByRole('radiogroup', { name: 'Cover' }).getByRole('radio', { name: 'Custom' }).click();
  const coverBox = p.getByLabel('Cover: custom number of days');
  await coverBox.fill('45');
  await p.waitForTimeout(200);
  ok((await serumRow()).includes('270'), 'custom cover 45 days: Hair Serum 270');
  ok((await p.locator('body').innerText()).includes('cover 45 days after arrival'), 'the Units tile says cover 45 days');

  // custom lead: 20 days → 7 × (20 + 45) − 150 = 305
  await p.getByRole('radiogroup', { name: 'Lead time' }).getByRole('radio', { name: 'Custom' }).click();
  const leadBox = p.getByLabel('Lead time: custom number of days');
  await leadBox.fill('20');
  await p.waitForTimeout(200);
  ok((await serumRow()).includes('305'), 'custom lead 20 days + cover 45: Hair Serum 305');
  ok((await p.locator('body').innerText()).includes('arriving in 20 days'), 'the what-if note names 20 days');

  // a bad number is flagged and the last good one stays in use
  await leadBox.fill('0');
  await p.waitForTimeout(200);
  ok((await p.locator('body').innerText()).includes('1 to 365') && (await serumRow()).includes('305'), 'lead 0: flagged "1 to 365", still uses 20');
  await leadBox.fill('20');
  await p.screenshot({ path: OUT + '/indent-custom.png' });

  // the what-if tables gain the custom column
  await p.getByRole('tab', { name: 'If stock takes 7–90 days' }).click();
  await p.waitForTimeout(200);
  const leadHeads = await p.locator('thead th').allInnerTexts();
  ok(leadHeads.includes('20 days'), `lead table has a 20-day column: ${leadHeads.filter((h) => /days/.test(h)).join(' · ')}`);
  await p.getByRole('tab', { name: 'Stock indent 7–90 days' }).click();
  await p.waitForTimeout(200);
  const coverHeads = await p.locator('thead th').allInnerTexts();
  ok(coverHeads.includes('45 days'), `cover table has a 45-day column: ${coverHeads.filter((h) => /days/.test(h)).join(' · ')}`);

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
