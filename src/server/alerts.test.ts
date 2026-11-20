// Reorder alerts (decided 20 Nov 2026): what is due, what is sent, and that a product is not repeated for 7 days.
import { describe, expect, it } from "vitest";
import { getDataset } from "../lib/mock/dataset";
import { alertConfig, dueReorders, emailContent, sendReorderAlerts, whatsappText } from "./alerts";
import type { Db } from "./db";

const ds = getDataset();
const ENV = {
  RESEND_API_KEY: "re_test",
  ALERT_EMAIL_FROM: "Inventory <alerts@example.com>",
  ALERT_EMAIL_TO: "purchase@example.com, md@example.com",
  D360_API_KEY: "d360_test",
  ALERT_WHATSAPP_TO: "+91 98765 43210, 919812345678",
  WA_ALERT_TEMPLATE: "inventory_reorder",
};

/** notifications_log in memory: the two statements alerts.ts runs. */
function fakeDb() {
  const rows: { kind: string; channel: string; recipients: string; status: string; summary: string; error: string | null; sent_at: Date }[] = [];
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      if (text.startsWith("select summary from notifications_log")) {
        const since = Date.now() - Number(params[0]) * 86400_000;
        return rows.filter((r) => r.kind === "reorder" && r.status === "sent" && r.sent_at.getTime() > since).map((r) => ({ summary: r.summary })) as T[];
      }
      if (text.startsWith("insert into notifications_log")) {
        const [channel = "", recipients = "", status = "", summary = "", error] = params as (string | undefined)[];
        rows.push({ kind: "reorder", channel, recipients, status, summary, error: error ?? null, sent_at: new Date() });
        return [] as T[];
      }
      throw new Error("unexpected query: " + text);
    },
    async exec() {},
  };
  return { db, rows };
}

function fakeFetch(fail: { email?: boolean } = {}) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const bad = fail.email && String(url).includes("resend");
    return new Response(bad ? "nope" : "{}", { status: bad ? 422 : 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe("reorder alerts", () => {
  it("reads the settings and says what is missing per channel", () => {
    const cfg = alertConfig(ENV);
    expect(cfg.email?.to).toEqual(["purchase@example.com", "md@example.com"]);
    expect(cfg.whatsapp).toMatchObject({ to: ["919876543210", "919812345678"], template: "inventory_reorder", lang: "en", apiUrl: "https://waba-v2.360dialog.io" });
    const none = alertConfig({});
    expect([none.email, none.whatsapp]).toEqual([null, null]);
    expect(none.missing).toEqual({ email: ["RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO"], whatsapp: ["D360_API_KEY", "ALERT_WHATSAPP_TO", "WA_ALERT_TEMPLATE"] });
    expect(none.repeatDays).toBe(7);
  });

  it("lists every product at its reorder point with the order quantity; Hair Serum (Night Regime) orders 1,215", () => {
    const due = dueReorders(ds);
    expect(due.length).toBeGreaterThan(0);
    expect(due.find((l) => l.name === "Hair Serum")).toMatchObject({ regimen: "Night Regime", orderQty: 1215, daysLeft: 21 });
    expect(due.every((l) => l.orderQty > 0)).toBe(true);
    // most urgent first
    expect(due.map((l) => l.daysLeft)).toEqual([...due.map((l) => l.daysLeft)].sort((a, b) => a - b));
  });

  it("the WhatsApp variable is one line and short; the email names each product and order", () => {
    const due = dueReorders(ds);
    const t = whatsappText(due, 300);
    expect(t).not.toMatch(/[\n\t]/);
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t).toMatch(/^\d+ products: /);
    if (due.length > 5) expect(t).toMatch(/and \d+ more$/);
    const mail = emailContent(due, ds.today, "https://panel.example.com");
    expect(mail.subject).toMatch(/^Reorder now: \d+ products/);
    expect(mail.html).toContain("Hair Serum");
    expect(mail.text).toContain("Order 1,215");
    expect(mail.text).toContain("https://panel.example.com/indent");
  });

  it("sends by Resend and 360dialog, logs it, and does not repeat a product within 7 days", async () => {
    const { db, rows } = fakeDb();
    const { f, calls } = fakeFetch();
    const first = await sendReorderAlerts(db, ds, alertConfig(ENV), f);
    expect(first).toMatchObject({ email: "sent", whatsapp: "sent" });
    expect(first.sent).toBe(first.due);
    expect(calls.map((c) => c.url)).toEqual(["https://api.resend.com/emails", "https://waba-v2.360dialog.io/messages", "https://waba-v2.360dialog.io/messages"]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer re_test");
    expect(calls[1]!.headers.get("D360-API-KEY")).toBe("d360_test");
    expect(calls[1]!.body).toMatchObject({ to: "919876543210", type: "template", template: { name: "inventory_reorder", language: { code: "en" } } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([["email", "sent"], ["whatsapp", "sent"]]);

    const again = await sendReorderAlerts(db, ds, alertConfig(ENV), f);
    expect(again).toMatchObject({ sent: 0, email: "nothing to send", whatsapp: "nothing to send" });
    expect(calls).toHaveLength(3);
  });

  it("a channel that is not set up is skipped and named; a failed email is logged as failed and retried next time", async () => {
    const { db, rows } = fakeDb();
    const { f } = fakeFetch({ email: true });
    const out = await sendReorderAlerts(db, ds, alertConfig({ ...ENV, D360_API_KEY: "" }), f);
    expect(out).toMatchObject({ email: "failed", whatsapp: "not set up" });
    expect(out.note).toContain("missing D360_API_KEY");
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
    // nothing was sent, so the next run tries the same products again
    const retry = await sendReorderAlerts(db, ds, alertConfig(ENV), fakeFetch().f);
    expect(retry.sent).toBe(out.due);
  });
});
