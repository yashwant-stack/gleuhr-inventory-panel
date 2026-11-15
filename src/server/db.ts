import "server-only";
// Two databases, both reached only from the server:
//  - the PANEL database (the panel's own Supabase project): PANEL_DATABASE_URL
//  - the CRM database (shared by the clinic and online CRMs), READ-ONLY: CRM_DATABASE_URL,
//    a login that can only SELECT the few tables listed in src/server/crm.ts.
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

let panel: Db | null = null;
let crm: Db | null = null;

export class NotConfigured extends Error {}

export function panelDb(): Db {
  const url = process.env.PANEL_DATABASE_URL;
  if (!url) throw new NotConfigured("PANEL_DATABASE_URL is not set — the panel's database is not connected yet");
  panel ??= postgresDb(url);
  return panel;
}

export function crmDb(): Db {
  const url = process.env.CRM_DATABASE_URL;
  if (!url) throw new NotConfigured("CRM_DATABASE_URL is not set — the read-only CRM connection is not configured yet");
  crm ??= postgresDb(url);
  return crm;
}

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
