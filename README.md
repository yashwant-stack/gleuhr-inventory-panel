# Gleuhr · Inventory Planning Panel

Sales, stock, projections, auto indent and the marketing & sales plan cycle, read from Zoho Inventory.

**Stage: frontend only.** Every screen works and is clickable, but the numbers are **sample data** in the same shape Zoho will send. Zoho, email and WhatsApp are **not connected yet**; that is the backend stage (see `docs/BACKEND_PLAN.md`). The top bar of the app says so on every page.

## Run it

```bash
npm install
npm run dev        # then open http://localhost:3000
```

Use **“Viewing as”** in the top bar to see the panel as each person: Management (admin: approves, changes settings), Marketing and Sales head (planners), Purchase and Supply chain head (view only). The marketing plan is planned product by product with ad budgets, checked against stock, confirmed with the MD's approval and then locked; the Sales head plans the clinics clinic by clinic, with the same stock check, consent and lock.

## The pages

| Page | What it answers |
|---|---|
| Home | Sales for any date range, sales by channel, products that need action, forecast, this week’s plan status |
| Home (Purchase) | Total inventory value at cost (Mohali + clinics + unused bottles) split into Day Regime / Night Regime / Wellness, in place of Sales over time |
| Marketing impact (Purchase only) | Campaigns and festival surges; applied ones add their extra units to Order now |
| Sales | Product-wise sales for any date range (custom filter), split by clinic / online team / Amazon / Flipkart / website; CSV export |
| Channels | Each channel’s sales, growth and next-30-day forecast; D2C total; clinic-wise sales |
| Projections | 7 / 15 / 30 / 60 / 90-day projections per product and channel |
| Stock health | Current stock (warehouse + every clinic), days of cover, Critical / Low / Healthy / Overstock / No sales, clinic transfer suggestions, overstock value |
| Auto indent | What to order now and how much, by Zoho's Type Regimen: Night Regime at 150 days left, back to 180 when it lands; Day Regime and Wellness at 120, back to 150 (rate × (lead + target) − stock − on the way); “what if stock takes 7–90 days”; stock indent for 15 / 30 / 60 / 90 days; approve (Management); export the purchase list |
| Plans | Monthly (23rd → 25th → 26th) and weekly (Thu → Sat → Mon) cycles; who has submitted; plan vs actual; the upload form for each person |
| Reports | Consolidated projection report for Management (system + trend + team plans, gap flags, stock readiness); the report chain from overall sales down to current stock; Download PDF (print) |
| Alerts | The daily reorder alert by email (Resend) and WhatsApp (360dialog): every product at its reorder point with how much to order; which channel is set up; the real sent log |
| Settings | Every threshold (sales window, safety days, overstock limit, cover, gap flag, transfer rules), vendor lead times, recipients, schedule |

Click any product anywhere to open its detail panel, which shows **how every number was worked out**, step by step.

## Where things live

```
src/lib/domain/formulas.ts   The decided rules & formulas (pure functions) + tests
src/lib/data/engine.ts       Turns data + settings + filters into what screens show
src/lib/data/plans.ts        Plan baselines, submissions, consolidation, stock readiness
src/lib/data/hooks.ts        useDataset() is the seam: sample data today, the API later
src/lib/mock/                Sample data in Zoho's shape (real catalogue and clinic names)
src/lib/state/store.ts       Filters, "Viewing as", settings, approvals, plan submissions
src/app/                     One folder per page
src/components/              Shared UI (custom dropdowns, date range, charts, product panel)
```

Screens never compute business numbers themselves; they call `engine.ts`, which calls `formulas.ts`. When the backend arrives, the same formulas run on the server and the screens stay as they are.

## Saved in this browser only (until the backend exists)

Settings, lead-time changes, indent approvals and submitted plans are kept in the browser’s local storage, and each screen that saves says so. Clearing site data resets them.

## Visibly switched off until the backend exists

Create POs in Zoho · Email report to Management now · Send a test alert · Attach a plan file. Each is shown greyed out with a plain-words reason on hover.

## Checks

```bash
npm run typecheck
npm run lint
npm run test        # formulas + sample-data stories (incl. the Hair Serum worked example: 8.8/day → order 308)
npm run build
```

Browser flow test (needs Playwright with Chromium and the dev server running):

```bash
node e2e/flow.cjs
```

## Secrets

Never commit credentials. `.env.example` lists the variable **names** only; values go in the hosting provider’s secret store when the backend is built.
