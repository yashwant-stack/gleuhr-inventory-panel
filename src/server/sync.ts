import "server-only";
// The sync: copies what the panel needs from Zoho (stock per location) and the CRM database
// (sales per channel) into the panel's own database. Every job writes one row to sync_runs
// (when, ok, rows written, Zoho calls made, a plain note), which the Data health page shows.
import { addDays, diffDays } from "../lib/dates";
import { parseSegment } from "../lib/domain/types";
import { type Db, num } from "./db";
import type { CrmSource } from "./crm";
import {
  listAll,
  locationKind,
  rowStock,
  zohoClient,
  ZohoBudgetExceeded,
  ZohoRateLimited,
  zohoNotConfiguredNote,
  type ZohoClient,
  type ZohoConfig,
  type ZohoItemRow,
  type ZohoLocation,
} from "./zoho";

export type JobName = "crm_reference" | "zoho_catalog" | "zoho_stock" | "crm_flows" | "crm_health" | "zoho_access";

/** The full sync runs once a day at 9:00 AM IST (vercel.json) or by hand ("Sync from Zoho now"), with zoho_access. */
// Order matters (20 Nov 2026): the CRM steps make no Zoho calls and are quick, so they run first; Zoho stock runs
// last, inside the run's time budget, and a location not reached is read by the catch-up (REST_JOBS).
export const FREQUENT_JOBS: JobName[] = ["zoho_catalog", "crm_reference", "crm_flows", "crm_health", "zoho_stock"];
export const DAILY_JOBS: JobName[] = ["zoho_access"];
/** The catch-up after a full sync: stock at the locations it did not reach (deps.stockSince), then the access check. */
export const REST_JOBS: JobName[] = ["zoho_stock", "zoho_access"];

/** The catch-up's jobs: stock always (it only reads what is missing), the access check unless it already passed today. */
export async function restJobs(panel: Db, now = new Date()): Promise<JobName[]> {
  const [done] = await panel.query<{ n: number }>(
    "select count(*)::int as n from sync_runs where job = 'zoho_access' and ok and finished_at >= ($1::date::timestamp - interval '5 hours 30 minutes')",
    [istToday(now)],
  );
  return (done?.n ?? 0) > 0 ? ["zoho_stock"] : REST_JOBS;
}

/** true when a run ran out of time before reading every location, or before the access check. */
export function runLeftWork(results: JobResult[]): boolean {
  return results.some((r) => (r.job === "zoho_stock" && /left for the next run/.test(r.note)) || (r.job === "zoho_access" && r.skipped && /time is up/.test(r.note)));
}

const NEEDS: Record<JobName, { zoho?: boolean; crm?: boolean }> = {
  crm_reference: { crm: true },
  zoho_catalog: { zoho: true },
  zoho_stock: { zoho: true },
  crm_flows: { crm: true },
  crm_health: { crm: true },
  zoho_access: { zoho: true },
};

export interface JobResult {
  job: JobName;
  ok: boolean;
  skipped?: boolean;
  rows: number;
  zohoCalls: number;
  note: string;
}

export interface SyncDeps {
  panel: Db;
  crm?: CrmSource | null;
  zohoCfg?: ZohoConfig | null;
  fetchFn?: typeof fetch;
  now?: Date;
  /** Zoho pacing (tests pass a hand-moved clock and an instant sleep). */
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** No Zoho call starts after this moment (epoch ms). */
  deadline?: number;
  /** Catch-up runs: stock is read only at locations not read since this moment. */
  stockSince?: Date;
}

interface JobOutput {
  rows: number;
  note: string;
  /** Set when the job stopped early on the Zoho allowance or the run's time: later Zoho jobs are skipped. */
  stop?: string;
}

export function istToday(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

async function settingText(db: Db, key: string, fallback: string): Promise<string> {
  const [r] = await db.query<{ value: unknown }>("select value from settings where key = $1", [key]);
  const v = r?.value;
  const s = typeof v === "string" ? (v.startsWith('"') ? JSON.parse(v) : v) : v;
  return typeof s === "string" && s.trim() ? s.trim() : fallback;
}

async function setting(db: Db, key: string, fallback: number): Promise<number> {
  const [r] = await db.query<{ value: unknown }>("select value from settings where key = $1", [key]);
  const v = r?.value;
  const n = num(typeof v === "string" ? JSON.parse(v) : v);
  return n > 0 ? n : fallback;
}

// ── jobs ──────────────────────────────────────────────────────────────────────

async function zohoCatalog(panel: Db, z: ZohoClient): Promise<JobOutput> {
  const loc = await z.get<{ locations?: ZohoLocation[] }>("locations");
  if (!loc.ok) throw new Error(`Zoho locations: ${loc.message}`);
  const locations = loc.data.locations ?? [];
  const anyPrimary = locations.some((l) => l.is_primary === true);
  const locRows = locations.map((l) => ({
    id: l.location_id,
    name: l.location_name,
    kind: locationKind(l.location_name),
    // Zoho does not always say which location is primary; the warehouse is (verified 14 Nov: a location-less adjustment landed there).
    primary: anyPrimary ? l.is_primary === true : locationKind(l.location_name) === "warehouse",
    active: l.status ? l.status !== "inactive" : true,
  }));
  await panel.query(
    `insert into locations (zoho_location_id, name, kind, is_primary, active, updated_at)
     select r.id, r.name, r.kind, r."primary", r.active, now() from jsonb_to_recordset($1::text::jsonb) as r(id text, name text, kind text, "primary" boolean, active boolean)
     on conflict (zoho_location_id) do update set name = excluded.name, kind = excluded.kind, is_primary = excluded.is_primary, active = excluded.active, updated_at = now()`,
    [JSON.stringify(locRows)],
  );
  const items = await listAll<ZohoItemRow>(z, "items", "items");
  if (!items.ok) throw new Error(`Zoho items: ${items.message}`);
  // Day Regime / Night Regime / Wellness (decided 20 Nov 2026): a custom field on each Zoho item. The item list
  // carries custom fields as cf_<api name>, and Zoho makes the api name from the label ("Segment" → cf_segment), so
  // no extra Zoho call is needed: the field named in setting "zoho.segment_field" (default "Type Regimen", the
  // field Gleuhr added in Zoho: cf_type_regimen), else any
  // cf_ key with "segment" or "regime" in it. Until the field exists, the item's category is read instead.
  await panel.exec("alter table products add column if not exists segment text");
  const wanted = "cf_" + (await settingText(panel, "zoho.segment_field", "Type Regimen")).toLowerCase().replace(/^cf_/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const cfKeys = [...new Set(items.data.flatMap((i) => Object.keys(i).filter((k) => k.startsWith("cf_"))))];
  const segField = cfKeys.includes(wanted) ? wanted : (cfKeys.find((k) => /segment|regime/i.test(k)) ?? null);
  const itemRows = items.data.map((i) => ({
    id: i.item_id,
    sku: i.sku || null,
    name: i.name,
    category: i.category_name || null,
    segment: parseSegment(segField ? i[segField] : null) ?? parseSegment(i.category_name),
    unit: i.unit || null,
    rate: i.rate === undefined || i.rate === "" ? null : num(i.rate),
    purchase: i.purchase_rate === undefined || i.purchase_rate === "" ? null : num(i.purchase_rate),
    reorder: i.reorder_level === undefined || i.reorder_level === "" ? null : num(i.reorder_level),
    vendor: i.vendor_name || null,
    active: i.status ? i.status !== "inactive" : true,
    track: i.track_inventory !== false,
  }));
  await panel.query(
    `insert into products (zoho_item_id, sku, name, category, segment, unit, sell_price, purchase_price, reorder_level, vendor_name, active, track_inventory, in_zoho, updated_at)
     select r.id, r.sku, r.name, r.category, r.segment, r.unit, r.rate, r.purchase, r.reorder, r.vendor, r.active, r.track, true, now()
     from jsonb_to_recordset($1::text::jsonb) as r(id text, sku text, name text, category text, segment text, unit text, rate numeric, purchase numeric, reorder numeric, vendor text, active boolean, track boolean)
     on conflict (zoho_item_id) do update set sku = excluded.sku, name = excluded.name, category = excluded.category, segment = excluded.segment, unit = excluded.unit,
       sell_price = excluded.sell_price, purchase_price = excluded.purchase_price, reorder_level = excluded.reorder_level,
       vendor_name = excluded.vendor_name, active = excluded.active, track_inventory = excluded.track_inventory, in_zoho = true, updated_at = now()`,
    [JSON.stringify(itemRows)],
  );
  // An item Zoho no longer lists stays in the table (its history matters) but is marked as gone.
  const gone = await panel.query<{ n: number }>(
    `with g as (update products set in_zoho = false, updated_at = now()
       where in_zoho and not (zoho_item_id = any (select jsonb_array_elements_text($1::text::jsonb))) returning 1)
     select count(*)::int as n from g`,
    [JSON.stringify(itemRows.map((i) => i.id))],
  );
  const goneN = gone[0]?.n ?? 0;
  const segN = itemRows.filter((i) => i.segment).length;
  return {
    rows: locRows.length + itemRows.length,
    note: `${locRows.length} locations, ${itemRows.length} items${goneN ? `; ${goneN} no longer in Zoho` : ""}; Type Regimen ${segField ? `(${segField}) filled in on ${segN} items` : "empty on every item so far"}`,
  };
}

async function zohoStock(panel: Db, z: ZohoClient, now: Date, since?: Date): Promise<JobOutput> {
  // Oldest first, so a run cut short by time never starves the same locations. A location Zoho
  // refused is tried again only once a day (each try costs a call). A catch-up run (`since`) reads only
  // the locations the full sync did not reach.
  const locs = await panel.query<{ zoho_location_id: string; name: string }>(
    `select zoho_location_id, name from locations
     where active and (readable or checked_at is null or checked_at < $1::timestamptz)
       and ($2::timestamptz is null or checked_at is null or checked_at < $2::timestamptz)
     order by checked_at asc nulls first, is_primary desc, name`,
    [new Date(now.getTime() - 24 * 3_600_000).toISOString(), since ? since.toISOString() : null],
  );
  const [{ total = 0 } = {}] = await panel.query<{ total: number }>("select count(*)::int as total from locations where active");
  if (!total) throw new Error("No locations yet: run zoho_catalog first");
  const readAt = now.toISOString();
  let rows = 0;
  let read = 0;
  let stop: string | undefined;
  const refused: string[] = [];
  for (const l of locs) {
    let r;
    try {
      r = await listAll<ZohoItemRow>(z, "items", "items", { location_id: l.zoho_location_id }, 5);
    } catch (e) {
      if (e instanceof ZohoBudgetExceeded || e instanceof ZohoRateLimited) {
        stop = e.message;
        break;
      }
      throw e;
    }
    if (!r.ok) {
      const permission = r.code === 400040 || /location permission|access to the location/i.test(r.message);
      if (!permission) throw new Error(`Zoho stock for ${l.name}: ${r.message}`);
      refused.push(l.name);
      await panel.query("update locations set readable = false, checked_at = $2::timestamptz, updated_at = now() where zoho_location_id = $1", [l.zoho_location_id, readAt]);
      await panel.query("delete from stock_levels where zoho_location_id = $1", [l.zoho_location_id]);
      continue;
    }
    const levels = r.data.map((i) => ({ item: i.item_id, qty: rowStock(i) })).filter((x) => x.qty !== null);
    await panel.query(
      `insert into stock_levels (zoho_item_id, zoho_location_id, qty, read_at)
       select r.item, $1, r.qty, $2::timestamptz from jsonb_to_recordset($3::text::jsonb) as r(item text, qty numeric)
       on conflict (zoho_item_id, zoho_location_id) do update set qty = excluded.qty, read_at = excluded.read_at`,
      [l.zoho_location_id, readAt, JSON.stringify(levels)],
    );
    await panel.query("delete from stock_levels where zoho_location_id = $1 and read_at < $2::timestamptz", [l.zoho_location_id, readAt]);
    await panel.query("update locations set readable = true, checked_at = $2::timestamptz, updated_at = now() where zoho_location_id = $1", [l.zoho_location_id, readAt]);
    rows += levels.length;
    read++;
  }
  // One photo per IST day (the latest read of the day wins).
  await panel.query(
    `insert into stock_snapshots (day, zoho_item_id, zoho_location_id, qty)
     select $1::date, zoho_item_id, zoho_location_id, qty from stock_levels
     on conflict (day, zoho_item_id, zoho_location_id) do update set qty = excluded.qty`,
    [istToday(now)],
  );
  // a catch-up run only sees the locations the full sync missed: "refused earlier" is the full sync's to say
  const skipped = since ? 0 : total - locs.length;
  const left = locs.length - read - refused.length;
  const parts = [since ? `catch-up: ${read} more location${read === 1 ? "" : "s"} read` : `${read} locations read`];
  if (refused.length) parts.push(`refused: ${refused.join(", ")}`);
  if (skipped) parts.push(`${skipped} refused earlier, tried again tomorrow`);
  if (left) parts.push(`${left} left for the next run (${stop})`);
  return { rows, note: parts.join("; "), stop };
}

async function zohoAccess(panel: Db, z: ZohoClient): Promise<JobOutput> {
  const checks: [string, string, string][] = [
    ["Sales orders", "salesorders", "salesorders"],
    ["Invoices", "invoices", "invoices"],
    ["Transfer orders", "transferorders", "transfer_orders"],
    ["Purchase orders", "purchaseorders", "purchaseorders"],
  ];
  const results: { area: string; ok: boolean; note: string }[] = [];
  let poOk = false;
  for (const [area, path] of checks) {
    const r = await z.get(path, { per_page: 1 });
    results.push({ area, ok: r.ok, note: r.ok ? "Readable" : r.code === 57 ? "Not authorized" : r.message });
    if (area === "Purchase orders") poOk = r.ok;
  }
  const [{ total = 0, readable = 0 } = {}] = await panel.query<{ total: number; readable: number }>(
    "select count(*)::int as total, count(*) filter (where readable)::int as readable from locations where active",
  );
  results.push({ area: "Stock per location", ok: readable === total && total > 0, note: `${readable} of ${total} locations` });
  await panel.query(
    `insert into zoho_access (area, ok, note, checked_at) select r.area, r.ok, r.note, now() from jsonb_to_recordset($1::text::jsonb) as r(area text, ok boolean, note text)
     on conflict (area) do update set ok = excluded.ok, note = excluded.note, checked_at = now()`,
    [JSON.stringify(results)],
  );
  let poLines = 0;
  if (poOk) {
    const list = await listAll<{ purchaseorder_id: string; status?: string }>(z, "purchaseorders", "purchaseorders", { filter_by: "Status.Open" }, 2);
    if (list.ok) {
      const lines: { po: string; item: string; vendor: string | null; qty: number; ordered: string | null; expected: string | null; status: string | null }[] = [];
      for (const po of list.data.slice(0, 25)) {
        const d = await z.get<{ purchaseorder?: { vendor_name?: string; date?: string; delivery_date?: string; status?: string; line_items?: { item_id: string; quantity: number; quantity_received?: number }[] } }>(
          `purchaseorders/${po.purchaseorder_id}`,
        );
        if (!d.ok || !d.data.purchaseorder) continue;
        const p = d.data.purchaseorder;
        for (const li of p.line_items ?? []) {
          const open = num(li.quantity) - num(li.quantity_received);
          if (open > 0) lines.push({ po: po.purchaseorder_id, item: li.item_id, vendor: p.vendor_name ?? null, qty: open, ordered: p.date ?? null, expected: p.delivery_date ?? null, status: p.status ?? null });
        }
      }
      await panel.query("delete from purchase_orders");
      await panel.query(
        `insert into purchase_orders (zoho_po_id, zoho_item_id, vendor_name, qty_open, ordered_on, expected_on, status)
         select r.po, r.item, r.vendor, r.qty, r.ordered::date, r.expected::date, r.status
         from jsonb_to_recordset($1::text::jsonb) as r(po text, item text, vendor text, qty numeric, ordered text, expected text, status text)
         on conflict (zoho_po_id, zoho_item_id) do update set qty_open = excluded.qty_open`,
        [JSON.stringify(lines)],
      );
      poLines = lines.length;
    }
  }
  return { rows: results.length + poLines, note: results.map((r) => `${r.area}: ${r.ok ? "ok" : r.note}`).join(" · ") };
}

async function crmReference(panel: Db, crm: CrmSource): Promise<JobOutput> {
  const clinics = await crm.clinics();
  await panel.query(
    `insert into crm_clinics (crm_clinic_id, name, active, zoho_location_id, updated_at)
     select r.id::bigint, r.name, r.active, r.loc, now() from jsonb_to_recordset($1::text::jsonb) as r(id text, name text, active boolean, loc text)
     on conflict (crm_clinic_id) do update set name = excluded.name, active = excluded.active, zoho_location_id = excluded.zoho_location_id, updated_at = now()`,
    [JSON.stringify(clinics.map((c) => ({ id: c.crm_clinic_id, name: c.name, active: c.active, loc: c.zoho_location_id })))],
  );
  const products = await crm.products();
  const rows = products.map((p) => ({
    id: p.crm_product_id,
    name: p.name,
    sku: p.sku,
    item: p.zoho_item_id?.trim() || null,
    price: p.price,
    active: p.active,
    created: p.created_on,
    cat: p.category,
  }));
  await panel.query(
    `insert into crm_products (crm_product_id, name, sku, zoho_item_id, price, active, created_on, category, updated_at)
     select r.id::bigint, r.name, r.sku, r.item, r.price, r.active, r.created::date, r.cat, now()
     from jsonb_to_recordset($1::text::jsonb) as r(id text, name text, sku text, item text, price numeric, active boolean, created text, cat text)
     on conflict (crm_product_id) do update set name = excluded.name, sku = excluded.sku, zoho_item_id = excluded.zoho_item_id,
       price = excluded.price, active = excluded.active, created_on = excluded.created_on, category = excluded.category, updated_at = now()`,
    [JSON.stringify(rows)],
  );
  await panel.query("delete from crm_products where not (crm_product_id = any (select (jsonb_array_elements_text($1::text::jsonb))::bigint))", [
    JSON.stringify(rows.map((r) => r.id)),
  ]);
  const unlinked = rows.filter((r) => !r.item).length;
  return {
    rows: clinics.length + rows.length,
    note: `${clinics.length} clinics, ${rows.length - unlinked} products linked to Zoho${unlinked ? `, ${unlinked} with no Zoho item (their sales are left out)` : ""}`,
  };
}

async function crmFlows(panel: Db, crm: CrmSource, now: Date): Promise<JobOutput> {
  const today = istToday(now);
  const historyDays = await setting(panel, "panel.history_days", 180);
  const [{ n = 0 } = {}] = await panel.query<{ n: number }>("select count(*)::int as n from daily_flows");
  const from = n === 0 ? addDays(today, -(historyDays - 1)) : addDays(today, -2); // first run: backfill; then the last 3 days
  let rows = 0;
  for (let start = from; start <= today; start = addDays(start, 15)) {
    const end = diffDays(today, start) < 15 ? addDays(today, 1) : addDays(start, 15);
    const flows = await crm.flows(`${start}T00:00:00+05:30`, `${end}T00:00:00+05:30`);
    await panel.query(
      `insert into daily_flows (day, crm_product_id, crm_clinic_id, channel, kind, qty, value, movements)
       select r.day::date, r.p::bigint, r.c::bigint, r.ch, r.k, r.q, r.v, r.m
       from jsonb_to_recordset($1::text::jsonb) as r(day text, p text, c text, ch text, k text, q numeric, v numeric, m int)
       on conflict (day, crm_product_id, crm_clinic_id, channel, kind) do update set qty = excluded.qty, value = excluded.value, movements = excluded.movements`,
      [JSON.stringify(flows.map((f) => ({ day: f.day, p: f.crm_product_id, c: f.crm_clinic_id, ch: f.channel, k: f.kind, q: f.qty, v: f.value, m: f.movements })))],
    );
    // A row that no longer exists in the CRM (e.g. a voided sale) disappears from the re-read days.
    await panel.query(
      `delete from daily_flows f where f.day >= $1::date and f.day < $2::date
       and not exists (select 1 from jsonb_to_recordset($3::text::jsonb) as r(day text, p text, c text, ch text, k text)
                       where r.day::date = f.day and r.p::bigint = f.crm_product_id and r.c::bigint = f.crm_clinic_id and r.ch = f.channel and r.k = f.kind)`,
      [start, end, JSON.stringify(flows.map((f) => ({ day: f.day, p: f.crm_product_id, c: f.crm_clinic_id, ch: f.channel, k: f.kind })))],
    );
    rows += flows.length;
  }
  return { rows, note: `${n === 0 ? "backfilled" : "refreshed"} ${from} → ${today}` };
}

async function crmHealth(panel: Db, crm: CrmSource, now: Date): Promise<JobOutput> {
  const rows = await crm.pushHealth(new Date(now.getTime() - 30 * 86_400_000).toISOString());
  await panel.query("delete from push_health");
  await panel.query(
    `insert into push_health (crm_clinic_id, location_name, failed, first_failed, last_failed, top_error, checked_at)
     select r.c::bigint, r.name, r.failed, r.first::date, r.last::date, r.err, now()
     from jsonb_to_recordset($1::text::jsonb) as r(c text, name text, failed int, first text, last text, err text)`,
    [JSON.stringify(rows.map((r) => ({ c: r.crm_clinic_id, name: r.location_name, failed: r.failed, first: r.first_failed, last: r.last_failed, err: r.top_error })))],
  );
  return { rows: rows.length, note: `${rows.reduce((a, r) => a + r.failed, 0)} stock changes refused by Zoho in 30 days` };
}

// ── orchestrator ──────────────────────────────────────────────────────────────

/** Thrown when another sync holds the lock (started under 15 minutes ago and not finished). */
export class SyncBusy extends Error {}

export async function runSync(jobs: JobName[], deps: SyncDeps): Promise<JobResult[]> {
  const [got] = await deps.panel.query<{ id: number }>(
    `insert into sync_lock (id, started_at) values (1, now())
     on conflict (id) do update set started_at = now() where sync_lock.started_at < now() - interval '15 minutes'
     returning id`,
  );
  if (!got) throw new SyncBusy("Another sync is running; this one was not started.");
  try {
    return await runJobs(jobs, deps);
  } finally {
    await deps.panel.query("delete from sync_lock where id = 1");
  }
}

async function runJobs(jobs: JobName[], deps: SyncDeps): Promise<JobResult[]> {
  const now = deps.now ?? new Date();
  const zoho = deps.zohoCfg
    ? zohoClient(deps.panel, deps.zohoCfg, { fetchFn: deps.fetchFn, clock: deps.clock, sleep: deps.sleep, deadline: deps.deadline })
    : null;
  const results: JobResult[] = [];
  let stopZoho: string | null = null;
  for (const job of jobs) {
    const need = NEEDS[job];
    if ((need.zoho && !zoho) || (need.crm && !deps.crm)) {
      const note = need.zoho && !zoho ? zohoNotConfiguredNote() : "The CRM connection is not configured";
      results.push({ job, ok: false, skipped: true, rows: 0, zohoCalls: 0, note });
      // Logged, so Data health shows it: a skip that leaves no trace looks like a sync that is merely late.
      await deps.panel.query("insert into sync_runs (job, finished_at, ok, note) values ($1, now(), false, $2)", [job, note]);
      continue;
    }
    if (need.zoho && stopZoho) {
      results.push({ job, ok: false, skipped: true, rows: 0, zohoCalls: 0, note: `Skipped: ${stopZoho}` });
      continue;
    }
    const [run] = await deps.panel.query<{ id: string }>("insert into sync_runs (job) values ($1) returning id::text as id", [job]);
    const before = zoho?.calls() ?? 0;
    try {
      const r =
        job === "zoho_catalog" ? await zohoCatalog(deps.panel, zoho!)
        : job === "zoho_stock" ? await zohoStock(deps.panel, zoho!, now, deps.stockSince)
        : job === "zoho_access" ? await zohoAccess(deps.panel, zoho!)
        : job === "crm_reference" ? await crmReference(deps.panel, deps.crm!)
        : job === "crm_flows" ? await crmFlows(deps.panel, deps.crm!, now)
        : await crmHealth(deps.panel, deps.crm!, now);
      const calls = (zoho?.calls() ?? 0) - before;
      if (r.stop) stopZoho = r.stop;
      await deps.panel.query("update sync_runs set finished_at = now(), ok = true, rows_written = $2, zoho_calls = $3, note = $4 where id = $1::bigint", [
        run!.id,
        r.rows,
        calls,
        r.note.slice(0, 500),
      ]);
      results.push({ job, ok: true, rows: r.rows, zohoCalls: calls, note: r.note });
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      if (e instanceof ZohoBudgetExceeded || e instanceof ZohoRateLimited) stopZoho = note;
      const calls = (zoho?.calls() ?? 0) - before;
      await deps.panel.query("update sync_runs set finished_at = now(), ok = false, zoho_calls = $2, note = $3 where id = $1::bigint", [run!.id, calls, note.slice(0, 500)]);
      results.push({ job, ok: false, rows: 0, zohoCalls: calls, note });
    }
  }
  return results;
}
