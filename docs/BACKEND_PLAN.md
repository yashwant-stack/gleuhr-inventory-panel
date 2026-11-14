# Backend plan: notes for the next stage

Written at the end of the frontend stage (14 Nov 2026). Nothing here is built yet. These are the facts found in the two existing Gleuhr codebases that the backend must respect, plus the decisions still needed.

Sources read (read-only):
- `aman-cf/gleuhr-clinic-crm`: `src/server/zoho/*` (client, token, stock, budget, reason) and `docs/lanes/aaryan/tasks-1nov/w-stock/REPORT.md`
- `aman-cf/gleuhr-online`: `src/fixtures/seed-data.json` (catalogue, clinics)

**No call was made to Zoho during this stage.** The credentials shared in chat were not used or stored. Because they were shared in a chat, generate a new client secret and refresh token before go-live, and put them only in the hosting provider’s secret store.

## 1 · Connecting to Zoho

- India data centre: API `https://www.zohoapis.in/inventory/v1/...`, OAuth `https://accounts.zoho.in/oauth/v2/token`.
- Every call carries `organization_id` and `Authorization: Zoho-oauthtoken <access token>`.
- Refresh-token flow: exchange the long-lived refresh token for a 1-hour access token, and cache it (re-mint a minute before expiry). Never mint a token per request. The clinic CRM’s `src/server/zoho/token.ts` is a good pattern to copy (copy and adapt, not share code).
- The browser never calls Zoho; only the server does.

## 2 · What the panel needs from Zoho

| Data | Endpoint | Notes |
|---|---|---|
| Locations (warehouse + 9 clinics) | `GET /locations` | Clinics are Zoho locations (the clinic CRM maps `clinics.zoho_location_id`). Mohali is a non-clinic warehouse location. |
| Stock per location | `GET /items?location_id=…&per_page=200` | Per-row stock is `locations[].location_stock_on_hand` for that location, else `stock_on_hand`. Use **stock on hand**, not “available for sale”. About 250 SKUs means 2 pages per location. |
| Clinic & online-team sales | `GET /inventoryadjustments` (by date) | The clinic and online CRMs push every sale to Zoho as an **inventory adjustment**, not an invoice. The `reason` text says what it was: `CRM sale`, `Online sale`, `Complimentary`, `Exchange in`/`out`, `Online RTO restock`, `Online cancellation restock`, `Online RTO — missing (written off)`, `Online RTO — damaged (written off)`, `Online pack reversed — …`. Sales = sale reasons minus their reversals. |
| Amazon / Flipkart / Shopify sales | `GET /salesorders` or `/invoices` | Confirmed by the business to be in Zoho. **To verify at the first live read:** which field marks the channel (sales channel, customer or integration). |
| Open purchase orders | `GET /purchaseorders` (open) | Quantity still to receive and expected date: the “on the way” figure. |
| Transfers | `GET /transferorders` | Warehouse → clinic moves are not sales. |
| Vendors | `GET /vendors` | Lead time per vendor (and per-product overrides) is kept as a panel setting. |

**Diet plans** (`GL-DIET1M/2M/3M`) have no stock (the clinic CRM lists them in the `inventory.stockless_skus` setting) and are left out of stock and indent.

## 3 · The shared Zoho request limit (most important constraint)

- Gleuhr has **one Zoho org**, shared by the clinic CRM and the online CRM. It allows **80 requests a minute in total**, and the two CRMs count every call in the shared database (`zoho_rate_state`, reserved through `zoho_reserve_call`; a 429 from Zoho blocks both through `zoho_block`).
- Zoho also caps calls **per day by plan** (clinic CRM notes: Free 1k · Standard 2k · Professional 5k · Premium 10k; which plan Gleuhr is on is still to be verified). Stock display reads in the clinic CRM have their own ceilings (`zoho.stock_reads_per_minute`, `zoho.stock_reads_per_day`).
- **The panel must not starve the CRMs’ stock pushes.** Either reserve every panel call through the same shared budget, or agree a fixed small ceiling for the panel with whoever owns that database.
- Rough panel need (estimate): 1 call for locations + about 20 for a full stock snapshot (10 locations × 2 pages) + a few pages of adjustments, orders and POs per hourly sync. That is in the low hundreds a day, well inside even the smallest paid plan if synced incrementally (`last_modified_time`) and never per page view.

## 4 · Known risk to check first

The clinic CRM recorded (open question Q-5646) that on 22 Oct the live org returned **194 items for Chandigarh’s location with no stock count**. If per-location stock comes back empty, the panel cannot show clinic stock from Zoho. **Do one budgeted read of one location before building anything on it.**

## 5 · Decision needed: where sales come from

Two options for clinic and online-team sales:
1. **From Zoho** (as the brief says): read inventory adjustments by reason. Costs Zoho calls; carries quantities, not prices.
2. **From the shared Gleuhr database**: the `stock_movements` table already has every clinic and online-team movement with clinic, product, quantity, reason and time. It costs no Zoho calls, but it needs read access to that database, which the clinic CRM’s rules treat as production (ask first; read-only).

Amazon, Flipkart and Shopify come from Zoho either way.

## 6 · Shape of the backend

- A scheduled sync job (every 1–2 hours plus a nightly full stock snapshot) writes into the panel’s own database: products, locations, daily stock snapshots, daily sales by product × source, open POs.
- The same `src/lib/domain/formulas.ts` runs on the server each night and writes per-product metrics (rate, projections, cover, status, order quantity). The screens then read those instead of `src/lib/mock`; `useDataset()` in `src/lib/data/hooks.ts` is the one swap point.
- Settings, approvals and plan submissions move from browser storage to the database, with versions kept and every change logged.
- Email: Zoho ZeptoMail or SMTP. WhatsApp: WhatsApp Business Platform with Meta-approved templates. Every send is logged (the Alerts page’s log).
- Plan links: one personal link per person per cycle, closing at the deadline.
- Login with roles: admin (CBO), viewer (MD, Herman), planner (MH, SH, online team, Manisha).

## 7 · Still to confirm with the business

- 23rd vs 25th: the panel assumes 23rd = request email with links, 25th = deadline (submitted plans emailed to CBO, MD, Herman), 26th = consolidated report.
- Real email addresses and the CBO’s WhatsApp number (Settings currently holds placeholders).
- Vendor lead times and pack sizes per product (sample values today).
