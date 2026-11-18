import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayDb, NotConfigured, panelDb } from "./db";
import { zohoMissing, zohoNotConfiguredNote } from "./zoho";

describe("the gateway connection", () => {
  it("sends the mode, statement, parameters and key; returns the rows", async () => {
    const sent: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(url), key: new Headers(init?.headers).get("x-panel-key"), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ rows: [{ n: 16 }] }), { status: 200 });
    }) as typeof fetch;
    const db = gatewayDb("https://crm.test/functions/v1/inventory-panel-sql", "k".repeat(64), "crm", fetchFn);
    expect(await db.query("select count(*) as n from public.clinics where active = $1", [true])).toEqual([{ n: 16 }]);
    await gatewayDb("https://crm.test/fn", "k".repeat(64), "panel", fetchFn).exec("create table if not exists x (id int)");
    expect(sent[0]).toEqual({
      url: "https://crm.test/functions/v1/inventory-panel-sql",
      key: "k".repeat(64),
      body: { mode: "crm", text: "select count(*) as n from public.clinics where active = $1", params: [true] },
    });
    expect(sent[1]!.body).toEqual({ mode: "panel", text: "create table if not exists x (id int)", exec: true });
  });

  it("turns the gateway's refusal into a plain error", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "permission denied for table clinics" }), { status: 400 })) as unknown as typeof fetch;
    await expect(gatewayDb("https://crm.test/fn", "k", "panel", fetchFn).query("select 1 from public.clinics")).rejects.toThrow(
      "Database (panel): permission denied for table clinics",
    );
  });
});

describe("choosing the panel database", () => {
  const g = globalThis as unknown as { __panelDb?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    delete g.__panelDb;
  });

  it("on Vercel with no database settings, says what is missing instead of using a local folder", () => {
    delete g.__panelDb;
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PANEL_DATABASE_URL", "");
    vi.stubEnv("PANEL_SQL_URL", "");
    vi.stubEnv("PANEL_SQL_KEY", "");
    expect(() => panelDb()).toThrow(NotConfigured);
    expect(() => panelDb()).toThrow(/PANEL_SQL_URL and PANEL_SQL_KEY are missing/);
  });

  it("on Vercel with the gateway settings, uses the gateway", () => {
    delete g.__panelDb;
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PANEL_DATABASE_URL", "");
    vi.stubEnv("PANEL_SQL_URL", "https://crm.test/fn");
    vi.stubEnv("PANEL_SQL_KEY", "k".repeat(64));
    expect(() => panelDb()).not.toThrow();
  });
});

describe("Zoho settings", () => {
  const all = { ZOHO_ORG_ID: "1", ZOHO_CLIENT_ID: "c", ZOHO_CLIENT_SECRET: "s", ZOHO_REFRESH_TOKEN: "r" };
  it("names the empty or missing ones (never their values)", () => {
    expect(zohoMissing(all)).toEqual([]);
    expect(zohoMissing({ ...all, ZOHO_REFRESH_TOKEN: "  " })).toEqual(["ZOHO_REFRESH_TOKEN"]);
    expect(zohoNotConfiguredNote({ ...all, ZOHO_CLIENT_SECRET: "", ZOHO_REFRESH_TOKEN: undefined })).toBe(
      "Zoho is not configured: ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN are empty or missing on this server",
    );
  });
});
