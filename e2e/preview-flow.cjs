// Browser flow test for the one-file preview (npm run build:preview first). Opens the page from disk.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'preview-dist', 'gleuhr-inventory-panel-local.html');
const HASH = { '/': '', '/sales': 'sales', '/channels': 'channels', '/projections': 'projections', '/stock': 'stock', '/indent': 'indent', '/plans': 'plans', '/reports': 'reports', '/alerts': 'alerts', '/settings': 'panel-settings' };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const go = async (route) => { await p.goto(FILE + '#' + HASH[route], { waitUntil: 'load' }); await p.waitForTimeout(400); };
  const role = async (name) => {
    await p.getByRole('button', { name: /Viewing as/ }).click();
    await p.getByRole('option', { name: new RegExp('^' + name) }).click();
  };

  await go('/');
  ok((await p.title()) === 'Gleuhr Inventory Planning', 'title is "Gleuhr Inventory Planning"');
  const font = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok(font.includes('Hanken Grotesk'), 'body font is Hanken Grotesk');
  await p.getByRole('cell', { name: 'Hair Serum', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Hair Serum' });
  await drawer.waitFor();
  ok((await drawer.innerText()).includes('375'), 'drawer: Hair Serum order 375');
  await drawer.getByRole('button', { name: 'Close' }).click();

  // nav link click changes the page and the hash
  await p.getByRole('link', { name: 'Stock health' }).click();
  await p.waitForTimeout(300);
  ok(p.url().endsWith('#stock') && (await p.locator('h1').innerText()) === 'Stock health', 'nav: clicking Stock health opens #stock');
  await p.goBack();
  await p.waitForTimeout(300);
  ok((await p.locator('h1').innerText()) === 'Home', 'browser Back returns to Home');

  await role('Sales head');
  await go('/plans');
  await p.getByRole('link', { name: 'Fill my plan' }).click();
  await p.waitForTimeout(400);
  ok(p.url().endsWith('#plan-form') && (await p.locator('h1').innerText()).startsWith('Sales plan'), 'plan link opens #plan-form with the right plan');
  const first = p.getByLabel(/Expected units for Online team/);
  await first.fill(String(Math.round(Number(await first.inputValue()) * 1.3)));
  await p.getByRole('button', { name: 'Submit plan' }).click();
  await p.waitForTimeout(400);
  ok(p.url().endsWith('#plans') && (await p.locator('tr', { hasText: 'Sales plan' }).innerText()).includes('Submitted on time'), 'plan submitted, back on #plans');

  await go('/indent');
  ok((await p.locator('main').innerText()).includes("can’t open this page"), 'Sales head blocked from Auto indent');
  await role('Management');
  await go('/indent');
  await p.getByLabel('Select Hair Serum').check();
  await p.getByRole('button', { name: /Approve selected \(1\)/ }).click();
  ok((await p.locator('tr', { hasText: 'Hair Serum' }).innerText()).includes('Approved 375'), 'Management approved Hair Serum 375');
  const exp = p.getByRole('button', { name: /Export purchase list/ });
  ok((await exp.getAttribute('aria-disabled')) === 'true' && ((await exp.getAttribute('title')) || '').includes('preview'), 'Export is switched off in the preview, with a reason');

  await go('/reports');
  const pdf = p.getByRole('button', { name: /Download PDF/ });
  ok((await pdf.getAttribute('aria-disabled')) === 'true', 'Download PDF is switched off in the preview');

  await go('/settings');
  ok((await p.locator('h1').innerText()) === 'Settings' && p.url().endsWith('#panel-settings'), 'Settings opens at #panel-settings');

  for (const r of ['/sales', '/channels', '/projections', '/alerts']) {
    await go(r);
    const h = await p.locator('h1').innerText();
    ok(h.length > 0, 'renders ' + r + ' (' + h + ')');
  }
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await p.setViewportSize({ width: 390, height: 844 });
  await go('/');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over === 0, 'phone width: no sideways scroll (' + over + 'px)');
  await b.close();
})().catch(e => { console.log('SCRIPT ERROR', e.message); process.exit(1); });
