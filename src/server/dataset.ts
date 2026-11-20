import "server-only";
// Builds the Dataset the screens use, from the panel's own database (filled by the sync).
// Sales per channel come from daily_flows (the CRM); stock per location from stock_levels (Zoho).
//
// A product here is a Zoho item that a CRM sells: a CRM product (crm_products) linked to a Zoho
// item that tracks stock. (The CRM allows one CRM product per Zoho item; should two ever share
// one, their sales add up.) CRM products with no usable Zoho item are left out and listed on
// Data health with their sales.
//
// A product's history starts the day it was added to the CRM (or its first stock movement, if
// earlier), never at its first sale: a slow seller is not "new" just because it sold late.
import { addDays, diffDays } from "../lib/dates";
import type { BottleItem, ChannelInfo, CrmClinic, Dataset, DataHealth, LeftOutProduct, Source } from "../lib/data/model";
import { parseSegment, type ChannelId, type Location, type Product, type PurchaseOrder, type Vendor } from "../lib/domain/types";
import { CHANNELS } from "../lib/mock/catalog";
import { type Db, num } from "./db";
import { istToday } from "./sync";
import { alertConfig, alertLog } from "./alerts";

const NOT_CONNECTED_NOTE = "Not in the clinic or online CRM, and no Zoho location. Tell us how these orders are recorded to connect them.";

/** Plain names for the sync jobs on Data health. */
export const JOB_LABELS: Record<string, string> = {
  zoho_catalog: "Zoho items and locations",
  zoho_stock: "Zoho stock per location",
  zoho_access: "Zoho access check",
  crm_reference: "CRM clinics and products",
  crm_flows: "CRM sales",
  crm_health: "Stock changes Zoho refused",
  reorder_alerts: "Reorder alerts (email / WhatsApp)",
  zoho_regimen: "Type Regimen per product (weekly)",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function settingNum(db: Db, key: string, fallback: number): Promise<number> {
  const [r] = await db.query<{ value: unknown }>("select value from settings where key = $1", [key]);
  const v = r?.value;
  const n = num(typeof v === "string" ? JSON.parse(v) : v);
  return n > 0 ? n : fallback;
}

interface LinkRow {
  crm_product_id: string;
  crm_name: string;
  crm_price: unknown;
  crm_active: boolean;
  created_on: string | null;
  crm_category: string | null;
  /** The Zoho item the CRM links to (null = none). */
  linked_item: string | null;
  /** That item as the panel knows it from Zoho (null = Zoho has no such item). */
  zoho_item_id: string | null;
  in_zoho: boolean | null;
  track_inventory: boolean | null;
}

/** The panel's database has no data to show yet (the first sync has not finished). */
export class NotReady extends Error {}

export async function buildDataset(db: Db, now = new Date()): Promise<Dataset> {
  const today = istToday(now);
  const historyDays = await settingNum(db, "panel.history_days", 180);
  const defaultLead = await settingNum(db, "lead.default_days", 60);
  const costRatio = await settingNum(db, "cost.fallback_ratio", 0.3);
  const days = Array.from({ length: historyDays }, (_, i) => addDays(today, i - historyDays + 1));
  const start = days[0]!;
  const ninetyAgo = addDays(today, -89);

  const locRows = await db.query<Record<string, unknown>>("select * from locations where active order by is_primary desc, (kind = 'darkstore'), name");
  const locations: Location[] = locRows.map((l) => ({
    id: String(l.zoho_location_id),
    name: String(l.name),
    kind: l.kind as Location["kind"],
    isPrimary: Boolean(l.is_primary),
    readable: Boolean(l.readable),
  }));
  const primary = locations.find((l) => l.isPrimary) ?? locations[0];
  if (!primary || locRows.some((l) => !l.checked_at)) {
    throw new NotReady("No stock yet: the first stock read from Zoho has not reached every location. It runs every day at 9:00 AM, or press “Sync from Zoho now”.");
  }

  const clinicRows = await db.query<Record<string, unknown>>("select * from crm_clinics order by crm_clinic_id");
  const clinics: CrmClinic[] = clinicRows.map((c) => ({
    id: String(c.crm_clinic_id),
    name: String(c.name),
    active: Boolean(c.active),
    zohoLocationId: c.zoho_location_id && locations.some((l) => l.id === c.zoho_location_id) ? String(c.zoho_location_id) : null,
  }));
  const clinicById = new Map(clinics.map((c) => [c.id, c]));

  // Sales per CRM product: 90-day units and the last sale day (for the left-out list and the inclusion rule).
  const saleStats = await db.query<{ p: string; units90: unknown; last_sale: string | null; in_window: boolean }>(
    `select crm_product_id::text as p,
            coalesce(-sum(qty) filter (where day >= $1::date), 0) as units90,
            max(day)::text as last_sale,
            bool_or(day >= $2::date) as in_window
     from daily_flows where kind = 'sale' group by 1`,
    [ninetyAgo, start],
  );
  const stats = new Map(saleStats.map((r) => [r.p, r]));

  // Every CRM product with its Zoho item (if any).
  const links = await db.query<LinkRow>(
    `select cp.crm_product_id::text as crm_product_id, cp.name as crm_name, cp.price as crm_price, cp.active as crm_active,
            cp.created_on::text as created_on, cp.category as crm_category, cp.zoho_item_id as linked_item,
            p.zoho_item_id, p.in_zoho, p.track_inventory
     from crm_products cp left join products p on p.zoho_item_id = cp.zoho_item_id
     order by cp.crm_product_id`,
  );
  const leftOutProducts: LeftOutProduct[] = [];
  const planned = new Map<string, LinkRow[]>(); // zoho item → its CRM products
  for (const l of links) {
    const st = stats.get(l.crm_product_id);
    const reason = !l.linked_item
      ? "No Zoho item linked in the CRM"
      : !l.zoho_item_id || l.in_zoho === false
        ? "Linked to a Zoho item that Zoho doesn’t have"
        : l.track_inventory === false
          ? "Zoho does not track stock for its item"
          : null;
    if (reason) {
      const units = num(st?.units90);
      if (l.crm_active || units > 0) leftOutProducts.push({ name: l.crm_name, reason, unitsSold90d: units, lastSale: st?.last_sale ?? null });
      continue;
    }
    // Planned when the CRM still sells it, or it sold inside the panel's history window.
    if (!l.crm_active && !st?.in_window) continue;
    const list = planned.get(l.zoho_item_id!) ?? [];
    list.push(l);
    planned.set(l.zoho_item_id!, list);
  }
  leftOutProducts.sort((a, b) => b.unitsSold90d - a.unitsSold90d || a.name.localeCompare(b.name));
  if (!links.length) throw new NotReady("No sales yet: the first sync from the CRM database has not finished. It runs every day at 9:00 AM, or press “Sync from Zoho now”.");

  const prodRows = planned.size
    ? await db.query<Record<string, unknown>>("select * from products where zoho_item_id in (select jsonb_array_elements_text($1::text::jsonb)) order by name", [
        JSON.stringify([...planned.keys()]),
      ])
    : [];
  const [zohoOnly] = await db.query<{ n: number }>(
    `select count(*)::int as n from products p where p.in_zoho and p.active and p.track_inventory
     and not exists (select 1 from crm_products cp where cp.zoho_item_id = p.zoho_item_id)`,
  );

  const vendors: Vendor[] = [];
  const pIndex = new Map<string, number>(); // CRM product id → product index
  const products: Product[] = prodRows.map((p, i) => {
    const crm = planned.get(String(p.zoho_item_id)) ?? [];
    for (const c of crm) pIndex.set(c.crm_product_id, i);
    const vendorName = (p.vendor_name as string | null) || "Vendor not set in Zoho";
    const vendorId = slug(vendorName);
    if (!vendors.some((v) => v.id === vendorId)) vendors.push({ id: vendorId, name: vendorName, leadTimeDays: defaultLead });
    // The CRMs' own price (the highest when several CRM products share the item), else Zoho's.
    const crmPrice = Math.max(0, ...crm.map((c) => num(c.crm_price)));
    const price = crmPrice || num(p.sell_price);
    const purchase = num(p.purchase_price);
    return {
      id: String(p.zoho_item_id),
      sku: (p.sku as string | null) ?? "",
      name: String(p.name),
      // Zoho's category, else the online CRM's (Zoho's items carry none today)
      category: (p.category as string | null) || crm.map((c) => c.crm_category).find(Boolean) || "Uncategorised",
      // from Zoho's Type Regimen field only (decided 20 Nov 2026): empty in Zoho = "Not set in Zoho"
      segment: parseSegment(p.segment),
      regimenRaw: (p.regimen_raw as string | null | undefined) ?? null,
      price,
      // Zoho's purchase price of ₹10 or less is a placeholder on many items: fall back to a share of the selling price.
      cost: purchase > 10 ? purchase : Math.round(price * costRatio),
      costEstimated: !(purchase > 10),
      vendorId,
      leadTimeOverride: null,
      packSize: Math.max(1, num(p.pack_size) || 1),
      launchedOn: start,
      soldInCrm: true,
    };
  });

  const flowRows = await db.query<Record<string, unknown>>(
    `select day::text as day, crm_product_id::text as p, crm_clinic_id::text as c, channel, kind, sum(qty) as qty, sum(value) as value
     from daily_flows where day >= $1::date group by 1, 2, 3, 4, 5 order by 1`,
    [start],
  );
  // A channel's data starts at its first sale of any product (the day the CRMs began recording it).
  // A product's history starts when it was added to the CRM, or at its first stock movement if earlier.
  const channelFirst: Record<string, string> = {};
  const sourceFirst: Record<string, string> = {}; // channel:clinic → first sale of any product
  const productFirst: Record<number, string> = {};
  const earlier = (a: string | undefined, b: string | null | undefined) => (!a ? (b ?? undefined) : b && b < a ? b : a);
  for (const f of flowRows) {
    const day = String(f.day);
    if (f.kind === "sale") {
      channelFirst[String(f.channel)] = earlier(channelFirst[String(f.channel)], day)!;
      sourceFirst[`${f.channel}:${f.c}`] = earlier(sourceFirst[`${f.channel}:${f.c}`], day)!;
    }
    const pi = pIndex.get(String(f.p));
    if (pi !== undefined) productFirst[pi] = earlier(productFirst[pi], day)!;
  }
  products.forEach((p, pi) => {
    let first = productFirst[pi];
    for (const c of planned.get(p.id) ?? []) first = earlier(first, c.created_on);
    p.launchedOn = first && first > start ? first : start;
  });

  // Sources: one per (channel, CRM clinic) that sold or used stock in the window. Stock received
  // or written off is not a sale, so it never makes a place a sales point (e.g. the warehouse).
  const USAGE = new Set(["sale", "return", "free", "exchange"]);
  const sources: Source[] = [];
  const sIndex = new Map<string, number>();
  for (const f of flowRows) {
    const key = `${f.channel}:${f.c}`;
    if (sIndex.has(key) || !pIndex.has(String(f.p)) || !USAGE.has(String(f.kind))) continue;
    const clinic = clinicById.get(String(f.c));
    const locationId = clinic?.zohoLocationId ?? primary.id;
    // The CRM's warehouse "clinic" (its Zoho location is the primary one) is where online orders are dispatched
    // from; any other clinic is a real clinic, even when unlinked and so booked on the primary location.
    const warehouseClinic = clinic?.zohoLocationId === primary.id;
    const channel = f.channel as ChannelId;
    const clinicName = clinic?.name ?? `Clinic ${f.c}`;
    const place = warehouseClinic ? `${primary.name} dispatch` : clinic?.zohoLocationId ? clinicName : `${clinicName} (booked on ${primary.name})`;
    const label = channel === "clinic" ? place : `${CHANNELS.find((c) => c.id === channel)?.short ?? channel} · ${place}`;
    sIndex.set(key, sources.length);
    sources.push({ id: key, channel, locationId, clinicId: channel !== "clinic" && warehouseClinic ? null : String(f.c), label, dataFrom: sourceFirst[key] ?? null });
  }

  const n = days.length;
  const sold = products.map(() => sources.map(() => new Int32Array(n)));
  const value = products.map(() => sources.map(() => new Float64Array(n)));
  const used = products.map(() => sources.map(() => new Int32Array(n)));
  const usedAny = products.map(() => new Uint8Array(n));
  for (const f of flowRows) {
    const pi = pIndex.get(String(f.p));
    const si = sIndex.get(`${f.channel}:${f.c}`);
    const d = diffDays(String(f.day), start);
    if (pi === undefined || si === undefined || d < 0 || d >= n) continue;
    const q = -num(f.qty); // CRM sign: negative = out
    const v = -num(f.value);
    if (f.kind === "sale" || f.kind === "return") {
      sold[pi]![si]![d]! += q;
      value[pi]![si]![d]! += v;
    }
    if (f.kind === "sale" || f.kind === "return" || f.kind === "free" || f.kind === "exchange") {
      used[pi]![si]![d]! += q;
      if (f.kind === "sale" && q > 0) usedAny[pi]![d] = 1;
    }
  }

  const stockRows = await db.query<Record<string, unknown>>("select zoho_item_id, zoho_location_id, qty from stock_levels");
  const stock: Record<string, Record<string, number | null>> = {};
  for (const p of products) {
    stock[p.id] = {};
    for (const l of locations) stock[p.id]![l.id] = l.readable ? 0 : null;
  }
  for (const s of stockRows) {
    const row = stock[String(s.zoho_item_id)];
    const loc = locations.find((l) => l.id === s.zoho_location_id);
    if (row && loc?.readable) row[loc.id] = num(s.qty);
  }

  // Stock-out days: a daily photo shows nothing at any readable location AND nothing sold that day.
  // Days with no photo (before the sync started) count as in stock, so they are never wrongly dropped.
  let inStock: Uint8Array[] | undefined;
  if (products.length) {
    const snaps = await db.query<{ day: string; item: string; qty: unknown }>(
      `select s.day::text as day, s.zoho_item_id as item, sum(s.qty) as qty
       from stock_snapshots s join locations l on l.zoho_location_id = s.zoho_location_id and l.readable and l.active
       where s.day >= $1::date and s.zoho_item_id in (select jsonb_array_elements_text($2::text::jsonb)) group by 1, 2`,
      [start, JSON.stringify(products.map((p) => p.id))],
    );
    if (snaps.length) {
      const byItem = new Map(products.map((p, i) => [p.id, i]));
      inStock = products.map(() => new Uint8Array(n).fill(1));
      for (const s of snaps) {
        const pi = byItem.get(s.item);
        const d = diffDays(s.day, start);
        if (pi === undefined || d < 0 || d >= n) continue;
        if (num(s.qty) <= 0 && !usedAny[pi]![d]) inStock[pi]![d] = 0;
      }
    }
  }

  const poRows = await db.query<Record<string, unknown>>(
    "select zoho_po_id, zoho_item_id, qty_open, ordered_on::text as ordered_on, expected_on::text as expected_on from purchase_orders where qty_open > 0",
  );
  const purchaseOrders: PurchaseOrder[] = poRows
    .filter((r) => stock[String(r.zoho_item_id)])
    .map((r) => {
      const p = products.find((x) => x.id === String(r.zoho_item_id))!;
      return {
        id: `${r.zoho_po_id}:${r.zoho_item_id}`,
        productId: p.id,
        vendorId: p.vendorId,
        qty: num(r.qty_open),
        orderedOn: (r.ordered_on as string | null) ?? today,
        expectedOn: (r.expected_on as string | null) ?? addDays(today, defaultLead),
      };
    });
  const access = await db.query<Record<string, unknown>>("select area, ok, note from zoho_access order by area");
  const poAccess = access.find((a) => a.area === "Purchase orders");

  const channels: ChannelInfo[] = CHANNELS.map((c) => {
    const from = channelFirst[c.id] ?? null;
    return { ...c, connected: !!from, dataFrom: from, note: from ? undefined : c.id === "amazon" || c.id === "flipkart" ? NOT_CONNECTED_NOTE : "No sales recorded yet." };
  });

  const pushRows = await db.query<Record<string, unknown>>(
    "select location_name, failed, first_failed::text as first_failed, last_failed::text as last_failed, top_error from push_health order by failed desc",
  );
  const syncRows = await db.query<Record<string, unknown>>(
    "select distinct on (job) job, finished_at, ok, note from sync_runs where finished_at is not null order by job, started_at desc",
  );
  const health: DataHealth = {
    checkedAt: now.toISOString(),
    unmappedClinics: clinics.filter((c) => c.active && !c.zohoLocationId).map((c) => ({ clinicId: c.id, name: c.name, landsOn: primary.name })),
    unreadableLocations: locations.filter((l) => !l.readable).map((l) => ({ locationId: l.id, name: l.name })),
    failedPushes: pushRows.map((r) => ({
      locationName: String(r.location_name),
      failed: num(r.failed),
      firstFailed: (r.first_failed as string | null) ?? null,
      lastFailed: (r.last_failed as string | null) ?? null,
      topError: String(r.top_error ?? ""),
    })),
    zohoAccess: access.map((a) => ({ area: String(a.area), ok: Boolean(a.ok), note: String(a.note) })),
    leftOutProducts,
    zohoOnlyItems: zohoOnly?.n ?? 0,
    lastSync: Object.keys(JOB_LABELS).map((job) => {
      const r = syncRows.find((x) => x.job === job);
      return r
        ? { job: JOB_LABELS[job]!, at: iso(r.finished_at), ok: Boolean(r.ok), note: String(r.note ?? "") }
        : { job: JOB_LABELS[job]!, at: null, ok: false, note: "Has not run yet" };
    }),
    alerts: await (async () => {
      const cfg = alertConfig();
      return { email: !!cfg.email, whatsapp: !!cfg.whatsapp, missing: cfg.missing, repeatDays: cfg.repeatDays, log: await alertLog(db).catch(() => []) };
    })(),
  };

  const [lastStock] = await db.query<{ at: unknown }>("select max(read_at) as at from stock_levels");
  return {
    origin: "live",
    today,
    lastSyncedAt: iso(lastStock?.at) ?? iso(syncRows.find((r) => r.job === "zoho_stock")?.finished_at) ?? now.toISOString(),
    days,
    products,
    vendors,
    locations,
    clinics,
    channels,
    sources,
    sold,
    value,
    used,
    inStock,
    stock,
    purchaseOrders,
    purchaseOrdersAvailable: Boolean(poAccess?.ok),
    health,
    bottles: await readBottles(db, addDays(today, -30)),
  };
}

/**
 * Bottles and packaging (20 Nov 2026): Zoho items whose Stock field (cf_stock) is "Bottle Count". Their count at the
 * Mohali warehouse, anything found elsewhere (there should be none), and the last 30 daily Mohali counts.
 * undefined = not available yet (the catalog step has not stored the Stock field).
 */
async function readBottles(db: Db, since: string): Promise<BottleItem[] | undefined> {
  try {
    const rows = await db.query<Record<string, unknown>>(
      `select p.zoho_item_id as id, p.sku, p.name, p.unit,
         (select s.qty from stock_levels s join locations l using (zoho_location_id) where s.zoho_item_id = p.zoho_item_id and l.is_primary) as qty,
         coalesce((select sum(greatest(s.qty, 0)) from stock_levels s join locations l using (zoho_location_id)
                   where s.zoho_item_id = p.zoho_item_id and not l.is_primary), 0) as elsewhere,
         coalesce((select json_agg(json_build_object('day', ss.day::text, 'qty', ss.qty) order by ss.day)
                   from stock_snapshots ss join locations l using (zoho_location_id)
                   where ss.zoho_item_id = p.zoho_item_id and l.is_primary and ss.day >= $1::date), '[]'::json) as history
       from products p
       where p.in_zoho and p.active and lower(coalesce(p.stock_type, '')) like 'bottle%'
       order by p.name`,
      [since],
    );
    return rows.map((r) => {
      const h = typeof r.history === "string" ? JSON.parse(r.history) : r.history;
      return {
        id: String(r.id),
        sku: String(r.sku ?? ""),
        name: String(r.name),
        unit: (r.unit as string | null) ?? null,
        qty: r.qty === null || r.qty === undefined ? null : num(r.qty),
        elsewhere: num(r.elsewhere),
        history: (Array.isArray(h) ? h : []).map((x: { day: string; qty: unknown }) => ({ day: String(x.day).slice(0, 10), qty: num(x.qty) })),
      };
    });
  } catch (e) {
    if (/stock_type/.test(String(e))) return undefined; // the Stock field is stored by the next catalog step
    throw e;
  }
}
