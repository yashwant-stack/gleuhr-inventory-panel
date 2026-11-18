const { chromium } = require('playwright');
// Live-mode browser check: a build made with NEXT_PUBLIC_DATA_SOURCE=live, served by `next start`
// against a synced panel database (see docs/BACKEND_PLAN.md, "Check the live path locally").
// It needs PANEL_KEY = the server's PANEL_ACCESS_KEY.
const B = process.env.BASE_URL || 'http://127.0.0.1:3100';
const KEY = process.env.PANEL_KEY || '';
const OUT = process.env.SHOTS_DIR || require('os').tmpdir();
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  let failed = 0;
  const ok = (cond, msg) => { if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

  // 1. A new visitor meets the access key form, never the data.
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  ok(await p.getByLabel(/Enter the panel’s access key/).isVisible(), 'locked: the access key form shows');
  ok(!(await p.getByText('Hair Serum').count()), 'locked: no product data on the page');
  ok(await p.getByRole('button', { name: 'Open the panel' }).isDisabled(), 'locked: the button is disabled until a key is typed');

  // 2. A wrong key is refused in plain words.
  await p.getByLabel(/Enter the panel’s access key/).fill('not-the-key-at-all');
  await p.getByRole('button', { name: 'Open the panel' }).click();
  await p.getByText('That key is not right.').waitFor();
  ok(true, 'wrong key: "That key is not right."');

  // 3. The right key opens the panel on live data.
  await p.getByLabel(/Enter the panel’s access key/).fill(KEY);
  await p.getByRole('button', { name: 'Open the panel' }).click();
  await p.getByRole('cell', { name: 'Hair Serum', exact: true }).first().waitFor({ timeout: 15000 });
  const body = await p.locator('body').innerText();
  ok(/\bLive\b/.test(body), 'home: the data badge says Live');
  ok(!/\bSample\b/.test(body.split('\n').slice(0, 40).join('\n')), 'home: no Sample badge');
  await p.screenshot({ path: OUT + '/live-home.png' });

  // 4. Stock: Mumbai is unknown, never 0.
  await p.goto(B + '/stock', { waitUntil: 'networkidle' });
  await p.getByText('Stock totals leave out Mumbai').waitFor({ timeout: 15000 });
  ok(true, 'stock: the note says the totals leave out Mumbai');
  await p.screenshot({ path: OUT + '/live-stock.png', fullPage: true });

  // 5. Data health: the left-out CRM products, the refused stock changes, every sync job.
  await p.goto(B + '/health', { waitUntil: 'networkidle' });
  await p.getByText('6 · CRM products left out').waitFor({ timeout: 15000 });
  const h = await p.locator('body').innerText();
  ok(h.includes('Facial Kit') && h.includes('No Zoho item linked in the CRM'), 'health: Facial Kit left out (no Zoho item)');
  ok(h.includes('Skin Plan') && h.includes('Zoho does not track stock for its item'), 'health: Skin Plan left out (not tracked)');
  ok(h.includes('1 active Zoho item is sold by no CRM'), 'health: Zoho-only items counted, in good grammar');
  ok(h.includes('Zoho stock per location') && h.includes('CRM sales'), 'health: sync jobs in plain names');
  ok(h.includes('their sales come off Mohali - Warehouse'), 'health: the tile names the real primary location');
  ok(!h.includes('Pune') && !h.includes('already has a location'), 'health: no sample-only hint about Pune');
  ok(!h.includes('Has not run yet'), 'health: every job has run');
  ok(!h.includes('Sample mode'), 'health: no sample-mode note');
  await p.screenshot({ path: OUT + '/live-health.png', fullPage: true });

  // 6. The key lives in an httpOnly cookie: the page's scripts cannot read it.
  const cookie = await p.evaluate(() => document.cookie);
  ok(!cookie.includes('panel_access'), 'cookie: not readable by page scripts');

  // Exactly two refusals are expected (the locked first visit and the wrong key): the browser logs each 401.
  const refused = errors.filter((e) => e.includes('status of 401'));
  const other = errors.filter((e) => !e.includes('status of 401'));
  ok(refused.length === 2, `exactly the 2 expected refusals (got ${refused.length})`);
  ok(other.length === 0, 'no other console errors' + (other.length ? ': ' + other.slice(0, 3).join(' | ') : ''));
  await b.close();
  process.exit(failed ? 1 : 0);
})();
