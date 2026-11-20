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
import { type CrmSource, plainZohoError, sqlCrm } from "./crm";
import { postgrestFetcher, restCrm, type RowFetcher } from "./crm-rest";
import { buildDataset, NotReady } from "./dataset";
import { postgresDb, type Db } from "./db";
import { DAILY_JOBS, FREQUENT_JOBS, restJobs, runLeftWork, runSync, SyncBusy, type JobResult, type SyncDeps } from "./sync";
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
// Its stories follow the CRMs' real behaviour (read from their code and checked on production, 16 Nov 2026):
// an "adjustment" is a clinic bill edited down or cancelled; offers and round-off sit on the bill / order total;
// an online order's total also holds the delivery charge, which is not product sales.
const CRM_SCHEMA = `
create type stock_move_reason as enum ('sale','online_sale','online_rto_in','online_cancel_in','online_pack_exception','online_pack_undo',
  'online_pack_cancel','complimentary','exchange_in','exchange_out','adjustment','online_rto_missing','online_rto_damaged');
create type sync_state as enum ('pending','synced','failed');
create type online_disc_mode as enum ('auto','custom','none');
create type online_offer_type as enum ('pct','bogo','tiered');
create type online_bogo_type as enum ('b1g1','b2g1');
create table public.clinics (id bigint primary key, name text not null, active boolean not null default true, zoho_location_id text);
create table public.retail_products (id bigint primary key, sku text, name text not null, zoho_item_id text, price numeric not null default 0,
  active boolean not null default true, created_at timestamptz not null default '2026-07-09T10:00:00+05:30');
create table public.stock_movements (id bigserial primary key, product_id bigint not null, clinic_id bigint not null, qty integer not null,
  reason stock_move_reason not null, online_order_id bigint, product_sale_id bigint, created_at timestamptz not null,
  sync_status sync_state not null default 'synced', sync_error text);
create table public.online_shopify_orders (id bigserial primary key, order_id bigint);
create table public.product_sales (id bigint primary key, clinic_id bigint not null, total_amount numeric not null,
  complimentary boolean not null default false, voided_at timestamptz);
create table public.product_sale_lines (id bigserial primary key, product_sale_id bigint not null, product_id bigint not null,
  qty int not null default 1, unit_price numeric not null, discount_pct numeric not null default 0);
create table public.online_orders (id bigint primary key, disc_mode online_disc_mode not null default 'none', round_off numeric not null default 0, amount numeric);
create table public.online_offers (id bigint primary key, type online_offer_type not null, bogo_type online_bogo_type, paid_pct numeric);
create table public.online_product_meta (product_id bigint primary key, category text);
insert into public.online_product_meta values (101, 'Serums'), (103, 'Creams & Moisturizers');
create table public.online_order_lines (id bigserial primary key, order_id bigint not null, product_id bigint not null, qty int not null default 1,
  unit_price_hist numeric, disc_pct numeric not null default 0, offer_id bigint);

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

-- clinic bills (total_amount = what the bill really charges, GST included)
insert into public.product_sales (id, clinic_id, total_amount, complimentary, voided_at) values
  (9001, 1, 1800, false, null),   -- 2 serums at ₹1,000 less 10%
  (9002, 10, 850, false, null),
  (9003, 1, 950, false, null),
  (9004, 1, 850, false, null),
  (9005, 1, 3600, false, null),
  (9006, 1, 9998, false, null),
  (9007, 1, 850, false, '2026-11-14T11:00:00+05:30'),  -- cancelled the next day: its stock came back
  (9008, 1, 2000, false, null),   -- 3 serums, edited down to 2
  (9009, 1, 0, true, null),       -- a free bill: 2 creams, edited down to 1
  (9010, 1, 1500, false, null);   -- a whole-bill offer: 2 serums at ₹1,000 (lines) for ₹1,500
insert into public.product_sale_lines (product_sale_id, product_id, qty, unit_price, discount_pct) values
  (9001, 101, 2, 1000, 10), (9002, 103, 1, 850, 0), (9003, 102, 1, 950, 0), (9004, 103, 1, 850, 0), (9005, 105, 3, 1200, 0),
  (9006, 104, 2, 4999, 0), (9007, 103, 1, 850, 0), (9008, 101, 2, 1000, 0), (9009, 103, 1, 850, 0), (9010, 101, 2, 1000, 0);
insert into public.stock_movements (product_id, clinic_id, qty, reason, product_sale_id, created_at) values
  (101, 1, -2, 'sale', 9001, '2026-11-14T11:00:00+05:30'),
  (101, 1, -1, 'complimentary', null, '2026-11-14T12:00:00+05:30'),
  (103, 10, -1, 'sale', 9002, '2026-11-12T15:00:00+05:30'),          -- Delhi East: not linked to Zoho
  (102, 1, -1, 'sale', 9003, '2026-11-10T10:00:00+05:30'),          -- old code of the serum: adds to the serum
  (103, 1, -1, 'sale', 9004, '2026-11-14T20:00:00Z'),               -- 15 Nov 01:30 IST: an IST day, not a UTC day
  (105, 1, -3, 'sale', 9005, '2026-10-01T10:00:00+05:30'),          -- no Zoho item: left out
  (104, 1, -2, 'sale', 9006, '2026-11-01T10:00:00+05:30'),          -- Zoho does not track it: left out
  (103, 1, -1, 'sale', 9007, '2026-11-13T11:00:00+05:30'),
  (103, 1, 1, 'adjustment', 9007, '2026-11-14T11:00:00+05:30'),      -- the bill cancelled: the cream comes back
  (101, 1, -3, 'sale', 9008, '2026-11-12T10:00:00+05:30'),
  (101, 1, 1, 'adjustment', 9008, '2026-11-12T10:30:00+05:30'),      -- edited from 3 to 2
  (103, 1, -2, 'complimentary', 9009, '2026-11-11T10:00:00+05:30'),
  (103, 1, 1, 'adjustment', 9009, '2026-11-11T10:30:00+05:30'),      -- a free bill edited down: one free sample less
  (101, 1, -2, 'sale', 9010, '2026-11-09T12:00:00+05:30'),
  (101, 13, 50, 'adjustment', null, '2026-11-11T09:00:00+05:30');   -- on no bill (not seen in production): never a sale
-- online orders. amount = products − discounts − round-off + delivery charge
insert into public.online_offers values (1, 'bogo', 'b1g1', 0);
insert into public.online_orders (id, disc_mode, round_off, amount) values
  (7001, 'none', 0, 3000),        -- online team, 13 Nov, one returned (RTO) 14 Nov
  (7002, 'none', 0, 900),         -- website (Shopify), 13 Nov: ₹850 cream + ₹50 COD fee
  (7003, 'auto', 0, 1000),        -- buy one get one: 2 serums at ₹1,000, one free
  (7004, 'none', 10, 840),        -- ₹850 cream, ₹10 round-off
  (7005, 'none', 0, 850);         -- picked up at Delhi East, a clinic not linked to Zoho
insert into public.online_order_lines (order_id, product_id, qty, unit_price_hist, disc_pct, offer_id) values
  (7001, 101, 3, 1000, 0, null), (7002, 103, 1, 850, 0, null), (7003, 101, 2, 1000, 0, 1), (7004, 103, 1, 850, 0, null), (7005, 103, 1, 850, 0, null);
insert into public.online_shopify_orders (order_id) values (7002);
insert into public.stock_movements (product_id, clinic_id, qty, reason, online_order_id, created_at) values
  (101, 13, -3, 'online_sale', 7001, '2026-11-13T16:00:00+05:30'),
  (101, 13, 1, 'online_rto_in', 7001, '2026-11-14T16:00:00+05:30'),
  (103, 13, -1, 'online_sale', 7002, '2026-11-13T17:00:00+05:30'),
  (101, 13, -2, 'online_sale', 7003, '2026-11-12T16:00:00+05:30'),
  (103, 13, -1, 'online_sale', 7004, '2026-11-12T17:00:00+05:30'),
  (103, 10, -1, 'online_sale', 7005, '2026-11-12T18:00:00+05:30');
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
  // the Type Regimen custom field (20 Nov 2026) arrives as cf_type_regimen; the cream has none, so its category is read
  { item_id: "I-SERUM", name: "Hair Serum", sku: "HS-01", rate: 999, purchase_rate: 300, vendor_name: "Acme Labs", category_name: "Hair", status: "active", track_inventory: true, cf_type_regimen: "Night Regimen" },
  { item_id: "I-CREAM", name: "Day Cream", sku: "DC-01", rate: 799, purchase_rate: 10, status: "active", track_inventory: true },
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
    // a token Zoho retired before its hour was up (other programs share the refresh token)
    if (auth === "Zoho-oauthtoken tok-stale") return json({ code: 57, message: "You are not authorized to perform this operation" }, 401);
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

async function fullSync(panel: Db, crm: CrmSource, extra: Partial<SyncDeps> = {}) {
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
  // the CRM through SQL (a read-only login)
  const crmDb = async () => {
    const f = await driver.fresh(CRM_SCHEMA);
    return { db: sqlCrm(f.db), exec: f.exec };
  };

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
    expect(cream.category).toBe("Creams & Moisturizers"); // Zoho has no category for it: the online CRM's
    expect([serum.segment, serum.costEstimated]).toEqual(["night", false]); // from Zoho's Type Regimen field
    expect([cream.segment, cream.costEstimated]).toEqual([null, true]); // no field value, and "Creams" names no segment
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
    expect(src["clinic:13"]).toBeUndefined(); // stock on no bill does not make the warehouse a sales point
    // an online pickup at an unlinked clinic is that clinic's, booked on the primary — not warehouse dispatch
    expect(src["online_team:10"]).toMatchObject({ locationId: "Z-MOH", clinicId: "10", label: "Online team · Delhi East (booked on Mohali - Warehouse)" });
    expect(ds.sources).toHaveLength(6);

    const S = pi(ds, "I-SERUM");
    const C = pi(ds, "I-CREAM");
    const sold = (p: number, s: string, d: string) => ds.sold[p]![si(ds, s)]![day(ds, d)] ?? NaN;
    const used = (p: number, s: string, d: string) => ds.used[p]![si(ds, s)]![day(ds, d)] ?? NaN;
    const value = (p: number, s: string, d: string) => ds.value[p]![si(ds, s)]![day(ds, d)] ?? NaN;
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

    // a clinic bill cancelled the next day: the sale, then its reversal — nothing left over the two days
    expect([sold(C, "clinic:1", "2026-11-13"), sold(C, "clinic:1", "2026-11-14")]).toEqual([1, -1]);
    expect(value(C, "clinic:1", "2026-11-13") + value(C, "clinic:1", "2026-11-14")).toBeCloseTo(0);
    // a bill edited from 3 to 2: 2 sold, ₹2,000
    expect(sold(S, "clinic:1", "2026-11-12")).toBe(2);
    expect(value(S, "clinic:1", "2026-11-12")).toBeCloseTo(2000);
    // a free bill edited from 2 to 1: 1 used, none sold, no money
    expect([used(C, "clinic:1", "2026-11-11"), sold(C, "clinic:1", "2026-11-11")]).toEqual([1, 0]);
    // a whole-bill offer: 2 serums whose lines say ₹2,000, billed ₹1,500
    expect(sold(S, "clinic:1", "2026-11-09")).toBe(2);
    expect(value(S, "clinic:1", "2026-11-09")).toBeCloseTo(1500);
    // buy one get one online: 2 serums leave stock, ₹1,000 paid
    expect(sold(S, "online_team:13", "2026-11-12")).toBe(2);
    expect(value(S, "online_team:13", "2026-11-12")).toBeCloseTo(1000);
    // round-off comes off; the delivery charge (COD fee) is never product sales
    expect(value(C, "online_team:13", "2026-11-12")).toBeCloseTo(840);
    expect(value(C, "website:13", "2026-11-13")).toBeCloseTo(850);
    // stock on no bill is not usage, and does not make a sales point
    expect(ds.used[S]!.every((src, i) => ds.sources[i]!.channel !== "clinic" || src[day(ds, "2026-11-11")] === 0)).toBe(true);

    const totalSerum = ds.sold[S]!.reduce((a, arr) => a + arr.reduce((x, y) => x + y, 0), 0);
    // clinic 2 + 1 + 2 + 2 · online 3 − 1 + 2 · Mumbai's 2 sales Zoho refused (still real sales)
    expect(totalSerum).toBe(7 + 4 + 2);

    // channels
    const ch = Object.fromEntries(ds.channels.map((c) => [c.id, c]));
    expect(ch.clinic).toMatchObject({ connected: true, dataFrom: "2026-10-01" }); // any product's sale counts, the left-out Facial Kit included
    expect(ch.online_team).toMatchObject({ connected: true, dataFrom: "2026-11-12" });
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
    expect(h.lastSync).toHaveLength(7);
    // every sync job ran; the reorder alerts run after the morning sync, so they have not run in this test
    expect(h.lastSync.filter((s) => s.job !== "Reorder alerts (email / WhatsApp)").every((s) => s.ok && s.at)).toBe(true);
    expect(h.lastSync.find((s) => s.job === "Reorder alerts (email / WhatsApp)")).toMatchObject({ at: null, note: "Has not run yet" });
    // no alert settings in the test: both channels say what is missing
    expect(h.alerts).toMatchObject({ email: false, whatsapp: false, log: [] });
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
    // earlier days' photos: the serum had none anywhere readable on 8 and 13 Nov (Mumbai is not readable, so it does not count)
    await panel.exec(`insert into stock_snapshots values
      ('2026-11-08','I-SERUM','Z-MOH',0), ('2026-11-08','I-SERUM','Z-LDH',0), ('2026-11-08','I-SERUM','Z-MUM',5),
      ('2026-11-13','I-SERUM','Z-MOH',0), ('2026-11-13','I-SERUM','Z-LDH',0)`);
    const ds = await buildDataset(panel, NOW);
    const S = pi(ds, "I-SERUM");
    expect(ds.inStock?.[S]?.[day(ds, "2026-11-08")]).toBe(0); // nothing anywhere, nothing sold
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

  it("a run that ran out of Zoho calls is finished by the catch-up, which reads only the locations it missed", async () => {
    const panel = await panelDb();
    const { db: crm } = await crmDb();
    await panel.exec(`update settings set value = '4' where key = 'zoho.max_calls_per_day'`);
    const c = handClock();
    const first = await runSync([...FREQUENT_JOBS, ...DAILY_JOBS], { panel, crm, zohoCfg: CFG, fetchFn: fakeZoho().fetchFn, now: NOW, clock: c.clock, sleep: c.sleep });
    expect(runLeftWork(first)).toBe(true);
    await panel.exec(`update settings set value = '600' where key = 'zoho.max_calls_per_day'`);
    // the catch-up (same day): the access check is still due, and stock only where the first run did not reach
    expect(await restJobs(panel, NOW)).toEqual(["zoho_stock", "zoho_access"]);
    const z = fakeZoho();
    const rest = await runSync(await restJobs(panel, NOW), { panel, crm, zohoCfg: CFG, fetchFn: z.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep, stockSince: NOW });
    expect(z.calls.filter((x) => x.startsWith("items@"))).toEqual(["items@Z-LDH", "items@Z-MUM"]);
    expect(byJob(rest, "zoho_stock").note).toMatch(/^catch-up: 1 more location read; refused: Mumbai/);
    expect(runLeftWork(rest)).toBe(false);
    await expect(buildDataset(panel, NOW)).resolves.toBeTruthy();
    // a second catch-up has nothing left to read: no Zoho call at all, and the access check is not repeated
    expect(await restJobs(panel, NOW)).toEqual(["zoho_stock"]);
    const z2 = fakeZoho();
    await runSync(["zoho_stock"], { panel, crm, zohoCfg: CFG, fetchFn: z2.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep, stockSince: NOW });
    expect(z2.calls.filter((x) => x.startsWith("items@"))).toEqual([]);
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
    await crmExec(`delete from public.stock_movements where reason = 'complimentary' and product_id = 101; delete from public.stock_movements where product_id = 105`);
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
    expect(byJob(results, "zoho_stock").note).toMatch(/^Zoho is not configured/);
    expect(byJob(results, "crm_flows").note).toBe("The CRM connection is not configured");
    // logged, so Data health shows the skip instead of an old "ok"
    const logged = await panel.query<{ job: string; ok: boolean; note: string }>("select job, ok, note from sync_runs order by id");
    expect(logged.map((r) => r.job).sort()).toEqual([...FREQUENT_JOBS].sort());
    expect(logged.every((r) => r.ok === false)).toBe(true);
    await expect(buildDataset(panel, NOW)).rejects.toBeInstanceOf(NotReady);
  });
});

/** A stand-in for the CRM's REST API: answers PostgREST-style reads (eq / gte / lt / in, id ascending) from the fake CRM. */
function fakePostgrest(raw: Db, log: string[] = []): RowFetcher {
  return async (table, select, filters, key = "id") => {
    log.push(table);
    const cols = select.split(",").includes(key) ? select : `${key},${select}`;
    const where: string[] = [];
    const params: unknown[] = [];
    for (const f of filters) {
      const m = /^(\w+)=(eq|gte|lt|in)\.(.*)$/.exec(f);
      if (!m) throw new Error(`unsupported filter ${f}`);
      const [, col, op, val] = m;
      const n = params.length + 1;
      if (op === "in") {
        params.push(JSON.stringify(val!.slice(1, -1).split(",")));
        where.push(`${col}::text in (select jsonb_array_elements_text($${n}::text::jsonb))`);
      } else if (op === "eq") {
        params.push(val);
        where.push(`${col}::text = $${n}`);
      } else {
        params.push(val);
        where.push(`${col} ${op === "gte" ? ">=" : "<"} $${n}::timestamptz`);
      }
    }
    const sql = `select coalesce(jsonb_agg(to_jsonb(t) order by t.${key}), '[]'::jsonb) as rows from (select ${cols} from public.${table}` +
      (where.length ? ` where ${where.join(" and ")}` : "") + `) t`;
    const [row] = await raw.query<{ rows: unknown }>(sql, params);
    const rows = row?.rows;
    return (typeof rows === "string" ? JSON.parse(rows) : rows) as Record<string, unknown>[];
  };
}

describe.each(DRIVERS)("the CRM through its REST API, on $name", (driver) => {
  it("gives the panel exactly the same data as reading the CRM with SQL", async () => {
    const crmF = await driver.fresh(CRM_SCHEMA);
    const viaSql = (await driver.fresh(MIGRATION)).db;
    const viaRest = (await driver.fresh(MIGRATION)).db;
    const log: string[] = [];
    const a = await fullSync(viaSql, sqlCrm(crmF.db));
    const b = await fullSync(viaRest, restCrm(fakePostgrest(crmF.db, log), viaRest));
    expect(b.results.every((r) => r.ok)).toBe(true);
    expect(b.results.map((r) => r.note)).toEqual(a.results.map((r) => r.note));
    const x = await buildDataset(viaSql, NOW);
    const y = await buildDataset(viaRest, NOW);
    expect(y.products.map((p) => p.id)).toEqual(x.products.map((p) => p.id));
    expect(y.sources).toEqual(x.sources);
    const cents = (a: Float64Array) => Array.from(a).map((v) => Math.round(v * 100));
    for (let p = 0; p < x.products.length; p++)
      for (let s = 0; s < x.sources.length; s++) {
        expect(Array.from(y.sold[p]![s]!)).toEqual(Array.from(x.sold[p]![s]!));
        expect(Array.from(y.used[p]![s]!)).toEqual(Array.from(x.used[p]![s]!));
        expect(cents(y.value[p]![s]!)).toEqual(cents(x.value[p]![s]!));
      }
    expect(y.health.failedPushes).toEqual(x.health.failedPushes);
    expect(y.health.leftOutProducts).toEqual(x.health.leftOutProducts);
    expect(y.channels).toEqual(x.channels);
    // it read the bills, orders and lines behind the movements, and left no staged copies behind
    expect(new Set(log)).toEqual(
      new Set(["clinics", "retail_products", "online_product_meta", "stock_movements", "product_sales", "product_sale_lines", "online_orders", "online_order_lines", "online_shopify_orders", "online_offers"]),
    );
    const [left] = await viaRest.query<{ n: number }>("select count(*)::int as n from stage_stock_movements");
    expect(left?.n).toBe(0);
  });

  it("runs one sync at a time", async () => {
    const panel = (await driver.fresh(MIGRATION)).db;
    await panel.exec("insert into sync_lock values (1, now())");
    await expect(runSync(["crm_flows"], { panel, now: NOW })).rejects.toBeInstanceOf(SyncBusy);
    await panel.exec("update sync_lock set started_at = now() - interval '20 minutes'"); // a crashed run's lock expires
    await expect(runSync(["crm_flows"], { panel, now: NOW })).resolves.toHaveLength(1);
    const [lock] = await panel.query<{ n: number }>("select count(*)::int as n from sync_lock");
    expect(lock?.n).toBe(0);
  });
});

describe.each(DRIVERS)("Zoho tokens, on $name", (driver) => {
  it("replaces a saved token Zoho no longer accepts, and asks again once", async () => {
    const panel = (await driver.fresh(MIGRATION)).db;
    await panel.query("insert into zoho_token values (1, 'tok-stale', $1)", [new Date(NOW.getTime() + 3_600_000).toISOString()]);
    const z = fakeZoho();
    const c = handClock();
    const [r] = await runSync(["zoho_catalog"], { panel, zohoCfg: CFG, fetchFn: z.fetchFn, now: NOW, clock: c.clock, sleep: c.sleep });
    expect(r).toMatchObject({ ok: true, zohoCalls: 4 }); // the refused call + locations + 2 item pages
    expect(z.mints()).toBe(1);
    const [t] = await panel.query<{ access_token: string }>("select access_token from zoho_token");
    expect(t?.access_token).toBe("tok-1");
  });
});

describe("the REST reader", () => {
  it("only GETs, encodes filters, and pages by id 1,000 at a time", async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      methods.push(init?.method ?? "GET");
      expect(new Headers(init?.headers).get("apikey")).toBe("sb_secret_test");
      const after = Number(new URL(String(input)).searchParams.get("id")?.replace("gt.", "") ?? 0);
      const n = after < 2000 ? 1000 : 3;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: after + i + 1 }))), { status: 200 });
    }) as typeof fetch;
    const rows = await postgrestFetcher({ url: "https://crm.test", key: "sb_secret_test" }, fetchFn)("stock_movements", "qty", [
      "created_at=gte.2026-11-01T00:00:00+05:30",
      "product_sale_id=in.(1,2,3)",
    ]);
    expect(rows).toHaveLength(2003);
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(urls[0]).toBe(
      "https://crm.test/rest/v1/stock_movements?select=id,qty&created_at=gte.2026-11-01T00%3A00%3A00%2B05%3A30&product_sale_id=in.(1,2,3)&order=id.asc&limit=1000",
    );
    expect(urls[1]).toContain("&id=gt.1000");
    expect(urls[2]).toContain("&id=gt.2000");
    expect(urls).toHaveLength(3);
  });

  it("stops with a plain error, never a half-read, when the CRM refuses", async () => {
    const fetchFn = (async () => new Response('{"message":"permission denied"}', { status: 401 })) as unknown as typeof fetch;
    await expect(postgrestFetcher({ url: "https://crm.test", key: "k" }, fetchFn)("clinics", "name", [])).rejects.toThrow(/CRM read of clinics failed: HTTP 401/);
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
