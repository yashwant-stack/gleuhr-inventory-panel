import "server-only";
// Two databases, both reached only from the server:
//  - the PANEL database: its own Postgres (PANEL_DATABASE_URL, e.g. its own Supabase project), or, when that is
//    not set, an embedded one saved under .data/panel (see embeddedDb);
//  - the CRM database (shared by the clinic and online CRMs), READ-ONLY: a SQL login (CRM_DATABASE_URL) or the
//    CRM project's REST API (SUPABASE_URL + SUPABASE_SECRET_KEY) — see src/server/sources.ts.
import postgres from "postgres";

// JSON parameters are always sent as text and cast in SQL (`$1::text::jsonb`): postgres.js
// JSON-encodes any value it is told is jsonb, so a JSON string passed as jsonb would arrive
// double-encoded (a string, not an array). Found by the live run of 15 Nov 2026.
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Several statements, no parameters (migrations, batches). */
  exec(text: string): Promise<void>;
}

export function postgresDb(url: string): Db & { close(): Promise<void> } {
  // prepare:false — works through Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return Array.from(rows) as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export class NotConfigured extends Error {}

const MIGRATION = "supabase/migrations/20261115000001_panel_init.sql";

/**
 * The panel database, embedded: PGlite (Postgres in WebAssembly) saving to a folder on this machine.
 * Used when PANEL_DATABASE_URL is not set: right for one long-running server (a VM, this container),
 * NOT for serverless hosting, whose disk is wiped. The migration is applied on first use (it is idempotent).
 */
export function embeddedDb(dir: string): Db {
  let ready: Promise<{ query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> }> | null = null;
  const pg = () =>
    (ready ??= (async () => {
      const [{ PGlite }, fs, path] = await Promise.all([import("@electric-sql/pglite"), import("node:fs"), import("node:path")]);
      fs.mkdirSync(dir, { recursive: true });
      const db = new PGlite(dir);
      await db.exec(fs.readFileSync(path.join(process.cwd(), MIGRATION), "utf8"));
      return db;
    })());
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await (await pg()).query(text, params)).rows as T[];
    },
    async exec(text: string) {
      await (await pg()).exec(text);
    },
  };
}

/**
 * The database through the panel's gateway in the CRM project (supabase/functions/inventory-panel-sql):
 * "panel" runs as the role that owns only the inventory_panel schema; "crm" is a read-only transaction.
 * The panel's own tables live in the CRM database without the panel having any right on the CRM's tables.
 */
export function gatewayDb(url: string, key: string, mode: "panel" | "crm", fetchFn: typeof fetch = fetch): Db {
  const call = async (body: Record<string, unknown>) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-panel-key": key },
      body: JSON.stringify({ mode, ...body }),
      signal: AbortSignal.timeout(150_000),
    });
    const out = (await res.json().catch(() => ({}))) as { rows?: unknown[]; error?: string };
    if (!res.ok || out.error) throw new Error(`Database (${mode}): ${out.error ?? `HTTP ${res.status}`}`);
    return out.rows ?? [];
  };
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await call({ text, params })) as T[];
    },
    async exec(text: string) {
      await call({ text, exec: true });
    },
  };
}

export function gatewayConfig(): { url: string; key: string } | null {
  const url = process.env.PANEL_SQL_URL;
  const key = process.env.PANEL_SQL_KEY;
  return url && key ? { url, key } : null;
}

// One instance per server process (kept on globalThis so dev-mode reloads do not open the folder twice).
const g = globalThis as unknown as { __panelDb?: Db };

export function panelDb(): Db {
  if (g.__panelDb) return g.__panelDb;
  const url = process.env.PANEL_DATABASE_URL;
  const gw = gatewayConfig();
  // Serverless hosting (Vercel) has no lasting disk: the embedded database cannot work there, so say what is
  // missing instead of trying (it failed on 18 Nov 2026 as "mkdir /var/task/.data/panel").
  if (!url && !gw && process.env.VERCEL) {
    throw new NotConfigured(
      "The panel’s database is not set up on this server: PANEL_SQL_URL and PANEL_SQL_KEY are missing. Add them in Vercel → Settings → Environment Variables, then redeploy.",
    );
  }
  g.__panelDb = url
    ? postgresDb(url)
    : gw
      ? gatewayDb(gw.url, gw.key, "panel")
      : embeddedDb(process.env.PANEL_DATA_DIR || `${process.cwd()}/.data/panel`);
  return g.__panelDb;
}

/** Which panel database is in use, for Data health. */
export function panelDbKind(): "postgres" | "crm-database" | "embedded" {
  return process.env.PANEL_DATABASE_URL ? "postgres" : gatewayConfig() ? "crm-database" : "embedded";
}

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
