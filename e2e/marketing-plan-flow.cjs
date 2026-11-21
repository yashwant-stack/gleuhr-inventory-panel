// Browser check: the marketing plan, product by product, with ad budgets, the stock check, the consent popup and the
// lock (npm run build:preview first).
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
  const role = async (name) => {
    await p.getByRole('button', { name: 'Viewing as', exact: true }).click();
    await p.getByRole('option', { name: new RegExp('^' + name) }).click();
  };

  await p.goto(FILE + '#plans', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  const roles = await (async () => { await p.getByRole('button', { name: 'Viewing as', exact: true }).click(); const o = await p.getByRole('option').allInnerTexts(); await p.keyboard.press('Escape'); return o; })();
  ok(roles.length === 5 && ['Management', 'Marketing', 'Sales head', 'Purchase', 'Supply chain head'].every((r) => roles.some((o) => o.startsWith(r))), `five roles: ${roles.map((r) => r.split('\n')[0]).join(' · ')}`);
  ok((await p.locator('main').innerText()).match(/Marketing plan[\s\S]*Sales plan/) && !(await p.locator('main').innerText()).includes('Clinic projection'), 'Plans lists the marketing and sales plans only (clinic plan merged into sales)');

  await role('Marketing');
  await p.getByRole('link', { name: /^(Fill|Edit) my plan$/ }).first().click();
  await p.waitForTimeout(400);
  ok((await p.locator('h1').innerText()).startsWith('Marketing plan'), 'Marketing opens the marketing plan');

  // Clinics, product by product: units and an ad budget per product
  await p.getByRole('button', { name: /^Clinics by product/ }).click();
  const panel = p.locator('#products-clinic');
  await panel.waitFor();
  const heads = await panel.locator('th').allInnerTexts();
  ok(['Product', 'Stock now', 'System', 'Expected units', 'Change', 'Ad budget (₹)'].every((h) => heads.includes(h)), `product table: ${heads.join(' | ')}`);
  const channelRow = p.locator('tr', { has: p.getByRole('button', { name: /^Clinics hide products/ }) });
  const totalBefore = num(await channelRow.locator('td').nth(2).innerText());
  // Marketing changes a product's expected units only as a % of System, from a dropdown (20 Nov 2026)
  ok((await panel.locator('input[aria-label^="Expected units for"]').count()) === 0, 'no typed expected units: a % dropdown per row');
  const first = panel.getByLabel(/^Expected units for .* \(Clinics\)/).first();
  const firstBefore = num(await first.innerText());
  await panel.getByRole('button', { name: /^Change for .* \(Clinics\)/ }).first().click();
  await p.getByRole('option', { name: '+50%', exact: true }).click();
  await p.waitForTimeout(150);
  const firstAfter = num(await first.innerText());
  const firstRow = panel.locator('tbody tr').first();
  const system = num(await firstRow.locator('td').nth(3).innerText());
  ok(firstAfter === Math.round(system * 1.5) && (await firstRow.innerText()).includes('+50%'), `+50% of System (${system}): expected units ${firstBefore} → ${firstAfter}`);
  ok(num(await channelRow.locator('td').nth(2).innerText()) === totalBefore + (firstAfter - firstBefore), 'channel total follows its products');

  // an ad budget on a product that will run out: the row warns, the channel shows "at risk"
  const uv = panel.getByLabel('Ad budget for UV Armour Sunscreen (Clinics)');
  await uv.fill('20000');
  await p.waitForTimeout(200);
  const uvRow = await panel.locator('tr', { hasText: 'UV Armour Sunscreen' }).innerText();
  ok(/Stock at risk: runs out .* new stock .* ad budget ₹20,000/.test(uvRow.replace(/\n/g, ' ')), `row warning: ${uvRow.split('\n').find((l) => l.includes('Stock at risk'))}`);
  ok(/\d+ at risk/.test(await channelRow.innerText()), 'the Clinics channel shows how many of its products are at risk');
  ok((await channelRow.locator('td').last().innerText()).replace(/[^0-9]/g, '').length > 0, 'channel budget = sum of product budgets');

  // C · Stock check: days left and when new stock arrives
  const check = p.locator('div', { has: p.getByText('C · Stock check for this plan') }).last();
  const checkText = await p.locator('main').innerText();
  ok(checkText.includes('C · Stock check for this plan') && checkText.includes('Days of stock left') && checkText.includes('New stock arrives'), 'section C shows days of stock left and when new stock arrives');
  ok(/UV Armour Sunscreen[\s\S]{0,200}At risk/.test(checkText), 'UV Armour is At risk in the stock check');
  await p.getByText('C · Stock check for this plan').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/marketing-stock-check.png' });

  // submit → popup: warnings, both boxes needed, then locked
  await p.getByRole('button', { name: /Submit plan|Submit as version/ }).click();
  const dlg = p.getByRole('dialog', { name: 'Check the stock before you submit' });
  await dlg.waitFor();
  const dlgText = await dlg.innerText();
  if (process.env.DEBUG) console.log(dlgText);
  ok(/Stock at risk: \d+ product/.test(dlgText) && /UV Armour Sunscreen\s*ad budget ₹2\d,\d{3}/.test(dlgText) && /new stock .*(on order|if ordered today)/.test(dlgText), 'popup lists the at-risk products with their budget (all channels) and new-stock date');
  ok(dlgText.includes('Would you still like to continue with the budget allotted'), 'popup asks whether to continue with the budget');
  const lockBtn = dlg.getByRole('button', { name: 'Submit and lock' });
  ok(await lockBtn.isDisabled(), 'Submit and lock is off until the boxes are ticked');
  await p.screenshot({ path: OUT + '/marketing-consent.png' });
  await dlg.getByLabel(/I have checked the stock warnings/).check();
  ok(await lockBtn.isDisabled(), 'still off with only the stock box ticked');
  await dlg.getByLabel('This plan was discussed with and approved by the MD.').check();
  ok(!(await lockBtn.isDisabled()), 'on once both boxes are ticked');
  await lockBtn.click();
  await p.waitForTimeout(500);
  ok(p.url().endsWith('#plans') && (await p.locator('tr', { hasText: 'Marketing plan' }).innerText()).includes('locked'), 'submitted and shown as locked on Plans');

  // locked: Marketing can only view
  await p.getByRole('link', { name: 'View (locked)' }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Clinics by product/ }).click();
  const again = p.locator('#products-clinic').getByLabel(/^Expected units for .* \(Clinics\)/).first();
  const lockedPick = p.locator('#products-clinic').getByRole('button', { name: /^Change for .* \(Clinics\)/ }).first();
  ok(num(await again.innerText()) === firstAfter && (await lockedPick.getAttribute('title')) === 'This plan is locked.', 'locked plan keeps the numbers and cannot be edited');
  ok((await p.locator('main').innerText()).includes('It can’t be edited. Management can reopen it'), 'locked note explains who can reopen');
  ok((await p.getByRole('button', { name: 'Reopen for changes' }).count()) === 0, 'Marketing has no reopen button');

  // Management reopens
  await role('Management');
  await p.getByRole('button', { name: 'Reopen for changes' }).click();
  await p.waitForTimeout(300);
  await role('Marketing');
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Clinics by product/ }).click();
  ok((await p.locator('#products-clinic').getByRole('button', { name: /^Change for .* \(Clinics\)/ }).first().getAttribute('title')) === null, 'after Management reopens it, Marketing can edit again');

  // Marketing also has the campaigns page (Marketing impact, 21 Nov 2026) and can add a campaign there
  const menu = p.getByRole('navigation', { name: 'Main' }).first();
  ok((await menu.innerText()).includes('Marketing impact'), 'Marketing: Marketing impact is in the menu');
  await menu.getByRole('link', { name: 'Marketing impact' }).click(); await p.waitForTimeout(400);
  ok(!(await p.getByRole('button', { name: 'New campaign' }).isDisabled()), 'Marketing: can add a campaign');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
