// Browser check: the Purchase-only additions of 20 Nov 2026 (npm run build:preview first). Purchase's Home shows the
// Total inventory value and the segment split instead of "Sales over time"; Marketing impact is in Purchase's menu
// only, and an applied campaign raises Order now on Auto indent.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'preview-dist', 'gleuhr-inventory-panel-local.html');
const OUT = process.env.SHOTS_DIR || require('os').tmpdir();

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const role = async (name) => {
    await p.getByRole('button', { name: 'Viewing as', exact: true }).click();
    await p.getByRole('option', { name: new RegExp('^' + name) }).click();
    await p.waitForTimeout(300);
  };
  const nav = () => p.getByRole('navigation', { name: 'Main' }).first().innerText();
  const serumOrder = async () => {
    await p.goto(FILE + '#indent'); await p.waitForTimeout(500);
    const t = await p.locator('tr', { hasText: 'Hair Serum' }).first().innerText();
    return t;
  };

  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  ok((await p.locator('main').innerText()).includes('Sales over time') && !(await p.locator('main').innerText()).includes('Total inventory value'), 'Management: Home keeps Sales over time, no inventory value card');
  ok(!(await nav()).includes('Marketing impact'), 'Management: no Marketing impact in the menu');

  await role('Purchase');
  const home = await p.locator('main').innerText();
  ok(home.includes('Total inventory value') && !home.includes('Sales over time'), 'Purchase: Home shows Total inventory value, Sales over time is gone');
  ok(/Mohali warehouse[\s\S]*Clinics \(\d+\)[\s\S]*Unused bottles/.test(home), 'value split: Mohali warehouse, clinics, unused bottles');
  ok(/Day Regime[\s\S]*Night Regime[\s\S]*Wellness \(edibles\)/.test(home), 'segment split: Day / Night / Wellness');
  ok(/order at 150 days left, back to 180 days/.test(home) && /order at 120 days left, back to 150 days/.test(home), 'each regimen shows its reorder rule');
  ok(/Mostly an estimate: none of the \d+ products has a real purchase price in Zoho, so they are valued/.test(home), 'says the cost is an estimate where Zoho has no purchase price');
  ok((await nav()).includes('Marketing impact'), 'Purchase: Marketing impact is in the menu');
  await p.locator('main').getByText('Total inventory value').first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/purchase-home.png' });

  // a segment opens Stock health filtered to it
  await p.getByRole('link', { name: /Night Regime/ }).first().click();
  await p.waitForTimeout(500);
  ok((await p.locator('h1').innerText()).startsWith('Stock health') && (await p.getByRole('button', { name: /Segment/ }).first().innerText()).includes('Night'), 'segment link opens Stock health filtered to Night Regime');
  const table = await p.locator('main table').first().innerText();
  ok(table.includes('Hair Serum') && !table.includes('UV Armour Sunscreen'), 'the stock table keeps Night Regime products and drops a Day Regime one');

  // bug (20 Nov 2026): after clicking a segment, going elsewhere and coming back, Home lost the other segments
  // through the menu, as a person does (a page reload would hide the bug: it starts the filters afresh)
  const menu = p.getByRole('navigation', { name: 'Main' }).first();
  await menu.getByRole('link', { name: 'Auto indent' }).click(); await p.waitForTimeout(400);
  await menu.getByRole('link', { name: 'Home' }).click(); await p.waitForTimeout(500);
  const back = await p.locator('main').innerText();
  ok(/Day Regime[\s\S]*Night Regime[\s\S]*Wellness \(edibles\)/.test(back), 'back on Home: all three segments are still in the split');
  ok((await p.getByRole('button', { name: /Segment/ }).first().innerText()).includes('All'), 'back on Home: the segment link left no filter behind');

  // a Segment filter picked by hand narrows the products, never the inventory split
  await p.getByRole('button', { name: /^Segment/ }).first().click();
  await p.getByRole('option', { name: 'Day Regime' }).click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const picked = await p.locator('main').innerText();
  ok(/Day Regime[\s\S]*Night Regime[\s\S]*Wellness \(edibles\)/.test(picked) && picked.includes('shows every segment'), 'Segment filter on Home: the card still shows every segment and says so');
  await p.getByRole('button', { name: /Clear filters/ }).click();
  await p.waitForTimeout(200);

  const before = await serumOrder();
  ok(before.includes('1,215'), 'Auto indent before: Hair Serum 1,215');

  // a campaign on Hair Serum, applied to planning
  await p.goto(FILE + '#marketing-impact'); await p.waitForTimeout(500);
  ok((await p.locator('h1').innerText()).startsWith('Marketing impact'), 'Marketing impact opens for Purchase');
  await p.getByRole('button', { name: 'New campaign' }).click();
  await p.getByLabel('Campaign name').fill('Hair week');
  await p.getByLabel('Ad budget').fill('50000');
  await p.getByRole('button', { name: /^Products/ }).click();
  await p.getByRole('option', { name: 'Hair Serum', exact: true }).click();
  await p.keyboard.press('Escape');
  await p.getByLabel('Expected uplift').fill('50');
  await p.waitForTimeout(300);
  const form = await p.getByRole('region', { name: 'Campaign form' }).innerText();
  ok(/Conservative \(\+10%\)[\s\S]*Expected \(\+50%\)[\s\S]*Aggressive \(\+30%\)/.test(form), 'the scenario table shows all three uplifts');
  await p.getByText('Product by product').click();
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/marketing-impact-form.png' });
  const addedRow = (await p.getByRole('region', { name: 'Campaign form' }).locator('tr', { hasText: 'Hair Serum' }).innerText()).replace(/\s+/g, ' ');
  const [, without, withIt] = addedRow.match(/([\d,]+) → ([\d,]+)/) ?? [];
  ok(without === '1,215' && Number(withIt.replace(/,/g, '')) > 1215, `preview: Order now ${without} → ${withIt}`);
  await p.getByRole('button', { name: 'Save and apply to planning' }).click();
  await p.waitForTimeout(400);
  ok((await p.locator('tr', { hasText: 'Hair week' }).innerText()).includes('Applied'), 'the campaign is saved as Applied');
  await p.screenshot({ path: OUT + '/marketing-impact.png' });

  const after = await serumOrder();
  ok(after.includes(withIt), `Auto indent after: Hair Serum ${withIt}, as the preview said`);

  // the same order number for Management, who approves it
  await role('Management');
  ok((await p.locator('tr', { hasText: 'Hair Serum' }).first().innerText()).includes(withIt), 'Management sees the same raised order');
  await p.goto(FILE + '#marketing-impact'); await p.waitForTimeout(400);
  ok(!(await p.locator('h1').innerText().catch(() => '')).startsWith('Marketing impact'), 'Management cannot open Marketing impact');

  // the reorder alert on the Alerts page: Hair Serum's order includes the applied campaign; nothing is sent from sample data
  await p.goto(FILE + '#alerts'); await p.waitForTimeout(500);
  const alerts = await p.locator('main').innerText();
  ok(alerts.includes('Reorder alert · email and WhatsApp') && alerts.includes('sample data, nothing is sent'), 'Alerts: the reorder alert card, honest about sample data');
  const serumLine = alerts.split('\n').find((l) => l.startsWith('Hair Serum')) ?? '';
  ok(serumLine.includes('Night Regime: order at 150 days left') && serumLine.includes(withIt), `Alerts: Hair Serum with its Night Regime rule and the order with the campaign (${withIt})`);

  // Bottles: Zoho's "Bottle Count" items at Mohali, linked to their product by name, or honestly not linked
  await p.goto(FILE + '#bottles'); await p.waitForTimeout(500);
  const bt = await p.locator('main').innerText();
  ok(bt.includes('Bottle pieces at Mohali') && bt.includes('kept only at the Mohali warehouse'), 'Bottles: the page, Mohali only');
  const line = (name) => bt.split('\n').find((l) => l.startsWith(name)) ?? '';
  ok(/Night Cream[\s\S]{0,80}Multipurpose Night Cream/.test(bt), 'Bottles: Night Cream bottles are for Multipurpose Night Cream');
  ok(bt.includes('Not linked: “vitaminc” fits'), 'Bottles: “Vitamin C” fits two products and is not guessed');
  ok(bt.includes('pace from Zoho’s daily counts'), 'Bottles: White inner lid is paced from 20 days of Zoho counts');
  await p.screenshot({ path: OUT + '/bottles.png' });

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
