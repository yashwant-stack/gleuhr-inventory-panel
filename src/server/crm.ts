import "server-only";
// Read-only queries against the CRM database (shared by the clinic and online CRMs).
// Tables read: clinics, retail_products, stock_movements, online_shopify_orders,
// product_sale_lines, online_order_lines. Nothing is ever written there.
// (retail_products.zoho_item_id is UNIQUE in the clinic CRM's schema: one CRM product per Zoho item.)
//
// The channel of a stock movement (verified on production data, 14–15 Nov 2026):
//   no online order                         → clinic
//   online order linked to a Shopify order   → website
//   any other online order                   → online_team
// Its kind: sale / online_sale → sale · online_rto_in, online_cancel_in, online_pack_* → return ·
// complimentary → free · exchange_in / exchange_out → exchange · adjustment (stock received) →
// stock_in · anything else (e.g. online_rto_missing, a write-off) → loss.
// Value = the line's unit price after the line discount, as recorded on the sale.
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
)
select mv.day::text as day, mv.product_id::text as crm_product_id, mv.clinic_id::text as crm_clinic_id,
  case when mv.online_order_id is null then 'clinic'
       when shop.order_id is not null then 'website'
       else 'online_team' end as channel,
  case mv.reason
       when 'sale' then 'sale' when 'online_sale' then 'sale'
       when 'online_rto_in' then 'return' when 'online_cancel_in' then 'return'
       when 'online_pack_exception' then 'return' when 'online_pack_undo' then 'return' when 'online_pack_cancel' then 'return'
       when 'complimentary' then 'free'
       when 'exchange_in' then 'exchange' when 'exchange_out' then 'exchange'
       when 'adjustment' then 'stock_in'
       else 'loss' end as kind,
  sum(mv.qty) as qty,
  sum(mv.qty * coalesce(pr.unit_net, 0)) as value,
  count(*) as movements
from mv
left join shop on shop.order_id = mv.online_order_id
left join lateral (
  select case
    when mv.product_sale_id is not null then (
      select avg(psl.unit_price * (1 - coalesce(psl.discount_pct, 0) / 100.0)) from public.product_sale_lines psl
      where psl.product_sale_id = mv.product_sale_id and psl.product_id = mv.product_id)
    when mv.online_order_id is not null then (
      select avg(ol.unit_price_hist * (1 - coalesce(ol.disc_pct, 0) / 100.0)) from public.online_order_lines ol
      where ol.order_id = mv.online_order_id and ol.product_id = mv.product_id)
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
