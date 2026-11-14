const { chromium } = require('playwright');
// Browser flow test. Needs Playwright with Chromium, and the dev server running (npm run dev).
const B = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SHOTS_DIR || require('os').tmpdir();
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  const role = async (name) => {
    await p.getByRole('button', { name: /Viewing as/ }).click();
    await p.getByRole('option', { name: new RegExp('^' + name) }).click();
  };

  // 1. Product drawer shows the worked example
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.getByRole('cell', { name: 'Hair Serum', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Hair Serum' });
  await drawer.waitFor();
  const dtext = await drawer.innerText();
  ok(dtext.includes('8.8 / day') && dtext.includes('308'), 'drawer: Hair Serum rate 8.8/day and order 308');
  await p.screenshot({ path: OUT + '/drawer.png' });
  await drawer.getByRole('button', { name: 'Close' }).click();

  // 2. Sales Head fills the weekly plan
  await role('Sales Head');
  await p.goto(B + '/plans', { waitUntil: 'networkidle' });
  await p.getByRole('link', { name: 'Fill my plan' }).click();
  await p.waitForURL(/plans\/form/);
  const first = p.getByLabel(/Expected units for Clinics/);
  const sys = Number((await first.inputValue()));
  await first.fill(String(Math.round(sys * 1.3)));
  const flagged = await p.locator('td', { hasText: '⚑' }).count();
  ok(flagged >= 1, 'plan form: +30% change is flagged');
  await p.getByLabel(/Activity for Clinics/).fill('Winter package push at all clinics');
  await p.screenshot({ path: OUT + '/planform.png', fullPage: true });
  await p.getByRole('button', { name: 'Submit plan' }).click();
  await p.waitForURL(/\/plans$/);
  const row = p.locator('tr', { hasText: 'Sales plan' });
  ok((await row.innerText()).includes('Submitted on time'), 'plans: Sales plan now shows Submitted on time');
  await p.screenshot({ path: OUT + '/plans.png', fullPage: true });

  // 3. Planner cannot open Auto indent
  await p.goto(B + '/indent', { waitUntil: 'networkidle' });
  ok((await p.locator('main').innerText()).includes("can’t open this page"), 'access: Sales Head is blocked from Auto indent');

  // 4. CBO approves an indent line
  await role('CBO');
  await p.goto(B + '/indent', { waitUntil: 'networkidle' });
  await p.getByLabel('Select Hair Serum').check();
  await p.getByRole('button', { name: /Approve selected \(1\)/ }).click();
  ok((await p.locator('tr', { hasText: 'Hair Serum' }).innerText()).includes('Approved 308'), 'indent: CBO approved Hair Serum 308');

  // 5. Lead-time matrix tab
  await p.getByRole('tab', { name: /7–90 days/ }).click();
  const hs = await p.locator('tr', { hasText: 'Hair Serum' }).first().innerText();
  ok(/238[\s\S]*308[\s\S]*440[\s\S]*704[\s\S]*968/.test(hs) && hs.includes('13d empty'), 'indent matrix: 238/308/440/704/968 with 13 days empty at 30d');

  // 6. Consolidated report picks up the new sales plan
  await p.goto(B + '/reports', { waitUntil: 'networkidle' });
  const rep = await p.locator('main').innerText();
  ok(rep.includes('Consolidated projection report') && rep.includes('Week of 16 Nov'), 'reports: consolidated report for the open week');
  await p.screenshot({ path: OUT + '/reports.png', fullPage: true });

  // 7. Settings change flows through: overstock limit 90 -> 120
  await p.goto(B + '/settings', { waitUntil: 'networkidle' });
  const overInput = p.locator('label', { hasText: 'Overstock limit' }).locator('input');
  await overInput.click();
  await p.keyboard.press('Control+A');
  await p.keyboard.type('120', { delay: 60 });
  ok((await overInput.inputValue()) === '120', 'settings: typing 1-2-0 key by key keeps 120 (no clamping mid-typing)');
  await p.getByRole('button', { name: 'Save changes' }).click();
  await p.goto(B + '/stock', { waitUntil: 'networkidle' });
  ok((await p.locator('main').innerText()).includes('120-day overstock limit'), 'settings: overstock limit 120 used on Stock health');
  await p.goto(B + '/settings', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Reset to defaults' }).click();

  // 7b. A viewer sees Settings read only
  await role('MD');
  await p.goto(B + '/settings', { waitUntil: 'networkidle' });
  ok((await p.locator('main').innerText()).includes('Read only') && (await p.getByRole('group', { name: 'Trend factor' }).getByRole('radio', { name: 'On', exact: true }).isDisabled()), 'settings: MD sees read only, option buttons locked');
  await role('CBO');

  // 8. Remaining pages render without errors
  for (const path of ['/sales', '/projections', '/alerts', '/settings', '/channels', '/stock?status=overstock']) {
    await p.goto(B + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.screenshot({ path: OUT + '/' + path.replace(/[/?=]/g, '_') + '.png', fullPage: true });
  }
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await b.close();
})().catch(e => { console.log('SCRIPT ERROR', e.message); process.exit(1); });
