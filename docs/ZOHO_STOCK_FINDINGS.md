# How stock is counted in Zoho: verified 14 Nov 2026

**Answer: Zoho does not keep separate stock per sales channel.** It keeps stock per **location** (where the goods physically sit). Each channel takes stock out of whichever location it ships from, so in Zoho the online team and the website share the same warehouse stock.

How this was checked (all read-only; nothing was written anywhere):
- **Code:** the clinic CRM and the online CRM (`aman-cf/gleuhr-clinic-crm` @ 07f7bb2e, `aman-cf/gleuhr-online` @ 42f8120).
- **Database:** the shared production database `gleuhr-clinic-prod`. Read-only queries only, returning totals, no customer data.
- **Zoho:** about 20 calls to Zoho Inventory (org 60079962526, *GLEUHR SKINCARE AND INNOVATIONS PRIVATE LIMITED*), spread out.

## Zoho locations (16)

Mohali - Warehouse (the main / primary location) · Ahmedabad · Amritsar · Bathinda · Chandigarh · Delhi · Delhi - DARKSTORE · Delhi 92 · Gurugram · Jaipur · Jalandhar · Karnal · Ludhiana · Mumbai · Mumbai - Darkstore · Pune.

There is **no Zoho location for Amazon, Flipkart, Shopify or the online team.**

## How each channel reduces Zoho stock

| Channel | How it reaches Zoho | Taken from (Zoho location) | Separate count in Zoho? |
|---|---|---|---|
| Clinics | Clinic CRM sends a stock adjustment per sale: “CRM sale”, “Complimentary”, “Exchange in/out” | That clinic’s own location | **Yes**, one count per clinic |
| Online team | Online CRM sends “Online sale”. Courier / Post Office orders take stock at **packed**; Rapido at dispatch; clinic pickup when collected | Mohali - Warehouse (setting `online.courier_stock_clinic_id` = 13); Delhi when Shiprocket ships from Delhi (`online.delhi_stock_clinic_id` = 7); the order’s clinic for Rapido / pickup | **No**, shares the warehouse |
| Website (Shopify) | Shopify webhook → online CRM (`online_shopify_orders`) → a normal courier order → same “Online sale” | Same as the online team (Mohali, sometimes Delhi) | **No**, identical to online-team sales in Zoho; only the CRM database can tell them apart |
| Amazon | Not in either CRM (the only “Amazon” in code is a Shiprocket courier service and Amazon Pay) | Not visible: this Zoho login cannot read sales orders, invoices or transfer orders, and cannot see 5 locations (incl. both darkstores) | **Unknown** |
| Flipkart | Not in either CRM | Same as Amazon | **Unknown** |

The location of every push is decided only by the stock row’s clinic (`stock_movements.clinic_id` → `clinics.zoho_location_id`, `src/server/zoho/movement-sync.ts:143,162`). If the clinic has no Zoho location, the adjustment is sent without one (`client.ts:83`), and **Zoho puts it on Mohali - Warehouse** (confirmed on one Delhi East adjustment).

### Last 30 days (units out of Zoho, from the database)

| What | Where | Units |
|---|---|---|
| Online sale (online team + website) | Mohali - Warehouse | −13,112 (RTO restock +570) |
| …of which Shopify website orders | Mohali / Delhi | −2,356 / −172 (1,898 Shopify orders, 28% of online orders) |
| Online sale | Delhi | −767 |
| Online sale (Rapido / pickup) | Chandigarh, Jalandhar, Ludhiana, Amritsar, Bathinda, Gurgaon, Karnal | −479, −271, −184, −157, −140, −49, −34 |
| Clinic sales | e.g. Chandigarh, Jalandhar, Ludhiana, Amritsar, Delhi | −4,394, −2,217, −2,100, −2,054, −1,821 |

### Example: one product, live from Zoho

UV Armour Sunscreen (GL-UVARMOR): Mohali - Warehouse 6,290 · Delhi 92 196 · Delhi 131 · Gurugram 126 · Karnal 104 · Bathinda 81 · Jalandhar 38 · Ludhiana 10 · Jaipur 2 · Amritsar 2 · Chandigarh −1. (The login sees 11 of the 16 locations.)

## Problems that make Zoho’s counts wrong today

1. **Mumbai and Ahmedabad:** 1,662 stock changes since mid-October were rejected by Zoho with “you do not have access to the location”. The Zoho user the CRMs post as has no access to those locations, so their Zoho stock is too high.
2. **“Not authorized” (Zoho code 57):** about 800 changes across all locations since 22 October never reached Zoho.
3. **Delhi East has no Zoho location**, so its sales (≈900 units in 30 days) come off Mohali - Warehouse. **Pune** exists in Zoho, but the CRM’s Pune clinic is not linked to it, so the same will happen there.
4. **Shopify cancellations do not put stock back** automatically (`shopify-intake.ts:160-175`).
5. **Stock can go negative** (Chandigarh −1 above). A few items were refused with “insufficient stock” in mid-October.
6. **Delhi 92** (the inactive “Delhi West” clinic in the CRM) still holds stock in Zoho.
7. Not a problem: 1,519 online orders imported from Airtable on 28 Oct (order dates 23 Jul – 14 Oct) correctly do not reduce stock again.

## What this login cannot see

- 5 locations: Ahmedabad, Mumbai, Pune, Delhi - DARKSTORE, Mumbai - Darkstore.
- Sales orders, invoices and transfer orders (“You are not authorized to perform this operation”).
- The second Zoho organisation “Gleuhr” (60035681263): “account is disabled”.

## What this means for the panel’s backend

- **Stock** comes from Zoho per location, for all 16 locations (the sample data has 10).
- **Sales by channel** must come from the CRM database: clinic sales from `stock_movements` / clinic sales, online-team orders from `online_orders`, and website orders from `online_shopify_orders`. Zoho cannot separate them.
- **Amazon and Flipkart:** first find out how they are recorded today (see the questions below).
- The panel needs a Zoho login that can **read all 16 locations, sales orders, invoices, transfer orders and purchase orders.**

## Open questions for the business

1. How are Amazon and Flipkart orders recorded today? (In Zoho as sales orders / invoices? Through another tool? Fulfilled by the marketplace from its own warehouse? Shipped from a darkstore?)
2. What are Delhi - DARKSTORE and Mumbai - Darkstore used for?
3. Who will give the Zoho integration user access to Mumbai, Ahmedabad and the other hidden locations, and link Delhi East and Pune?
