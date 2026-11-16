# Backend: what is built, and how to switch it on

Updated 15 Nov 2026 (backend stage 1). The frontend stage is unchanged; this stage adds the server side that feeds it real data.

**Status, 16 Nov 2026: running on live data.** Connected to the CRM database (read-only, through its REST API) and Zoho; 40 products, 16 Zoho locations, 12 clinics. Checked: the panel's sales for 1–15 Nov equal the CRM's own figures to the unit and the rupee on every channel (clinics 7,782 units ₹1,16,34,483; online team 6,567 ₹98,16,012; website 1,469 ₹22,94,952).

**In one line:** every 2 hours the panel copies **stock per location from Zoho** and **sales per channel from the CRM database** into its **own** database. The screens then read one data feed (`/api/dataset`), behind an access key. Nothing is ever written to Zoho or to the CRM database.

Until the switch-on steps in §2 are done, the panel runs on the built-in sample data, exactly as before.

---

## 1 · What is built

| Piece | File | What it does |
|---|---|---|
| The panel's tables | `supabase/migrations/20261115000001_panel_init.sql` | 17 tables in the panel's **own** Supabase project (not the CRM's). Row-level security is on everywhere, with no policies: only the server reads or writes. It is safe to run twice. |
| Zoho reader | `src/server/zoho.ts` | Read-only. It caches one access token for an hour in the database and keeps its own call ceilings (10 a minute, 600 a day; both are settings). A full minute makes it **wait** for the next one. It stops on the daily ceiling, on the run's time budget, or on a 429 from Zoho. |
| CRM reader | `src/server/crm.ts` | Read-only SQL on 9 CRM tables. It works out each stock movement's channel (clinic / online team / website) and kind (sale, return, free, exchange, loss) in **IST days**, and its value: what the customer paid for the products, GST included (§1 rules). Checked on production for the 30 days to 16 Nov: online matches the CRM's own product totals to ₹100 in ₹2.36 crore; all 4,128 live clinic bills match to the rupee; all 356 cancelled bills net to zero. |
| The sync | `src/server/sync.ts` | Six jobs, each logged in `sync_runs`. Details below. |
| The data feed | `src/server/dataset.ts`, `src/app/api/dataset` | Builds what the screens show from the panel's tables. It refuses (in plain words) until the first sync has reached every location. |
| Scheduled runs | `vercel.json`, `src/app/api/cron/sync` | Every 2 hours at :17 past (UTC), plus a daily run at 01:41 UTC (07:11 IST). Each needs `Authorization: Bearer <CRON_SECRET>`. |
| Access key | `src/server/access.ts`, `src/app/api/unlock`, `src/components/LoadScreen.tsx` | An interim gate until personal logins exist. The live panel asks for a key; the browser keeps a 30-day httpOnly cookie that holds a hash, never the key. With no key set on the server, live data is refused. |
| Live switch | `src/lib/data/hooks.ts` | `NEXT_PUBLIC_DATA_SOURCE=live` makes the screens read `/api/dataset` instead of the sample data. |
| CRM through REST | `src/server/crm-rest.ts`, `src/server/sources.ts` | With `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (no SQL login), the CRM is read with GET requests only, 1,000 rows at a time. A window's movements and the bills / orders / lines / offers behind them are copied into the panel database's `crm_stage` schema, the same sales query runs there, and the copies are emptied. Tested to give the same data as the SQL path. |
| Embedded panel database | `src/server/db.ts` | With no `PANEL_DATABASE_URL`, the panel keeps its own Postgres (PGlite) in `.data/panel` and applies the migration itself. For one long-running server only. |
| One sync at a time | `sync_lock` table | A second run is refused (409) while one is running; a crashed run's lock expires after 15 minutes. |

### The six sync jobs

| Job | Every | Reads | Zoho calls |
|---|---|---|---|
| `zoho_catalog` | 2 h | Zoho locations + item list (price, purchase price, vendor, tracked or not) | 2 (+1 per extra 200 items) |
| `crm_reference` | 2 h | CRM clinics (with their Zoho location) and CRM products (with their Zoho item) | 0 |
| `zoho_stock` | 2 h | Stock on hand per location: one call per location, oldest-read first. A refused location is retried once a day. Keeps one stock photo per day. | about 11 |
| `crm_flows` | 2 h | Daily sales/returns/free/exchange per product × clinic × channel. The first run fills 180 days; later runs re-read the last 3 days, so a voided sale disappears. | 0 |
| `crm_health` | 2 h | CRM stock changes Zoho refused in the last 30 days, per clinic | 0 |
| `zoho_access` | daily | Which Zoho areas the login may read; open purchase orders (up to 25) for "on the way" | about 30 |

About **190 Zoho calls a day** in total, against the panel's own ceiling of 600, inside the org's shared limit. A 2-hourly run takes about 1–2 minutes, because the 10-a-minute ceiling makes it wait.

### The rules the data follows (decided here; every one is tested)

- **A product = a Zoho item that a CRM sells.** A CRM product with no usable Zoho item can't be planned. Its sales are left out, and Data health §6 lists it by name with its last-90-day sales. Today that is 13 of 55 CRM products, 9 of which sold in the last 90 days; the top one is "Blemishes Pigmentation facial Treatment kit" with 360 units.
- **Stock is per Zoho location.** A location the Zoho login may not read shows **unknown, never 0**, and totals say what they leave out.
- **Where stock comes out:**
  - A clinic's sales come off its Zoho location; an unlinked clinic's come off the primary location (Mohali).
  - Online-team and website orders come off the location they ship from.
  - Received or written-off stock is not a sale and never makes a place a sales point.
- **History starts when the product was added to the CRM**, not at its first sale, so a slow seller isn't treated as "new" with an inflated rate.
- **Stock-out days** are left out of the rate only when that day's stock photo shows nothing at any readable location **and** nothing sold that day. Days before the photos began are never dropped.
- **A channel's data starts** at its first recorded sale of any product. Amazon and Flipkart show "not connected" with the reason.
- **Each sales point is measured from the day it joined the CRM.** Clinic product sales were recorded by Chandigarh from 28 Aug and by the other clinics from 1–15 Oct. A clinic's daily rate counts only its own days, never the weeks before it joined as zero sales.
- **No growth % that is really a clinic joining.** A change vs the previous period shows only when the sales points behind it were recording through that whole period (points under 5% of the sales are ignored); otherwise the panel says "earlier data incomplete".
- **Categories** come from Zoho, else from the online CRM (`online_product_meta`); Zoho's items carry none today.
- **Stock below zero** is shown as Zoho gives it and listed on Data health (16 places on 16 Nov, e.g. Multipurpose Day Cream at Mohali −75).
- **Sales value never comes from Zoho.** Zoho is read for stock only. Every sale's value comes from the CRM bill or order it belongs to, as the customer paid it, GST included:
  - **Clinic:** each bill line's price after its discount, scaled to the bill's real total. Whole-bill offers (buy-one-get-one, quantity tiers) and round-off sit on the bill, not on its lines. Example: 2 serums whose lines say ₹2,000, billed ₹1,500, count as ₹1,500.
  - **Online:** each line's price after its discount, less buy-one-get-one free units and round-off (the CRM's own product-total formula). The delivery charge (COD fee, shipping) is left out, because it isn't product sales.
- **A cancelled or edited clinic bill puts its stock back.** The CRM records that as an "adjustment" on the bill, and the panel takes it off sales; it is never stock received. On a free bill it takes a free sample back instead. In the 30 days to 16 Nov this was 2,384 of 18,656 clinic units (13%).
- **Price** (for forecasts in ₹) is the CRM's price. **Cost** is Zoho's purchase price, or 30% of the price when Zoho's is a ₹10 placeholder (the 30% is a setting).

### How it was verified (15 Nov 2026)

- **41 automated tests.** The 7 end-to-end tests run the real migration on an in-memory Postgres (PGlite), a fake CRM with production's table shapes, and a fake Zoho. They cover: full sync → data feed → wire format → the screens' maths; ceilings; pacing; 429; time budget; stalest-first; re-reads.
- With `PG_TEST_URL` set, the same end-to-end tests also run on a real PostgreSQL 16 through **postgres.js, the driver production uses**. That run found a real bug the in-memory database hid: JSON batches arrived double-encoded, so every sync write failed. It is now fixed (`$1::text::jsonb`, see `src/server/db.ts`). The test was checked to fail when the bug is put back.
- **Sales value against the CRMs' own totals** (production, read-only, the 30 days to 16 Nov). This check found the "adjustment" rule above: the first version counted cancelled and edited-down clinic sales as sold.
  - Online: the panel's product value was ₹2,35,88,336; the CRM's own product total (`app.online_order_lines_total`) was ₹2,35,88,236.
  - Clinic: all 4,128 live bills match their bill totals to the rupee, and all 356 cancelled bills net to zero units and ₹0.
- **The live path, end to end:**
  - A `next start` build in live mode ran against local Postgres + fake Zoho: the scheduled runs, the access key, the data feed.
  - `e2e/live-flow.cjs` (18 browser checks) passed: the locked screen, a wrong key, the live badge, Mumbai unknown on Stock, left-out products and sync status on Data health, the cookie hidden from scripts.

**Check the live path locally**, if you have PostgreSQL:
1. Create two databases.
2. Run the migration on one.
3. Load the fake CRM from `src/server/sync.test.ts` (`CRM_SCHEMA`) into the other.
4. Build with `NEXT_PUBLIC_DATA_SOURCE=live`.
5. `next start` with the variables of §2.
6. Call `/api/cron/sync?run=all` with the secret.
7. Run `PANEL_KEY=… node e2e/live-flow.cjs`.

---

## 2 · Switching it on (in order)

1. **The panel's own Supabase project.** Create it, or give me the connector to one, and I apply `supabase/migrations/20261115000001_panel_init.sql`. Its connection string (Transaction pooler, port 6543) becomes `PANEL_DATABASE_URL`.

2. **A read-only login on the CRM database**, made by the clinic CRM team through their own process (their repo owns that database's changes, and production changes need the founder's word):
   - It may only `SELECT` nine tables: `clinics`, `retail_products`, `stock_movements`, `online_shopify_orders`, `product_sales`, `product_sale_lines`, `online_orders`, `online_order_lines`, `online_offers`.
   - Those tables have row-level security, so the login must be able to read through it. The clinic team decides how (a policy for this login, or `BYPASSRLS`).
   - Its connection string becomes `CRM_DATABASE_URL`.
   - **Never the CRM's main login.**

3. **Zoho: give the panel its own read-only key.**
   - The key in use is the CRMs' own refresh token. Zoho's answer shows its scopes: items and settings (read), stock adjustments (read and create). So purchase orders, sales orders, invoices and transfer orders answer "not authorized" because of the key, not the user's role.
   - Sharing it also means Zoho can retire the panel's access token early when the CRMs make new ones (seen 16 Nov). The panel now replaces a refused token once per run, but its own key avoids the overlap.
   - Make one in the Zoho API console → Self Client, with read scopes for items, settings, purchase orders, sales orders, invoices and transfer orders, by a Zoho user who can see every location. Today Mumbai, Ahmedabad, Pune and both darkstores refuse the current user.
   - Retire the secret and refresh token shared in chat.

4. **Vercel project** (`.env.example` lists every name):
   - Set `PANEL_DATABASE_URL`, `CRM_DATABASE_URL`, the six `ZOHO_*` values, `CRON_SECRET` (16+ characters), `PANEL_ACCESS_KEY` (12+ characters) and `NEXT_PUBLIC_DATA_SOURCE=live`.
   - Deploy. The two scheduled runs come from `vercel.json`.
   - Check the plan allows a scheduled job every 2 hours, and functions of up to 300 seconds. If functions get less time, set `SYNC_TIME_BUDGET_SECONDS` lower: what a run doesn't reach, the next run reads first.

5. **First sync by hand.** It fills 180 days of sales and every location's stock. Run it with your own secret in place of `<CRON_SECRET>`, then open the panel and type the access key:

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" "https://<panel-url>/api/cron/sync?run=all"
   ```

   Data health then shows what reached the panel and what didn't.

---

## 3 · Not built yet (next stage)

- **Personal logins with roles** (CBO admin; MD and Herman view; MH, SH, the online team and Manisha plan). Until then, everyone with the key sees the same panel, and the "Viewing as" switch is a preview of each role, not security.
- **Saving for everyone.** Approvals, plan submissions, settings and lead times still save **in each person's browser only**, and the screens say so. Their tables already exist (`indent_approvals`, `plan_submissions`, `settings`), waiting for logins so each save records who made it.
- **Email and WhatsApp sending** (alerts to the CBO, the 23rd/25th and Thursday plan requests, the consolidated report) and **personal plan links**. Every send will be logged in `notifications_log`.
- **File attachments** on plans (needs file storage).
- **Amazon and Flipkart:** first, how those orders are recorded.

## 4 · Reference: Zoho facts this relies on (checked 14–15 Nov 2026, read-only)

- India data centre. The org is shared with the clinic and online CRMs: 80 calls a minute in total, plus a daily cap by plan.
- `GET /locations` lists all 16 locations. Mohali – Warehouse is primary: an adjustment sent without a location lands there.
- `GET /items?location_id=…` returns every item, with that location's stock, in one page (197 items).
  - A location the login may not read answers code 400040.
  - Sales orders, invoices and transfer orders answer code 57 ("not authorized").
- The CRMs post every stock change to Zoho as an inventory adjustment at the clinic's Zoho location. Refusals stay in the CRM (Data health §5).

## 5 · Still to confirm with the business

- **23rd vs 25th:** the panel assumes the 23rd = the request email with links, the 25th = the deadline (submitted plans emailed to the CBO, MD and Herman), and the 26th = the consolidated report.
- **Contact details:** the real email addresses and the CBO's WhatsApp number (Settings holds placeholders).
- **Lead times and pack sizes:** the vendor lead times and pack sizes per product. Zoho has no lead time, so every vendor starts at 15 days (a setting).
- **Amazon and Flipkart:** how they are recorded, and what the two darkstores are used for.
