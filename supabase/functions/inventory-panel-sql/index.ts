// The inventory panel's gateway to the shared CRM database (Supabase Edge Function, verify_jwt off: it checks its
// own key). POST { mode, text, params?, exec? } with header x-panel-key.
//
//   mode "panel": runs as role inventory_panel with search_path inventory_panel. That role owns only the panel's
//                 schema and has no rights on any CRM table, so a panel query cannot change CRM data.
//   mode "crm":   a READ ONLY transaction, SELECT / WITH statements only: Postgres refuses any write.
//
// The key: only its SHA-256 lives in the database (inventory_panel.gateway_key); the key is in the panel's settings.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 4, idle_timeout: 20 });

let keyHash: { value: string; at: number } | null = null;
async function expectedHash(): Promise<string | null> {
  if (keyHash && Date.now() - keyHash.at < 60_000) return keyHash.value;
  // the table belongs to the panel's role; postgres has no rights on it of its own
  const [row] = await sql.begin(async (tx) => {
    await tx.unsafe("set local role inventory_panel");
    return await tx.unsafe("select key_sha256 from inventory_panel.gateway_key where id = 1");
  });
  keyHash = row ? { value: String(row.key_sha256), at: Date.now() } : null;
  return keyHash?.value ?? null;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const given = req.headers.get("x-panel-key") ?? "";
  const want = await expectedHash();
  if (!want || given.length < 32 || !same(await sha256(given), want)) return json({ error: "Not allowed." }, 401);

  let body: { mode?: string; text?: string; params?: unknown[]; exec?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const text = String(body.text ?? "");
  const params = Array.isArray(body.params) ? body.params : [];
  if (!text) return json({ error: "no statement" }, 400);

  try {
    if (body.mode === "crm") {
      if (!/^\s*(select|with)\b/i.test(text) || body.exec) return json({ error: "CRM reads are SELECT only" }, 400);
      const rows = await sql.begin("read only", async (tx) => {
        await tx.unsafe("set local statement_timeout = '120s'");
        return await tx.unsafe(text, params as never[]);
      });
      return json({ rows: Array.from(rows) });
    }
    if (body.mode === "panel") {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("set local role inventory_panel");
        await tx.unsafe("set local search_path = inventory_panel, pg_catalog");
        await tx.unsafe("set local statement_timeout = '120s'");
        if (body.exec) {
          await tx.unsafe(text);
          return [];
        }
        return await tx.unsafe(text, params as never[]);
      });
      return json({ rows: Array.from(rows) });
    }
    return json({ error: "mode must be panel or crm" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
