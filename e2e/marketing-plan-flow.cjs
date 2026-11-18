// Browser check: the Marketing Head plans each channel product by product (npm run build:preview first).
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
  const num = (s) => Number(String(s).replace(/[^0-9]/g, ''));

  await p.goto(FILE + '#plans', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Viewing as/ }).click();
  await p.getByRole('option', { name: /^Marketing Head/ }).click();
  await p.getByRole('link', { name: /^(Fill|Edit) my plan$/ }).first().click();
  await p.waitForTimeout(400);
  ok((await p.locator('h1').innerText()).startsWith('Marketing plan'), 'Marketing Head opens their marketing plan');

  for (const ch of ['Clinics', 'Online team', 'Website (Shopify)']) {
    ok(await p.getByRole('button', { name: new RegExp('^' + ch.replace(/[()]/g, '\\$&') + ' by product') }).isVisible(), `${ch}: opens product by product`);
  }

  // Clinics: open, every product row has stock, system and an editable expected box
  await p.getByRole('button', { name: /^Clinics by product/ }).click();
  const panel = p.locator('#products-clinic');
  await panel.waitFor();
  const heads = await panel.locator('th').allInnerTexts();
  ok(['Product', 'Stock now', 'Last 30 days (units)', 'System', 'Expected units', 'Change'].every((h) => heads.includes(h)), `Clinics product table columns: ${heads.join(' | ')}`);
  const inputs = panel.getByLabel(/Expected units for .* \(Clinics\)/);
  const n = await inputs.count();
  ok(n > 10, `Clinics lists ${n} products with editable expected units`);

  const channelRow = p.locator('tr', { has: p.getByRole('button', { name: /^Clinics hide products/ }) });
  const totalBefore = num(await channelRow.locator('td').nth(2).innerText());
  const first = inputs.first();
  const firstBefore = Number(await first.inputValue());
  await first.fill(String(firstBefore + 100));
  await p.waitForTimeout(200);
  const totalAfter = num(await channelRow.locator('td').nth(2).innerText());
  ok(totalAfter === totalBefore + 100, `Clinics total follows its products: ${totalBefore} → ${totalAfter}`);
  await p.screenshot({ path: OUT + '/marketing-clinic-products.png', fullPage: false });

  // Online team and website open the same way
  await p.getByRole('button', { name: /^Online team by product/ }).click();
  ok((await p.locator('#products-online_team').getByLabel(/Expected units for .* \(Online team\)/).count()) > 0, 'Online team: product rows editable');
  await p.getByRole('button', { name: /^Website \(Shopify\) by product/ }).click();
  ok((await p.locator('#products-website').getByLabel(/Expected units for .* \(Website \(Shopify\)\)/).count()) > 0, 'Website (Shopify): product rows editable');

  // a blank product box blocks submit
  const web = p.locator('#products-website').getByLabel(/Expected units for/).first();
  const webVal = await web.inputValue();
  await web.fill('');
  ok(await p.getByRole('button', { name: /Submit plan|Submit as version/ }).isDisabled(), 'an empty product box blocks submitting');
  await web.fill(webVal);

  // submit, reopen: the product numbers are kept
  await p.getByRole('button', { name: /Submit plan|Submit as version/ }).click();
  await p.waitForTimeout(500);
  ok(p.url().endsWith('#plans'), 'submitted, back on Plans');
  await p.getByRole('link', { name: 'Edit my plan' }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Clinics by product/ }).click();
  const again = await p.locator('#products-clinic').getByLabel(/Expected units for .* \(Clinics\)/).first().inputValue();
  ok(Number(again) === firstBefore + 100, `reopened: the edited product kept ${again}`);

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
