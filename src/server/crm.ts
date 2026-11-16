import "server-only";
// Read-only queries against the CRM database (shared by the clinic and online CRMs).
// Tables read (SELECT only): clinics, retail_products, stock_movements, online_shopify_orders,
// product_sales, product_sale_lines, online_orders, online_order_lines, online_offers.
// Nothing is ever written there.
// (retail_products.zoho_item_id is UNIQUE in the clinic CRM's schema: one CRM product per Zoho item.)
//
// The channel of a stock movement (verified on production data, 14–15 Nov 2026):
//   no online order                         → clinic
//   online order linked to a Shopify order   → website
//   any other online order                   → online_team
// Its kind (verified against the CRM's own code and production, 16 Nov 2026):
//   sale / online_sale → sale · complimentary → free · exchange_in / exchange_out → exchange
//   adjustment ON A CLINIC BILL → the bill was edited down, a line removed or the sale cancelled: the stock
//     comes back → return (free, when the bill is complimentary). In the CRM an adjustment is never stock
//     received: all 2,530 in the 30 days to 16 Nov were bill reversals.
//   online_rto_in, online_cancel_in, online_pack_* coming back (qty > 0) → return
//   anything else (online_rto_missing / _damaged, a write-off) → loss
// Value = what the customer paid for the products, GST included (the CRMs' prices include GST):
//   clinic: the bill line's price after its discount, scaled to the bill's real total (product_sales.total_amount):
//     a whole-bill offer (buy-one-get-one, a quantity tier) and the round-off sit on the bill, not on its lines;
//   online: the line's price after its discount, times the order's share left after buy-one-get-one free units
//     and round-off (the CRM's app.online_order_lines_total). The delivery charge (COD fee, shipping) is never
//     product sales, so it is left out — it is why an online order's stored total is higher than its lines.
// Checked on production, 30 days to 16 Nov 2026: online matches the CRM's product totals to ₹100 in ₹2.36 crore.
import type { Db } from "./db";
import { num } from "./db";

export interface CrmClinicRow {
  crm_clinic_id: string;
  name: string;
  active: boolean;
  zoho_location_id: string | null;
}

export async function readClinics(crm: Db): Promise<CrmClinicRow[]> {
  return crm.query<CrmClinicRow>("select id::text as crm_clinic_id, name, active, zoho_location_id from public.clinics order by id");
}

export interface CrmProductRow {
  crm_product_id: string;
  sku: string | null;
  name: string;
  zoho_item_id: string | null;
  price: number;
  active: boolean;
  /** The IST day it was added to the CRM. */
  created_on: string | null;
}

export async function readProducts(crm: Db): Promise<CrmProductRow[]> {
  const rows = await crm.query<Record<string, unknown>>(
    `select id::text as crm_product_id, sku, name, zoho_item_id, price, active,
            ((created_at at time zone 'Asia/Kolkata')::date)::text as created_on
     from public.retail_products`,
  );
  return rows.map((r) => ({
    crm_product_id: String(r.crm_product_id),
    sku: (r.sku as string | null) ?? null,
    name: String(r.name),
    zoho_item_id: (r.zoho_item_id as string | null) ?? null,
    price: num(r.price),
    active: Boolean(r.active),
    created_on: (r.created_on as string | null) ?? null,
  }));
}

export interface FlowRow {
  day: string;
  crm_product_id: string;
  crm_clinic_id: string;
  channel: "clinic" | "online_team" | "website";
  kind: "sale" | "return" | "free" | "exchange" | "stock_in" | "loss";
  qty: number;
  value: number;
  movements: number;
}

export const FLOWS_SQL = `
with shop as (
  select distinct order_id from public.online_shopify_orders where order_id is not null
), mv as (
  select sm.product_id, sm.clinic_id, sm.qty, sm.reason::text as reason, sm.online_order_id, sm.product_sale_id,
         (sm.created_at at time zone 'Asia/Kolkata')::date as day
  from public.stock_movements sm
  where sm.created_at >= $1::timestamptz and sm.created_at < $2::timestamptz
), ord as (
  select distinct online_order_id as oid from mv where online_order_id is not null
), ol as (
  -- every line of those orders, at the price it was sold at (the catalogue's when the line kept none, as the CRM does)
  select l.order_id as oid, l.product_id, l.qty, coalesce(l.disc_pct, 0) as disc_pct, l.offer_id,
         coalesce(l.unit_price_hist, rp.price, 0) as price
  from public.online_order_lines l
  join ord on ord.oid = l.order_id
  left join public.retail_products rp on rp.id = l.product_id
), bogo as (
  -- buy-one-get-one ('auto' discount mode, a line on a 'bogo' offer): in every full group of 2 (b1g1) or 3 (b2g1)
  -- units the cheapest is free, and paid_pct comes off the rest — the CRM's app.online_order_lines_total
  select r.oid, sum(case when r.rn <= floor(r.n::numeric / r.per) then r.price else r.price * r.paid_pct / 100 end) as free
  from (
    select u.*, row_number() over (partition by u.oid, u.offer_id order by u.price) as rn,
           count(*) over (partition by u.oid, u.offer_id) as n
    from (
      select ol.oid, ol.offer_id, ol.price,
             case f.bogo_type::text when 'b2g1' then 3 else 2 end as per, coalesce(f.paid_pct, 0) as paid_pct
      from ol
      join public.online_orders o on o.id = ol.oid and o.disc_mode::text = 'auto'
      join public.online_offers f on f.id = ol.offer_id and f.type::text = 'bogo'
      cross join generate_series(1, ol.qty)
    ) u
  ) r
  group by r.oid
), ofactor as (
  -- the share of the lines' value the customer paid for the products: (lines − BOGO free − round-off) ÷ lines
  select t.oid,
         case when t.net > 0 then greatest(0, t.net - coalesce(b.free, 0) - coalesce(o.round_off, 0)) / t.net else 1 end as f
  from (select oid, sum(price * qty * (1 - disc_pct / 100.0)) as net from ol group by 1) t
  join public.online_orders o on o.id = t.oid
  left join bogo b on b.oid = t.oid
), ps as (
  select s.id, s.complimentary, s.total_amount from public.product_sales s
  where s.id in (select product_sale_id from mv where product_sale_id is not null)
), pfactor as (
  -- a clinic bill's total carries the whole-bill offer (buy-one-get-one, a quantity tier) and round-off that its
  -- lines do not: each line's value is scaled to the bill's real total (a cancelled bill keeps its total, so its
  -- sale and its reversal still cancel out)
  select ps.id, case when t.net > 0 then greatest(0, coalesce(ps.total_amount, t.net)) / t.net else 1 end as f
  from ps
  join (select product_sale_id as id, sum(unit_price * qty * (1 - coalesce(discount_pct, 0) / 100.0)) as net
        from public.product_sale_lines where product_sale_id in (select id from ps) group by 1) t on t.id = ps.id
)
select mv.day::text as day, mv.product_id::text as crm_product_id, mv.clinic_id::text as crm_clinic_id,
  case when mv.online_order_id is null then 'clinic'
       when shop.order_id is not null then 'website'
       else 'online_team' end as channel,
  case
    when mv.reason in ('sale', 'online_sale') then 'sale'
    when mv.reason = 'complimentary' then 'free'
    when mv.reason = 'adjustment' and mv.product_sale_id is not null then case when ps.complimentary then 'free' else 'return' end
    when mv.reason in ('online_rto_in', 'online_cancel_in', 'online_pack_exception', 'online_pack_undo', 'online_pack_cancel')
         and mv.qty > 0 then 'return'
    when mv.reason in ('exchange_in', 'exchange_out') then 'exchange'
    when mv.reason = 'adjustment' and mv.qty > 0 then 'stock_in'
    else 'loss' end as kind,
  sum(mv.qty) as qty,
  sum(mv.qty * coalesce(pr.unit_net, 0)) as value,
  count(*) as movements
from mv
left join shop on shop.order_id = mv.online_order_id
left join ps on ps.id = mv.product_sale_id
left join ofactor ofc on ofc.oid = mv.online_order_id
left join pfactor pfc on pfc.id = mv.product_sale_id
left join lateral (
  select case
    when mv.product_sale_id is not null then (
      select sum(psl.unit_price * psl.qty * (1 - coalesce(psl.discount_pct, 0) / 100.0)) / nullif(sum(psl.qty), 0)
      from public.product_sale_lines psl
      where psl.product_sale_id = mv.product_sale_id and psl.product_id = mv.product_id) * coalesce(pfc.f, 1)
    when mv.online_order_id is not null then (
      select sum(ol.price * ol.qty * (1 - ol.disc_pct / 100.0)) / nullif(sum(ol.qty), 0)
      from ol where ol.oid = mv.online_order_id and ol.product_id = mv.product_id) * coalesce(ofc.f, 1)
  end as unit_net
) pr on true
group by 1, 2, 3, 4, 5`;

/** Daily totals for stock movements created in [fromIso, toIso). */
export async function readFlows(crm: Db, fromIso: string, toIso: string): Promise<FlowRow[]> {
  const rows = await crm.query<Record<string, unknown>>(FLOWS_SQL, [fromIso, toIso]);
  return rows.map((r) => ({
    day: String(r.day),
    crm_product_id: String(r.crm_product_id),
    crm_clinic_id: String(r.crm_clinic_id),
    channel: r.channel as FlowRow["channel"],
    kind: r.kind as FlowRow["kind"],
    qty: num(r.qty),
    value: num(r.value),
    movements: num(r.movements),
  }));
}

export interface PushHealthRow {
  crm_clinic_id: string;
  location_name: string;
  failed: number;
  first_failed: string | null;
  last_failed: string | null;
  top_error: string;
}

/** CRM stock changes Zoho refused since `sinceIso` (the sync passes 30 days ago), per clinic, with the commonest reason in plain words. */
export async function readPushHealth(crm: Db, sinceIso: string): Promise<PushHealthRow[]> {
  const rows = await crm.query<Record<string, unknown>>(
    `
    select sm.clinic_id::text as crm_clinic_id, coalesce(c.name, '?') as location_name, count(*) as failed,
           min((sm.created_at at time zone 'Asia/Kolkata')::date)::text as first_failed,
           max((sm.created_at at time zone 'Asia/Kolkata')::date)::text as last_failed,
           mode() within group (order by left(coalesce(sm.sync_error, ''), 200)) as top_error
    from public.stock_movements sm left join public.clinics c on c.id = sm.clinic_id
    where sm.sync_status::text = 'failed' and sm.created_at >= $1::timestamptz
    group by 1, 2`,
    [sinceIso],
  );
  return rows.map((r) => ({
    crm_clinic_id: String(r.crm_clinic_id),
    location_name: String(r.location_name),
    failed: num(r.failed),
    first_failed: (r.first_failed as string | null) ?? null,
    last_failed: (r.last_failed as string | null) ?? null,
    top_error: plainZohoError(String(r.top_error ?? "")),
  }));
}

export function plainZohoError(raw: string): string {
  if (/access to the location|location permission/i.test(raw)) return "No access to this Zoho location";
  if (/"code":\s*57|not authorized/i.test(raw)) return "Zoho: not authorized (code 57)";
  if (/9205|sufficient stock/i.test(raw)) return "Zoho: not enough stock (negative stock blocked)";
  if (/non-inventory/i.test(raw)) return "Zoho: item not tracked as inventory";
  return raw ? raw.slice(0, 120) : "Unknown";
}
