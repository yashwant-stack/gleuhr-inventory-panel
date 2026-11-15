// End-to-end test of the backend on fakes: the panel's real migration in an in-memory Postgres
// (PGlite), a fake CRM database with the production table shapes, and a fake Zoho.
//   sync (Zoho + CRM) → panel database → buildDataset → wire JSON → the screens' engine.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeMetrics } from "../lib/data/engine";
import { decodeDataset, encodeDataset, type Dataset } from "../lib/data/model";
import { addDays, diffDays } from "../lib/dates";
import { DEFAULT_FORMULA_SETTINGS } from "../lib/domain/types";
import { plainZohoError } from "./crm";
import { buildDataset, NotReady } from "./dataset";
import { postgresDb, type Db } from "./db";
import { DAILY_JOBS, FREQUENT_JOBS, runSync, type JobResult, type SyncDeps } from "./sync";
import { rowStock, type ZohoConfig } from "./zoho";

const MIGRATION = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261115000001_panel_init.sql"), "utf8");
const NOW = new Date("2026-11-15T06:30:00Z"); // 12:00 IST, 15 Nov
const TODAY = "2026-11-15";

function wrap(pg: PGlite): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query(text, params)).rows as T[];
    },
    async exec(text: string) {
      await pg.exec(text);
    },
  };
}


// ── fake CRM database (production table shapes, only the columns the panel reads) ──
const CRM_SCHEMA = `
create type stock_reason as enum ('sale','online_sale','online_rto_in','online_cancel_in','online_pack_exception','online_pack_undo',
  'online_pack_cancel','complimentary','exchange_in','exchange_out','adjustment','online_rto_missing');
create type sync_state as enum ('pending','synced','failed');
create table public.clinics (id bigint primary key, name text not null, active boolean not null default true, zoho_location_id text);
create table public.retail_products (id bigint primary key, sku text, name text not null, zoho_item_id text, price numeric not null default 0,
  active boolean not null default true, created_at timestamptz not null default '2026-07-09T10:00:00+05:30');
create table public.stock_movements (id bigserial primary key, product_id bigint not null, clinic_id bigint not null, qty integer not null,
  reason stock_reason not null, online_order_id bigint, product_sale_id bigint, created_at timestamptz not null,
  sync_status sync_state not null default 'synced', sync_error text);
create table public.online_shopify_orders (id bigserial primary key, order_id bigint);
create table public.product_sale_lines (id bigserial primary key, product_sale_id bigint not null, product_id bigint not null, unit_price numeric not null, discount_pct numeric);
create table public.online_order_lines (id bigserial primary key, order_id bigint not null, product_id bigint not null, unit_price_hist numeric not null, disc_pct numeric);

insert into public.clinics values
  (1, 'Ludhiana', true, 'Z-LDH'),
  (5, 'Mumbai', true, 'Z-MUM'),
  (10, 'Delhi East', true, null),
  (13, 'Mohali warehouse', true, 'Z-MOH');
insert into public.retail_products (id, sku, name, zoho_item_id, price, active) values
  (101, 'HS-01', 'Hair Serum', 'I-SERUM', 999, true),
  (102, 'HS-OLD', 'Hair Serum (old code)', 'I-SERUM', 950, false),   -- the CRM forbids this (unique); the panel copes anyway
  (103, 'DC-01', 'Day Cream', 'I-CREAM', 850, true),
  (104, 'SP-1M', 'Skin Plan', 'I-PLAN', 4999, true),
  (105, null, 'Facial Kit', null, 1200, false),
  (106, null, 'Old Thing', null, 100, false),
  (107, 'GH-1', 'Ghost Product', 'I-GONE', 500, true);
update public.retail_products set created_at = '2026-11-02T20:00:00Z' where id = 103;  -- added 3 Nov 01:30 IST (still 2 Nov in UTC)

-- clinic sale at Ludhiana, 14 Nov: 2 × ₹1,000 less 10% = ₹1,800; plus 1 free sample
insert into public.product_sale_lines (product_sale_id, product_id, unit_price, discount_pct) values (9001, 101, 1000, 10), (9002, 103, 850, 0), (9003, 102, 950, 0), (9004, 103, 850, 0), (9005, 105, 1200, 0), (9006, 104, 4999, 0);
insert into public.stock_movements (product_id, clinic_id, qty, reason, product_sale_id, created_at) values
  (101, 1, -2, 'sale', 9001, '2026-11-14T11:00:00+05:30'),
  (101, 1, -1, 'complimentary', null, '2026-11-14T12:00:00+05:30'),
  (103, 10, -1, 'sale', 9002, '2026-11-12T15:00:00+05:30'),          -- Delhi East: not linked to Zoho
  (102, 1, -1, 'sale', 9003, '2026-11-10T10:00:00+05:30'),          -- old code of the serum: adds to the serum
  (103, 1, -1, 'sale', 9004, '2026-11-14T20:00:00Z'),               -- 15 Nov 01:30 IST: an IST day, not a UTC day
  (105, 1, -3, 'sale', 9005, '2026-10-01T10:00:00+05:30'),          -- no Zoho item: left out
  (104, 1, -2, 'sale', 9006, '2026-11-01T10:00:00+05:30'),          -- Zoho does not track it: left out
  (101, 13, 50, 'adjustment', null, '2026-11-11T09:00:00+05:30');   -- stock received: not a sale
-- online team order (Mohali dispatch) 13 Nov, returned (RTO) 14 Nov; a Shopify website order 13 Nov
insert into public.online_order_lines (order_id, product_id, unit_price_hist, disc_pct) values (7001, 101, 1000, 0), (7002, 103, 850, 0);
insert into public.online_shopify_orders (order_id) values (7002);
insert into public.stock_movements (product_id, clinic_id, qty, reason, online_order_id, created_at) values
  (101, 13, -3, 'online_sale', 7001, '2026-11-13T16:00:00+05:30'),
  (101, 13, 1, 'online_rto_in', 7001, '2026-11-14T16:00:00+05:30'),
  (103, 13, -1, 'online_sale', 7002, '2026-11-13T17:00:00+05:30');
-- Mumbai sales Zoho refused (no access to the location)
insert into public.stock_movements (product_id, clinic_id, qty, reason, created_at, sync_status, sync_error) values
  (101, 5, -1, 'sale', '2026-11-05T10:00:00+05:30', 'failed', '{"code":400040,"message":"You do not have access to the location"}'),
  (101, 5, -1, 'sale', '2026-11-09T10:00:00+05:30', 'failed', '{"code":400040,"message":"You do not have access to the location"}'),
  (103, 5, -1, 'sale', '2026-11-14T10:00:00+05:30', 'failed', '{"code":400040,"message":"You do not have access to the location"}');
`;

// ── two drivers: PGlite always; real Postgres through postgres.js (production's driver) when
// PG_TEST_URL is set, e.g. PG_TEST_URL=postgres://user@127.0.0.1:5432/postgres npm test ──
interface Driver {
  name: string;
  /** A fresh database with SQL already run in it. */
  fresh(sql: string): Promise<{ db: Db; exec: (sql: string) => Promise<void> }>;
}

const opened: { close(): Promise<void> }[] = [];
const created: string[] = [];

const PGLITE: Driver = {
  name: "PGlite",
  async fresh(sql) {
    const pg = new PGlite();
    await pg.exec(sql);
    return { db: wrap(pg), exec: async (x) => void (await pg.exec(x)) };
  },
};

const PG_TEST_URL = process.env.PG_TEST_URL;
const admin = PG_TEST_URL ? postgresDb(PG_TEST_URL) : null;
const POSTGRES_JS: Driver = {
  name: "Postgres (postgres.js)",
  async fresh(sql) {
    const name = `panel_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await admin!.exec(`create database ${name}`);
    created.push(name);
    const url = new URL(PG_TEST_URL!);
    url.pathname = `/${name}`;
    const db = postgresDb(url.toString());
    opened.push(db);
    await db.exec(sql);
    return { db, exec: (x) => db.exec(x) };
  },
};

afterAll(async () => {
  for (const c of opened.splice(0)) await c.close();
  for (const name of created.splice(0)) await admin!.exec(`drop database if exists ${name}`);
  await admin?.close();
});

const DRIVERS: Driver[] = admin ? [PGLITE, POSTGRES_JS] : [PGLITE];

// ── fake Zoho ──
const CFG: ZohoConfig = { apiBase: "https://zoho.test", accountsBase: "https://accounts.test", orgId: "ORG1", clientId: "c", clientSecret: "s", refreshToken: "r" };

const ITEMS = [
  { item_id: "I-SERUM", name: "Hair Serum", sku: "HS-01", rate: 999, purchase_rate: 300, vendor_name: "Acme Labs", category_name: "Hair", status: "active", track_inventory: true },
  { item_id: "I-CREAM", name: "Day Cream", sku: "DC-01", rate: 799, purchase_rate: 10, category_name: "Skin", status: "active", track_inventory: true },
  { item_id: "I-PLAN", name: "Skin Plan", sku: "SP-1M", rate: 4999, status: "active", track_inventory: false },
  { item_id: "I-COMBO", name: "Amazon Combo", sku: "AC-1", rate: 1499, status: "active", track_inventory: true },
  { item_id: "I-RETIRED", name: "Retired Item", sku: "RT-1", rate: 99, status: "inactive", track_inventory: true },
];
const STOCK: Record<string, Record<string, number>> = {
  "Z-MOH": { "I-SERUM": 110, "I-CREAM": 0, "I-COMBO": 40 },
  "Z-LDH": { "I-SERUM": 40, "I-CREAM": 12 },
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeZoho(opts: { rateLimitAt?: number } = {}) {
  const calls: string[] = [];
  let mints = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/oauth/v2/token") {
      mints++;
      return json({ access_token: `tok-${mints}`, expires_in: 3600 });
    }
    const auth = new Headers(init?.headers).get("authorization");
    if (!auth?.startsWith("Zoho-oauthtoken tok-") || url.searchParams.get("organization_id") !== "ORG1") return json({ code: 14, message: "bad auth" }, 401);
    const p = url.pathname.replace("/inventory/v1/", "");
    const loc = url.searchParams.get("location_id");
    calls.push(loc ? `${p}@${loc}` : p);
    if (opts.rateLimitAt !== undefined && calls.length >= opts.rateLimitAt) return json({ code: 44, message: "Too many requests" }, 429, { "retry-after": "30" });
    const page = Number(url.searchParams.get("page") ?? 1);
    if (p === "locations")
      return json({
        code: 0,
        locations: [
          { location_id: "Z-LDH", location_name: "Ludhiana", status: "active" },
          { location_id: "Z-MOH", location_name: "Mohali - Warehouse", is_primary: true, status: "active" },
          { location_id: "Z-MUM", location_name: "Mumbai", status: "active" },
        ],
      });
    if (p === "items" && !loc) return json({ code: 0, items: page === 1 ? ITEMS.slice(0, 3) : ITEMS.slice(3), page_context: { has_more_page: page === 1 } });
    if (p === "items" && loc === "Z-MUM") return json({ code: 400040, message: "You do not have permission to access this location" }, 400);
    if (p === "items" && loc) return json({ code: 0, items: ITEMS.map((i) => ({ ...i, stock_on_hand: STOCK[loc]?.[i.item_id] ?? 0 })), page_context: { has_more_page: false } });
    if (p === "salesorders" || p === "invoices" || p === "transferorders") return json({ code: 57, message: "You are not authorized to perform this operation" }, 401);
    if (p === "purchaseorders") return json({ code: 0, purchaseorders: [{ purchaseorder_id: "PO-1", status: "open" }], page_context: { has_more_page: false } });
    if (p === "purchaseorders/PO-1")
      return json({
        code: 0,
        purchaseorder: {
          vendor_name: "Acme Labs",
          date: "2026-11-10",
          delivery_date: "2026-11-20",
          status: "open",
          line_items: [
            { item_id: "I-SERUM", quantity: 200, quantity_received: 50 },
            { item_id: "I-CREAM", quantity: 30, quantity_received: 30 },
          ],
        },
      });
    return json({ code: 5, message: `unknown path ${p}` }, 404);
  };
  return { fetchFn: fetchFn as typeof fetch, calls, mints: () => mints };
}

/** A clock that only moves when the panel waits for the next minute. */
function handClock(start = NOW) {
  let t = start.getTime();
  const waits: number[] = [];
  return { clock: () => new Date(t), sleep: async (ms: number) => void (waits.push(ms), (t += ms)), waits, advance: (ms: number) => void (t += ms) };
}

const byJob = (rs: JobResult[], job: string) => rs.find((r) => r.job === job)!;

async function fullSync(panel: Db, crm: Db, extra: Partial<SyncDeps> = {}) {
  const z = fakeZoho();
  const c = handClock();
  const results = await runSync([...FREQUENT_JOBS, ...DAILY_JOBS], { panel, crm, zohoCfg: CFG, fetchFn: z.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep, ...extra });
  return { results, z, c };
}

const day = (ds: Dataset, iso: string) => diffDays(iso, ds.days[0]!);
const pi = (ds: Dataset, id: string) => ds.products.findIndex((p) => p.id === id);
const si = (ds: Dataset, id: string) => ds.sources.findIndex((s) => s.id === id);

describe.each(DRIVERS)("sync → dataset on $name (fake Zoho, fake CRM, the real panel migration)", (driver) => {
  const panelDb = async () => (await driver.fresh(MIGRATION)).db;
  const crmDb = () => driver.fresh(CRM_SCHEMA);

  it("builds the panel's data: sales by channel from the CRM, stock by Zoho location", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    const { results, z } = await fullSync(panel, crm);
    for (const r of results) expect(r, r.job).toMatchObject({ ok: true });
    expect(z.mints()).toBe(1); // one token for the whole run
    // a full run: 1 location list + 2 item pages + 3 locations + 4 access checks + PO list + 1 PO
    expect(z.calls.length).toBe(12);
    expect(byJob(results, "zoho_stock").note).toContain("refused: Mumbai");

    const ds = await buildDataset(panel, NOW);
    expect(ds.origin).toBe("live");
    expect(ds.today).toBe(TODAY);
    expect(ds.days).toHaveLength(180);
    expect(ds.days.at(-1)).toBe(TODAY);

    // locations: the primary first; a refused location is unreadable (stock unknown, never 0)
    expect(ds.locations.map((l) => [l.id, l.isPrimary, l.readable])).toEqual([
      ["Z-MOH", true, true],
      ["Z-LDH", false, true],
      ["Z-MUM", false, false],
    ]);

    // products: Zoho items a CRM sells and Zoho tracks
    expect(ds.products.map((p) => p.id)).toEqual(["I-CREAM", "I-SERUM"]);
    const serum = ds.products[pi(ds, "I-SERUM")]!;
    const cream = ds.products[pi(ds, "I-CREAM")]!;
    // history: from the day the product was added to the CRM (the serum on 9 Jul; the cream on 3 Nov IST),
    // not from its first sale (12 Nov for the cream)
    expect(ds.days[0]).toBe("2026-05-20");
    expect(serum).toMatchObject({ name: "Hair Serum", price: 999, cost: 300, category: "Hair", packSize: 1, launchedOn: "2026-07-09" });
    expect(cream).toMatchObject({ price: 850, cost: 255, launchedOn: "2026-11-03" }); // ₹10 purchase price is a placeholder → 30% of price
    expect(ds.vendors.map((v) => v.name).sort()).toEqual(["Acme Labs", "Vendor not set in Zoho"]);

    expect(ds.stock["I-SERUM"]).toEqual({ "Z-MOH": 110, "Z-LDH": 40, "Z-MUM": null });
    expect(ds.stock["I-CREAM"]).toEqual({ "Z-MOH": 0, "Z-LDH": 12, "Z-MUM": null });

    // sources: channel × clinic, placed on the Zoho location the stock comes out of
    const src = Object.fromEntries(ds.sources.map((s) => [s.id, s]));
    expect(src["clinic:1"]).toMatchObject({ channel: "clinic", locationId: "Z-LDH", clinicId: "1", label: "Ludhiana" });
    expect(src["clinic:10"]).toMatchObject({ channel: "clinic", locationId: "Z-MOH", clinicId: "10", label: "Delhi East (booked on Mohali - Warehouse)" });
    expect(src["clinic:5"]).toMatchObject({ locationId: "Z-MUM" });
    expect(src["online_team:13"]).toMatchObject({ channel: "online_team", locationId: "Z-MOH", clinicId: null, label: "Online team · Mohali - Warehouse dispatch" });
    expect(src["website:13"]).toMatchObject({ channel: "website", locationId: "Z-MOH" });
    expect(src["clinic:13"]).toBeUndefined(); // stock received at the warehouse does not make it a sales point
    expect(ds.sources).toHaveLength(5);

    const S = pi(ds, "I-SERUM");
    const C = pi(ds, "I-CREAM");
    const sold = (p: number, s: string, d: string) => ds.sold[p]![si(ds, s)]![day(ds, d)];
    const used = (p: number, s: string, d: string) => ds.used[p]![si(ds, s)]![day(ds, d)];
    const value = (p: number, s: string, d: string) => ds.value[p]![si(ds, s)]![day(ds, d)];
    expect(sold(S, "clinic:1", "2026-11-14")).toBe(2);
    expect(used(S, "clinic:1", "2026-11-14")).toBe(3); // + the free sample
    expect(value(S, "clinic:1", "2026-11-14")).toBeCloseTo(1800);
    expect(sold(S, "clinic:1", "2026-11-10")).toBe(1); // the serum's old CRM code adds to the same Zoho item
    expect(sold(S, "online_team:13", "2026-11-13")).toBe(3);
    expect(value(S, "online_team:13", "2026-11-13")).toBeCloseTo(3000);
    expect(sold(S, "online_team:13", "2026-11-14")).toBe(-1); // the RTO comes back
    expect(value(S, "online_team:13", "2026-11-14")).toBeCloseTo(-1000);
    expect(sold(C, "website:13", "2026-11-13")).toBe(1);
    expect(sold(C, "clinic:1", "2026-11-15")).toBe(1); // 01:30 IST on 15 Nov
    expect(sold(C, "clinic:1", "2026-11-14")).toBe(0);
    expect(used(S, "online_team:13", "2026-11-11")).toBe(0); // stock received is not usage
    const totalSerum = ds.sold[S]!.reduce((a, arr) => a + arr.reduce((x, y) => x + y, 0), 0);
    expect(totalSerum).toBe(2 + 1 + 3 - 1 + 2); // + 2 Mumbai sales Zoho refused (still real sales)

    // channels
    const ch = Object.fromEntries(ds.channels.map((c) => [c.id, c]));
    expect(ch.clinic).toMatchObject({ connected: true, dataFrom: "2026-10-01" }); // any product's sale counts, the left-out Facial Kit included
    expect(ch.online_team).toMatchObject({ connected: true, dataFrom: "2026-11-13" });
    expect(ch.website).toMatchObject({ connected: true, dataFrom: "2026-11-13" });
    expect(ch.amazon?.connected).toBe(false);
    expect(ch.flipkart?.note).toMatch(/Tell us how these orders are recorded/);

    // stock on the way: only the open part of the PO line
    expect(ds.purchaseOrdersAvailable).toBe(true);
    expect(ds.purchaseOrders).toEqual([{ id: "PO-1:I-SERUM", productId: "I-SERUM", vendorId: "acme-labs", qty: 150, orderedOn: "2026-11-10", expectedOn: "2026-11-20" }]);

    // data health
    const h = ds.health;
    expect(h.unmappedClinics).toEqual([{ clinicId: "10", name: "Delhi East", landsOn: "Mohali - Warehouse" }]);
    expect(h.unreadableLocations).toEqual([{ locationId: "Z-MUM", name: "Mumbai" }]);
    expect(h.failedPushes).toEqual([{ locationName: "Mumbai", failed: 3, firstFailed: "2026-11-05", lastFailed: "2026-11-14", topError: "No access to this Zoho location" }]);
    const access = Object.fromEntries(h.zohoAccess.map((a) => [a.area, a]));
    expect(access["Sales orders"]).toMatchObject({ ok: false, note: "Not authorized" });
    expect(access["Purchase orders"]).toMatchObject({ ok: true });
    expect(access["Stock per location"]).toMatchObject({ ok: false, note: "2 of 3 locations" });
    expect(h.leftOutProducts).toEqual([
      { name: "Facial Kit", reason: "No Zoho item linked in the CRM", unitsSold90d: 3, lastSale: "2026-10-01" },
      { name: "Skin Plan", reason: "Zoho does not track stock for its item", unitsSold90d: 2, lastSale: "2026-11-01" },
      { name: "Ghost Product", reason: "Linked to a Zoho item that Zoho doesn’t have", unitsSold90d: 0, lastSale: null },
    ]);
    expect(h.zohoOnlyItems).toBe(1); // Amazon Combo (the retired item is inactive)
    expect(h.lastSync).toHaveLength(6);
    expect(h.lastSync.every((s) => s.ok && s.at)).toBe(true);
    expect(h.lastSync.map((s) => s.job)).toContain("CRM sales");

    // through the wire and into the screens' engine
    const back = decodeDataset(JSON.parse(JSON.stringify(encodeDataset(ds))));
    expect(back.sold[S]![si(ds, "clinic:1")]).toEqual(ds.sold[S]![si(ds, "clinic:1")]);
    expect(back.stock).toEqual(ds.stock);
    const m = computeMetrics(back, DEFAULT_FORMULA_SETTINGS);
    const ms = m[S]!;
    expect(ms.stock).toBe(150); // Mohali 110 + Ludhiana 40; Mumbai unknown, not 0
    expect(ms.unknownLocations).toEqual(["Z-MUM"]);
    expect(ms.onOrder).toBe(150);
    expect(ms.rate).toBeGreaterThan(0);
    expect(m[C]!.stock).toBe(12);
  });

  it("leaves stock-out days out of the rate, but only when nothing sold that day", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    await fullSync(panel, crm);
    // earlier days' photos: the serum had none anywhere readable on 12 and 13 Nov (Mumbai is not readable, so it does not count)
    await panel.exec(`insert into stock_snapshots values
      ('2026-11-12','I-SERUM','Z-MOH',0), ('2026-11-12','I-SERUM','Z-LDH',0), ('2026-11-12','I-SERUM','Z-MUM',5),
      ('2026-11-13','I-SERUM','Z-MOH',0), ('2026-11-13','I-SERUM','Z-LDH',0)`);
    const ds = await buildDataset(panel, NOW);
    const S = pi(ds, "I-SERUM");
    expect(ds.inStock?.[S]?.[day(ds, "2026-11-12")]).toBe(0); // nothing anywhere, nothing sold
    expect(ds.inStock?.[S]?.[day(ds, "2026-11-13")]).toBe(1); // 3 sold online that day: it was in stock
    expect(ds.inStock?.[S]?.[day(ds, "2026-11-01")]).toBe(1); // no photo that day: never dropped
    expect(ds.inStock?.[S]?.[day(ds, TODAY)]).toBe(1);
  });

  it("paces Zoho calls to the panel's per-minute ceiling instead of failing", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    await panel.exec(`update settings set value = '3' where key = 'zoho.max_calls_per_minute'`);
    const { results, c } = await fullSync(panel, crm);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(c.waits.length).toBe(3); // 12 calls at 3 a minute: waited for 3 new minutes
    const minutes = await panel.query<{ calls: number }>("select calls from zoho_calls");
    expect(Math.max(...minutes.map((r) => r.calls))).toBeLessThanOrEqual(3);
    await expect(buildDataset(panel, NOW)).resolves.toBeTruthy();
  });

  it("stops at the daily allowance, keeps what it read, and reads the stalest locations first next time", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    await panel.exec(`update settings set value = '4' where key = 'zoho.max_calls_per_day'`);
    const z = fakeZoho();
    const c = handClock();
    const results = await runSync([...FREQUENT_JOBS, ...DAILY_JOBS], { panel, crm, zohoCfg: CFG, fetchFn: z.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep });
    const stock = byJob(results, "zoho_stock");
    expect(stock.ok).toBe(true);
    expect(stock.note).toMatch(/1 locations read; 2 left for the next run \(the panel's daily Zoho allowance \(4 calls\) is used up\)/);
    expect(byJob(results, "zoho_access")).toMatchObject({ ok: false, skipped: true });
    expect(byJob(results, "crm_flows").ok).toBe(true); // the CRM jobs do not depend on Zoho's allowance
    // Not every location was tried: the panel refuses to show a half-read stock picture.
    await expect(buildDataset(panel, NOW)).rejects.toBeInstanceOf(NotReady);

    // Next day, with a normal allowance: Ludhiana and Mumbai (never tried) go before Mohali.
    await panel.exec(`update settings set value = '600' where key = 'zoho.max_calls_per_day'`);
    const next = new Date(NOW.getTime() + 86_400_000);
    const z2 = fakeZoho();
    const c2 = handClock(next);
    await runSync(["zoho_stock"], { panel, crm, zohoCfg: CFG, fetchFn: z2.fetchFn, now: next, clock: c2.clock, sleep: c2.sleep });
    expect(z2.calls.slice(0, 3)).toEqual(["items@Z-LDH", "items@Z-MUM", "items@Z-MOH"]);
    await expect(buildDataset(panel, next)).resolves.toBeTruthy();

    // Two hours later: a location Zoho refused is tried again only after 24 hours (each try costs a call).
    const z3 = fakeZoho();
    const later = new Date(next.getTime() + 2 * 3_600_000);
    const r3 = await runSync(["zoho_stock"], { panel, crm, zohoCfg: CFG, fetchFn: z3.fetchFn, now: later, clock: () => later, sleep: c2.sleep });
    expect(z3.calls).toEqual(["items@Z-MOH", "items@Z-LDH"]);
    expect(r3[0]!.note).toContain("1 refused earlier, tried again tomorrow");
  });

  it("stops every Zoho job when Zoho answers 429, and runs out of time cleanly", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    const z = fakeZoho({ rateLimitAt: 2 });
    const c = handClock();
    const results = await runSync(FREQUENT_JOBS, { panel, crm, zohoCfg: CFG, fetchFn: z.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep });
    expect(byJob(results, "zoho_catalog")).toMatchObject({ ok: false });
    expect(byJob(results, "zoho_catalog").note).toMatch(/429/);
    expect(byJob(results, "zoho_stock")).toMatchObject({ ok: false, skipped: true });
    expect(byJob(results, "crm_flows").ok).toBe(true);
    expect(z.calls.length).toBe(2); // nothing after the 429
    const [logged] = await panel.query<{ ok: boolean; note: string }>("select ok, note from sync_runs where job = 'zoho_catalog'");
    expect(logged).toMatchObject({ ok: false });

    // A run whose time is up before the next minute frees up: no call starts after the deadline.
    const panel2 = await panelDb();
    await panel2.exec(`update settings set value = '2' where key = 'zoho.max_calls_per_minute'`);
    const z2 = fakeZoho();
    const c2 = handClock();
    const r2 = await runSync(["zoho_catalog", "zoho_stock"], {
      panel: panel2,
      zohoCfg: CFG,
      fetchFn: z2.fetchFn,
      now: NOW,
      clock: c2.clock,
      sleep: c2.sleep,
      deadline: NOW.getTime() + 100_000,
    });
    expect(byJob(r2, "zoho_catalog").ok).toBe(true); // 3 calls: one wait of under a minute
    expect(byJob(r2, "zoho_stock").note).toMatch(/left for the next run \(this run's time is up/);
    expect(z2.calls.length).toBeLessThanOrEqual(6);
  });

  it("re-reads only the last 3 days after the first run, and drops what the CRM no longer has", async () => {
    const panel = await panelDb();
    const { db: crm, exec: crmExec } = await crmDb();
    await fullSync(panel, crm);
    const before = await buildDataset(panel, NOW);
    const S = pi(before, "I-SERUM");
    expect(before.used[S]![si(before, "clinic:1")]![day(before, "2026-11-14")]).toBe(3);

    // The free sample on 14 Nov is voided in the CRM; the 1 Oct sale is outside the re-read window.
    await crmExec(`delete from public.stock_movements where reason = 'complimentary'; delete from public.stock_movements where product_id = 105`);
    const r = await runSync(["crm_flows"], { panel, crm, now: NOW });
    expect(r[0]!.note).toBe(`refreshed ${addDays(TODAY, -2)} → ${TODAY}`);
    const after = await buildDataset(panel, NOW);
    expect(after.used[S]![si(after, "clinic:1")]![day(after, "2026-11-14")]).toBe(2);
    expect(after.health.leftOutProducts.find((p) => p.name === "Facial Kit")?.unitsSold90d).toBe(3); // older days are kept
  });

  it("skips jobs whose connection is not configured, and says so", async () => {
    const panel = await panelDb();
    const results = await runSync(FREQUENT_JOBS, { panel, now: NOW });
    expect(results.every((r) => r.skipped && !r.ok)).toBe(true);
    expect(byJob(results, "zoho_stock").note).toBe("Zoho is not configured");
    expect(byJob(results, "crm_flows").note).toBe("The CRM connection is not configured");
    await expect(buildDataset(panel, NOW)).rejects.toBeInstanceOf(NotReady);
  });
});

describe("Zoho helpers", () => {
  it("reads stock on hand, else available stock; blank is unknown, not 0", () => {
    expect(rowStock({ item_id: "a", name: "a", stock_on_hand: 5, available_stock: 3 })).toBe(5);
    expect(rowStock({ item_id: "a", name: "a", available_stock: "7" })).toBe(7);
    expect(rowStock({ item_id: "a", name: "a", stock_on_hand: "" })).toBeNull();
    expect(rowStock({ item_id: "a", name: "a" })).toBeNull();
  });

  it("turns Zoho's refusals into plain words", () => {
    expect(plainZohoError('{"code":400040,"message":"You do not have access to the location"}')).toBe("No access to this Zoho location");
    expect(plainZohoError('{"code":57,"message":"You are not authorized to perform this operation"}')).toBe("Zoho: not authorized (code 57)");
    expect(plainZohoError("code 9205: not sufficient stock")).toBe("Zoho: not enough stock (negative stock blocked)");
    expect(plainZohoError("")).toBe("Unknown");
  });
});
