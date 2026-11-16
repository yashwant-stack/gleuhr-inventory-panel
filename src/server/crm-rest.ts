import "server-only";
// The CRM through the Supabase REST API (PostgREST) of the CRM project: SUPABASE_URL + SUPABASE_SECRET_KEY.
//
// READ-ONLY BY CONSTRUCTION: this module only sends GET requests; it has no code that can write.
// The secret key bypasses the CRM's row-level security, so it stays on the server (never NEXT_PUBLIC_).
//
// Sales: the movements of a window and the bills / orders / lines / offers they point to are copied into
// the panel database's `crm_stage` schema, and the SAME FLOWS_SQL that runs on the CRM runs there
// (checked on production: online within ₹100 of the CRM's totals, every live clinic bill to the rupee).
import type { Db } from "./db";
import { num } from "./db";
import { type CrmClinicRow, type CrmProductRow, type CrmSource, type FlowRow, flowsSql, plainZohoError, type PushHealthRow, readFlows } from "./crm";

export interface RestConfig {
  url: string;
  key: string;
}

export function crmRestConfig(): RestConfig | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

type Row = Record<string, unknown>;

/** Reads every row of `table` matching `filters` (PostgREST syntax: `col=op.value`), ascending on `key` (default `id`). */
export type RowFetcher = (table: string, select: string, filters: string[], key?: string) => Promise<Row[]>;

const PAGE = 1000;
const TIMEOUT_MS = 30_000;

/** A GET-only PostgREST reader with keyset paging on a unique numeric key (1,000 rows a request). */
export function postgrestFetcher(cfg: RestConfig, fetchFn: typeof fetch = fetch): RowFetcher {
  return async (table, select, filters, key = "id") => {
    const cols = select.split(",").includes(key) ? select : `${key},${select}`;
    const out: Row[] = [];
    let after: number | null = null;
    for (;;) {
      const qs = [`select=${cols}`, ...filters.map(encodeFilter), `order=${key}.asc`, `limit=${PAGE}`];
      if (after !== null) qs.push(`${key}=gt.${after}`);
      const res = await fetchFn(`${cfg.url}/rest/v1/${table}?${qs.join("&")}`, {
        method: "GET",
        headers: { apikey: cfg.key, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`CRM read of ${table} failed: HTTP ${res.status} ${body}`);
      }
      const rows = (await res.json()) as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
      after = num(rows[rows.length - 1]![key]);
    }
  };
}

/** `col=op.value` with the value URL-encoded (a `+05:30` offset must not turn into a space). */
function encodeFilter(f: string): string {
  const eq = f.indexOf("=");
  const dot = f.indexOf(".", eq);
  if (eq < 0 || dot < 0) return f;
  const op = f.slice(eq + 1, dot);
  const value = f.slice(dot + 1);
  if (op === "in") return `${f.slice(0, dot + 1)}${encodeURIComponent(value).replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")")}`;
  return `${f.slice(0, dot + 1)}${encodeURIComponent(value)}`;
}

const istDay = (iso: unknown): string | null => {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  return Number.isNaN(t) ? null : new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);
};

/** Rows whose `col` is one of `ids`, asked for in chunks that keep the URL short. */
async function byIds(fetchRows: RowFetcher, table: string, select: string, col: string, ids: string[], extra: string[] = []): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await fetchRows(table, select, [`${col}=in.(${ids.slice(i, i + 200).join(",")})`, ...extra])));
  return out;
}

const STAGE_TABLES = ["stock_movements", "product_sales", "product_sale_lines", "online_orders", "online_order_lines", "online_shopify_orders", "online_offers", "retail_products"];

async function stage(panel: Db, table: string, cols: string, types: string, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 5000) {
    await panel.query(
      `insert into crm_stage.${table} (${cols}) select ${cols} from jsonb_to_recordset($1::text::jsonb) as r(${types}) on conflict (id) do nothing`,
      [JSON.stringify(rows.slice(i, i + 5000))],
    );
  }
}

/** The CRM through its REST API; sales are worked out in the panel database (`panel`). */
export function restCrm(fetchRows: RowFetcher, panel: Db): CrmSource {
  let clinicCache: CrmClinicRow[] | null = null;
  const clinics = async () =>
    (clinicCache ??= (await fetchRows("clinics", "id,name,active,zoho_location_id", [])).map((c) => ({
      crm_clinic_id: String(c.id),
      name: String(c.name),
      active: Boolean(c.active),
      zoho_location_id: (c.zoho_location_id as string | null) || null,
    })));

  return {
    via: "rest",
    clinics,

    async products(): Promise<CrmProductRow[]> {
      const [rows, meta] = await Promise.all([
        fetchRows("retail_products", "id,sku,name,zoho_item_id,price,active,created_at", []),
        fetchRows("online_product_meta", "product_id,category", [], "product_id"),
      ]);
      const category = new Map(meta.map((m) => [String(m.product_id), (m.category as string | null) || null]));
      return rows.map((r) => ({
        category: category.get(String(r.id)) ?? null,
        crm_product_id: String(r.id),
        sku: (r.sku as string | null) ?? null,
        name: String(r.name),
        zoho_item_id: (r.zoho_item_id as string | null) ?? null,
        price: num(r.price),
        active: Boolean(r.active),
        created_on: istDay(r.created_at),
      }));
    },

    async pushHealth(sinceIso: string): Promise<PushHealthRow[]> {
      const rows = await fetchRows("stock_movements", "id,clinic_id,created_at,sync_error", ["sync_status=eq.failed", `created_at=gte.${sinceIso}`]);
      const names = new Map((await clinics()).map((c) => [c.crm_clinic_id, c.name]));
      const by = new Map<string, { failed: number; first: string; last: string; errors: Map<string, number> }>();
      for (const r of rows) {
        const id = String(r.clinic_id);
        const d = istDay(r.created_at) ?? "";
        const e = plainZohoError(String(r.sync_error ?? ""));
        const g = by.get(id) ?? { failed: 0, first: d, last: d, errors: new Map() };
        g.failed++;
        if (d < g.first) g.first = d;
        if (d > g.last) g.last = d;
        g.errors.set(e, (g.errors.get(e) ?? 0) + 1);
        by.set(id, g);
      }
      return [...by.entries()].map(([id, g]) => ({
        crm_clinic_id: id,
        location_name: names.get(id) ?? "?",
        failed: g.failed,
        first_failed: g.first || null,
        last_failed: g.last || null,
        top_error: [...g.errors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown",
      }));
    },

    async flows(fromIso: string, toIso: string): Promise<FlowRow[]> {
      const mv = await fetchRows("stock_movements", "id,product_id,clinic_id,qty,reason,online_order_id,product_sale_id,created_at", [
        `created_at=gte.${fromIso}`,
        `created_at=lt.${toIso}`,
      ]);
      if (!mv.length) return [];
      const saleIds = [...new Set(mv.map((m) => m.product_sale_id).filter((x) => x !== null && x !== undefined).map(String))];
      const orderIds = [...new Set(mv.map((m) => m.online_order_id).filter((x) => x !== null && x !== undefined).map(String))];
      const [sales, saleLines, orders, orderLines, shop, offers, catalogue] = await Promise.all([
        byIds(fetchRows, "product_sales", "id,complimentary,total_amount", "id", saleIds),
        byIds(fetchRows, "product_sale_lines", "id,product_sale_id,product_id,qty,unit_price,discount_pct", "product_sale_id", saleIds),
        byIds(fetchRows, "online_orders", "id,disc_mode,round_off", "id", orderIds),
        byIds(fetchRows, "online_order_lines", "id,order_id,product_id,qty,disc_pct,offer_id,unit_price_hist", "order_id", orderIds),
        byIds(fetchRows, "online_shopify_orders", "id,order_id", "order_id", orderIds),
        fetchRows("online_offers", "id,type,bogo_type,paid_pct", []),
        fetchRows("retail_products", "id,price", []),
      ]);
      await panel.exec(`truncate ${STAGE_TABLES.map((t) => `crm_stage.${t}`).join(", ")}`);
      try {
        await stage(panel, "stock_movements", "id, product_id, clinic_id, qty, reason, online_order_id, product_sale_id, created_at",
          "id bigint, product_id bigint, clinic_id bigint, qty integer, reason text, online_order_id bigint, product_sale_id bigint, created_at timestamptz", mv);
        await stage(panel, "product_sales", "id, complimentary, total_amount", "id bigint, complimentary boolean, total_amount numeric", sales);
        await stage(panel, "product_sale_lines", "id, product_sale_id, product_id, qty, unit_price, discount_pct",
          "id bigint, product_sale_id bigint, product_id bigint, qty integer, unit_price numeric, discount_pct numeric", saleLines);
        await stage(panel, "online_orders", "id, disc_mode, round_off", "id bigint, disc_mode text, round_off numeric", orders);
        await stage(panel, "online_order_lines", "id, order_id, product_id, qty, disc_pct, offer_id, unit_price_hist",
          "id bigint, order_id bigint, product_id bigint, qty integer, disc_pct numeric, offer_id bigint, unit_price_hist numeric", orderLines);
        await stage(panel, "online_shopify_orders", "id, order_id", "id bigint, order_id bigint", shop);
        await stage(panel, "online_offers", "id, type, bogo_type, paid_pct", "id bigint, type text, bogo_type text, paid_pct numeric", offers);
        await stage(panel, "retail_products", "id, price", "id bigint, price numeric", catalogue);
        return await readFlows(panel, fromIso, toIso, flowsSql("crm_stage"));
      } finally {
        await panel.exec(`truncate ${STAGE_TABLES.map((t) => `crm_stage.${t}`).join(", ")}`);
      }
    },
  };
}
