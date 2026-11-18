import "server-only";
// Read-only Zoho Inventory client for the panel (India data centre).
//
// The org is SHARED with the clinic and online CRMs (80 calls a minute in total, plus a daily cap
// by plan). The panel keeps its own, much smaller ceilings — settings zoho.max_calls_per_minute
// (10) and zoho.max_calls_per_day (600), counted in its own database. A full minute makes the
// panel wait for the next one; the daily ceiling, the run's time budget or a 429 from Zoho stop
// the run. A 2-hourly refresh is ~13 calls (1 location list + 1 item list + 1 per readable location).
//
// What was verified against the live org on 14–15 Nov 2026:
//  - GET /locations lists all 16 locations.
//  - GET /items?location_id=X returns every item (197 on one page) with that location's
//    `available_stock` (UV Armour at Mohali: 6,277 = the item's own per-location figure).
//  - A location the login may not read answers code 400040; sales orders, invoices and transfer
//    orders answer code 57 ("not authorized") with the login used so far.
import type { Db } from "./db";
import { num } from "./db";

export interface ZohoConfig {
  apiBase: string;
  accountsBase: string;
  orgId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function zohoConfig(): ZohoConfig | null {
  const e = process.env;
  if (!e.ZOHO_ORG_ID || !e.ZOHO_CLIENT_ID || !e.ZOHO_CLIENT_SECRET || !e.ZOHO_REFRESH_TOKEN) return null;
  return {
    apiBase: (e.ZOHO_API_BASE ?? "https://www.zohoapis.in").replace(/\/+$/, "").replace(/\/inventory\/v1$/, ""),
    accountsBase: (e.ZOHO_ACCOUNTS_BASE ?? "https://accounts.zoho.in").replace(/\/+$/, ""),
    orgId: e.ZOHO_ORG_ID,
    clientId: e.ZOHO_CLIENT_ID,
    clientSecret: e.ZOHO_CLIENT_SECRET,
    refreshToken: e.ZOHO_REFRESH_TOKEN,
  };
}

export class ZohoBudgetExceeded extends Error {}
export class ZohoRateLimited extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super(`Zoho asked to slow down (429)${retryAfterSeconds ? `, retry after ${retryAfterSeconds}s` : ""}`);
  }
}

export type ZohoResult<T> = { ok: true; data: T } | { ok: false; status: number; code: number | null; message: string };

const TIMEOUT_MS = 20_000;

async function setting(db: Db, key: string, fallback: number): Promise<number> {
  const rows = await db.query<{ value: unknown }>("select value from settings where key = $1", [key]);
  const v = rows[0]?.value;
  const n = num(typeof v === "string" ? JSON.parse(v) : v);
  return n > 0 ? n : fallback;
}

export type Reservation = { ok: true } | { ok: false; waitMs: number };

/**
 * Reserve one call against the panel's own ceilings. The daily ceiling refuses (throws); a full
 * minute answers how long to wait for the next one, so a long run is paced, never cut short.
 */
export async function reserveCall(db: Db, now = new Date()): Promise<Reservation> {
  const perMinute = await setting(db, "zoho.max_calls_per_minute", 10);
  const perDay = await setting(db, "zoho.max_calls_per_day", 600);
  const t = now.getTime();
  const minute = new Date(Math.floor(t / 60_000) * 60_000).toISOString();
  const istMidnight = new Date(Math.floor((t + 5.5 * 3_600_000) / 86_400_000) * 86_400_000 - 5.5 * 3_600_000).toISOString();
  const [day] = await db.query<{ calls: unknown }>("select coalesce(sum(calls), 0) as calls from zoho_calls where minute >= $1", [istMidnight]);
  if (num(day?.calls) >= perDay) throw new ZohoBudgetExceeded(`the panel's daily Zoho allowance (${perDay} calls) is used up`);
  const [row] = await db.query<{ calls: unknown }>(
    "insert into zoho_calls (minute, calls) values ($1, 1) on conflict (minute) do update set calls = zoho_calls.calls + 1 returning calls",
    [minute],
  );
  if (num(row?.calls) > perMinute) {
    await db.query("update zoho_calls set calls = calls - 1 where minute = $1", [minute]);
    return { ok: false, waitMs: 60_000 - (t % 60_000) + 250 };
  }
  return { ok: true };
}

/** A cached access token (one mint per hour at most, shared by every run through the database). */
export async function accessToken(db: Db, cfg: ZohoConfig, fetchFn: typeof fetch = fetch, now = Date.now(), onMint?: () => void): Promise<string> {
  const [row] = await db.query<{ access_token: string; expires_at: string | Date }>("select access_token, expires_at from zoho_token where id = 1");
  if (row && new Date(row.expires_at).getTime() - 60_000 > now) return row.access_token;
  const qs = new URLSearchParams({ refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" });
  const res = await fetchFn(`${cfg.accountsBase}/oauth/v2/token?${qs}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Zoho token refresh failed: ${body.error ?? `HTTP ${res.status}`}`);
  const expires = new Date(now + (body.expires_in ?? 3600) * 1000).toISOString();
  await db.query(
    "insert into zoho_token (id, access_token, expires_at) values (1, $1, $2) on conflict (id) do update set access_token = excluded.access_token, expires_at = excluded.expires_at",
    [body.access_token, expires],
  );
  onMint?.();
  return body.access_token;
}

export interface ZohoClient {
  get<T>(path: string, query?: Record<string, string | number>): Promise<ZohoResult<T>>;
  /** Calls made by this client (for the sync log). */
  calls(): number;
}

export interface ZohoClientOptions {
  fetchFn?: typeof fetch;
  /** The clock (tests move it by hand). */
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** No call starts after this moment (epoch ms): the run's time budget. */
  deadline?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function zohoClient(db: Db, cfg: ZohoConfig, opts: ZohoClientOptions = {}): ZohoClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const clock = opts.clock ?? (() => new Date());
  const sleep = opts.sleep ?? realSleep;
  const timeUp = () => new ZohoBudgetExceeded("this run's time is up; the rest is read on the next run");
  let calls = 0;
  // A saved access token can stop working before its hour is up: the panel shares its refresh token with the
  // CRMs, and Zoho retires a token's oldest access tokens when new ones are made. Zoho then answers code 57
  // ("not authorized") or 14 / HTTP 401. The client then makes a fresh token and asks again, once per run.
  let mintedThisRun = false;
  const once = async (path: string, query: Record<string, string | number>) => {
    for (;;) {
      const now = clock();
      if (opts.deadline !== undefined && now.getTime() > opts.deadline) throw timeUp();
      const r = await reserveCall(db, now);
      if (r.ok) break;
      if (opts.deadline !== undefined && now.getTime() + r.waitMs > opts.deadline) throw timeUp();
      await sleep(r.waitMs);
    }
    calls++;
    const token = await accessToken(db, cfg, fetchFn, clock().getTime(), () => (mintedThisRun = true));
    const qs = new URLSearchParams({ organization_id: cfg.orgId, ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) });
    const res = await fetchFn(`${cfg.apiBase}/inventory/v1/${path.replace(/^\//, "")}?${qs}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new ZohoRateLimited(Number.isFinite(ra) && ra > 0 ? ra : null);
    }
    const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & Record<string, unknown>;
    return { res, body };
  };
  return {
    calls: () => calls,
    async get<T>(path: string, query: Record<string, string | number> = {}): Promise<ZohoResult<T>> {
      let { res, body } = await once(path, query);
      const refused = res.status === 401 || body.code === 57 || body.code === 14;
      if (refused && !mintedThisRun) {
        await db.query("delete from zoho_token where id = 1");
        ({ res, body } = await once(path, query));
      }
      if (!res.ok || (typeof body.code === "number" && body.code !== 0)) {
        return { ok: false, status: res.status, code: typeof body.code === "number" ? body.code : null, message: String(body.message ?? `HTTP ${res.status}`) };
      }
      return { ok: true, data: body as T };
    },
  };
}

// ── typed reads ───────────────────────────────────────────────────────────────

export interface ZohoLocation {
  location_id: string;
  location_name: string;
  is_primary?: boolean;
  status?: string;
}

export interface ZohoItemRow {
  item_id: string;
  name: string;
  sku?: string;
  unit?: string;
  rate?: number | string;
  purchase_rate?: number | string;
  reorder_level?: number | string;
  vendor_name?: string;
  category_name?: string;
  status?: string;
  track_inventory?: boolean;
  stock_on_hand?: number | string | null;
  available_stock?: number | string | null;
}

/** Every page of a list endpoint (200 per page, at most `maxPages`). */
export async function listAll<T>(z: ZohoClient, path: string, key: string, query: Record<string, string | number> = {}, maxPages = 10): Promise<ZohoResult<T[]>> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await z.get<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }>(path, { ...query, per_page: 200, page });
    if (!r.ok) return r;
    out.push(...((r.data[key] as T[] | undefined) ?? []));
    if (!r.data.page_context?.has_more_page) break;
  }
  return { ok: true, data: out };
}

/** A location's stock for one item row: stock on hand when Zoho gives it, else the location's available stock. */
export function rowStock(r: ZohoItemRow): number | null {
  const v = r.stock_on_hand ?? r.available_stock;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function locationKind(name: string): "warehouse" | "clinic" | "darkstore" {
  if (/darkstore/i.test(name)) return "darkstore";
  if (/warehouse/i.test(name)) return "warehouse";
  return "clinic";
}
