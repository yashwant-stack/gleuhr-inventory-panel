import "server-only";

// Reorder alerts by email and WhatsApp (decided 20 Nov 2026): when a product's stock falls to its regimen's reorder
// point (Night Regime 150 days, Day Regime and Wellness 120 days), Purchase and Management are told what to order
// and how much (back to 180 / 150 days when it lands). Same services as the clinic CRM: Resend for email, 360dialog
// for WhatsApp. A product is not repeated for ALERT_REPEAT_DAYS (default 7) while it stays due.
//
// Sent from the daily sync (vercel.json, 9:00 AM IST), or by hand with /api/cron/sync?run=alerts.
// The numbers are the server's: default settings (Settings changes made in a browser stay in that browser for now)
// and no campaign or festival units (those are saved in the browser too).

import { computeMetrics, type ProductMetrics } from "../lib/data/engine";
import type { Dataset } from "../lib/data/model";
import { DEFAULT_FORMULA_SETTINGS, SEGMENTS, type FormulaSettings } from "../lib/domain/types";
import type { Db } from "./db";

export interface AlertConfig {
  email: { key: string; from: string; to: string[] } | null;
  whatsapp: { key: string; apiUrl: string; to: string[]; template: string; lang: string } | null;
  /** What is missing for each channel, in plain words (empty when it is ready). */
  missing: { email: string[]; whatsapp: string[] };
  repeatDays: number;
  panelUrl: string | null;
}

// emails: comma, semicolon or space between them; phone numbers: comma or semicolon (a number may contain spaces)
const list = (v: string | undefined, sep: RegExp = /[,;\s]+/) =>
  (v ?? "")
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

export function alertConfig(env: Record<string, string | undefined> = process.env): AlertConfig {
  const missing = { email: [] as string[], whatsapp: [] as string[] };
  const need = (bucket: string[], name: string, v: string | undefined | string[]) => {
    if (Array.isArray(v) ? v.length === 0 : !v?.trim()) bucket.push(name);
  };
  const emailTo = list(env.ALERT_EMAIL_TO);
  need(missing.email, "RESEND_API_KEY", env.RESEND_API_KEY);
  need(missing.email, "ALERT_EMAIL_FROM", env.ALERT_EMAIL_FROM);
  need(missing.email, "ALERT_EMAIL_TO", emailTo);
  // WhatsApp numbers with the country code, digits only (91XXXXXXXXXX)
  const waTo = list(env.ALERT_WHATSAPP_TO, /[,;]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 10);
  need(missing.whatsapp, "D360_API_KEY", env.D360_API_KEY);
  need(missing.whatsapp, "ALERT_WHATSAPP_TO", waTo);
  need(missing.whatsapp, "WA_ALERT_TEMPLATE", env.WA_ALERT_TEMPLATE);
  const repeat = Number(env.ALERT_REPEAT_DAYS);
  const host = env.ALERT_PANEL_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return {
    email: missing.email.length ? null : { key: env.RESEND_API_KEY!.trim(), from: env.ALERT_EMAIL_FROM!.trim(), to: emailTo },
    whatsapp: missing.whatsapp.length
      ? null
      : {
          key: env.D360_API_KEY!.trim(),
          apiUrl: (env.WA_360_API_URL?.trim() || "https://waba-v2.360dialog.io").replace(/\/+$/, ""),
          to: waTo,
          template: env.WA_ALERT_TEMPLATE!.trim(),
          lang: env.WA_ALERT_TEMPLATE_LANG?.trim() || "en",
        },
    missing,
    repeatDays: Number.isFinite(repeat) && repeat >= 1 ? Math.round(repeat) : 7,
    panelUrl: host ? host.replace(/\/+$/, "") : null,
  };
}

export interface ReorderLine {
  productId: string;
  name: string;
  sku: string;
  regimen: string;
  /** Days of stock left at today's rate. */
  daysLeft: number;
  rate: number;
  stock: number;
  orderQty: number;
  orderValue: number;
  /** "back to 180 days when it lands" (or the general rule's words). */
  rule: string;
  critical: boolean;
}

const regimenName = (m: ProductMetrics) => SEGMENTS.find((g) => g.id === m.product.segment)?.label ?? "No regimen";

/** Products whose stock has fallen to their reorder point and that need an order now, most urgent first. */
export function dueReorders(ds: Dataset, settings: FormulaSettings = DEFAULT_FORMULA_SETTINGS): ReorderLine[] {
  return computeMetrics(ds, settings)
    .filter((m) => m.indentDue && m.indentQty > 0 && (m.status === "critical" || m.status === "low"))
    .sort((a, b) => a.cover - b.cover)
    .map((m) => ({
      productId: m.product.id,
      name: m.product.name,
      sku: m.product.sku,
      regimen: regimenName(m),
      daysLeft: Number.isFinite(m.cover) ? Math.floor(m.cover) : 0,
      rate: m.rate,
      stock: m.stock,
      orderQty: m.indentQty,
      orderValue: Math.round(m.indentQty * m.product.cost),
      rule: m.rule.label.replace(/^[^:]+: /, ""),
      critical: m.status === "critical",
    }));
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const units = (n: number) => Math.round(n).toLocaleString("en-IN");

/** The WhatsApp template's one variable: one line, no line breaks (WhatsApp refuses them in variables). */
export function whatsappText(lines: ReorderLine[], max = 900): string {
  const parts = lines.map((l) => `${l.name}: order ${units(l.orderQty)} (${l.daysLeft} days left${l.critical ? ", critical" : ""})`);
  let out = `${lines.length} product${lines.length === 1 ? "" : "s"}: `;
  for (let i = 0; i < parts.length; i++) {
    const next = (i ? "; " : "") + parts[i];
    const rest = parts.length - i;
    if ((out + next).length > max - 20) return `${out}; and ${rest} more`;
    out += next;
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function emailContent(lines: ReorderLine[], today: string, panelUrl: string | null): { subject: string; html: string; text: string } {
  const total = lines.reduce((a, l) => a + l.orderValue, 0);
  const subject = `Reorder now: ${lines.length} product${lines.length === 1 ? "" : "s"} (${inr(total)} at cost) · Gleuhr inventory`;
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e6e3dc">${esc(l.name)}<br><span style="color:#7d7a72;font-size:12px">${esc(l.sku)} · ${esc(l.regimen)}</span></td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #e6e3dc;text-align:right">${units(l.stock)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #e6e3dc;text-align:right;${l.critical ? "color:#d03b3b;font-weight:600" : ""}">${l.daysLeft}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #e6e3dc;text-align:right;font-weight:600">${units(l.orderQty)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #e6e3dc;text-align:right">${inr(l.orderValue)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #e6e3dc;color:#52514e;font-size:12px">${esc(l.rule)}</td></tr>`,
    )
    .join("");
  const link = panelUrl ? `<p><a href="${esc(panelUrl)}/indent" style="color:#d75649">Open Auto indent</a> to check and approve.</p>` : "";
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1b19">` +
    `<p>These products have reached their reorder point today, ${esc(today)}. Order quantity brings each one back to its target on the day the order lands.</p>` +
    `<table style="border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#7d7a72">` +
    `<th style="padding:6px 8px">Product</th><th style="padding:6px 8px;text-align:right">Stock</th><th style="padding:6px 8px;text-align:right">Days left</th>` +
    `<th style="padding:6px 8px;text-align:right">Order</th><th style="padding:6px 8px;text-align:right">Value at cost</th><th style="padding:6px 8px">Rule</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>${link}` +
    `<p style="color:#7d7a72;font-size:12px">Stock on the way is not counted until the Zoho login can read purchase orders. Values use the cost in Zoho, or 30% of the selling price where Zoho has none.</p></div>`;
  const text =
    `Reorder now (${today}):\n` +
    lines.map((l) => `- ${l.name} (${l.regimen}): ${units(l.stock)} in stock, ${l.daysLeft} days left. Order ${units(l.orderQty)} (${inr(l.orderValue)}).`).join("\n") +
    (panelUrl ? `\n\nOpen Auto indent: ${panelUrl}/indent` : "");
  return { subject, html, text };
}

type Fetch = typeof fetch;

async function sendEmail(cfg: NonNullable<AlertConfig["email"]>, msg: { subject: string; html: string; text: string }, f: Fetch) {
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: cfg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** One template message per number. Returns the numbers that failed, with the reason. */
async function sendWhatsapp(cfg: NonNullable<AlertConfig["whatsapp"]>, text: string, f: Fetch): Promise<string[]> {
  const failed: string[] = [];
  for (const to of cfg.to) {
    const res = await f(`${cfg.apiUrl}/messages`, {
      method: "POST",
      headers: { "D360-API-KEY": cfg.key, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: { name: cfg.template, language: { code: cfg.lang }, components: [{ type: "body", parameters: [{ type: "text", text }] }] },
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e: unknown) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    if (!res.ok) failed.push(`${to}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
  }
  return failed;
}

export interface AlertRun {
  due: number;
  /** Products in this message (due and not alerted in the last repeatDays). */
  sent: number;
  email: "sent" | "failed" | "not set up" | "nothing to send";
  whatsapp: "sent" | "failed" | "not set up" | "nothing to send";
  note: string;
}

/** Products already alerted (status sent) within the last `days`. */
async function recentlyAlerted(db: Db, days: number): Promise<Set<string>> {
  const rows = await db.query<{ summary: string | null }>(
    "select summary from notifications_log where kind = 'reorder' and status = 'sent' and sent_at > now() - ($1::int * interval '1 day')",
    [days],
  );
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      for (const id of (JSON.parse(r.summary ?? "{}") as { ids?: string[] }).ids ?? []) ids.add(id);
    } catch {
      // an old free-text summary: nothing to skip
    }
  }
  return ids;
}

async function log(db: Db, channel: "email" | "whatsapp", recipients: string[], status: string, lines: ReorderLine[], error: string | null) {
  const summary = JSON.stringify({ ids: lines.map((l) => l.productId), text: `${lines.length} product${lines.length === 1 ? "" : "s"} to reorder: ${lines.map((l) => l.name).join(", ")}`.slice(0, 900) });
  await db.query("insert into notifications_log (kind, channel, recipients, status, summary, error) values ('reorder', $1, $2::text[], $3, $4, $5)", [
    channel,
    `{${recipients.map((r) => `"${r.replace(/"/g, "")}"`).join(",")}}`,
    status,
    summary,
    error,
  ]);
}

export async function sendReorderAlerts(db: Db, ds: Dataset, cfg: AlertConfig = alertConfig(), f: Fetch = fetch): Promise<AlertRun> {
  const due = dueReorders(ds);
  const skip = await recentlyAlerted(db, cfg.repeatDays);
  const fresh = due.filter((l) => !skip.has(l.productId));
  const base = { due: due.length, sent: fresh.length };
  if (!fresh.length) {
    return { ...base, email: "nothing to send", whatsapp: "nothing to send", note: `${due.length} due, all alerted in the last ${cfg.repeatDays} days` };
  }
  let email: AlertRun["email"] = "not set up";
  let whatsapp: AlertRun["whatsapp"] = "not set up";
  const notes: string[] = [];
  if (cfg.email) {
    try {
      await sendEmail(cfg.email, emailContent(fresh, ds.today, cfg.panelUrl), f);
      email = "sent";
      await log(db, "email", cfg.email.to, "sent", fresh, null);
    } catch (e) {
      email = "failed";
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(`email: ${msg}`);
      await log(db, "email", cfg.email.to, "failed", fresh, msg.slice(0, 500));
    }
  } else notes.push(`email not set up (missing ${cfg.missing.email.join(", ")})`);
  if (cfg.whatsapp) {
    const failed = await sendWhatsapp(cfg.whatsapp, whatsappText(fresh), f);
    whatsapp = failed.length === cfg.whatsapp.to.length ? "failed" : "sent";
    if (failed.length) notes.push(`WhatsApp: ${failed.join("; ")}`);
    await log(db, "whatsapp", cfg.whatsapp.to, whatsapp === "sent" ? "sent" : "failed", fresh, failed.length ? failed.join("; ").slice(0, 500) : null);
  } else notes.push(`WhatsApp not set up (missing ${cfg.missing.whatsapp.join(", ")})`);
  return { ...base, email, whatsapp, note: notes.join(" · ") || `${fresh.length} product(s) alerted` };
}

export interface AlertLogRow {
  at: string;
  channel: "email" | "whatsapp";
  recipients: string[];
  status: string;
  summary: string;
  error: string | null;
}

export async function alertLog(db: Db, days = 14): Promise<AlertLogRow[]> {
  const rows = await db.query<{ sent_at: string | Date; channel: "email" | "whatsapp"; recipients: string[] | string; status: string; summary: string | null; error: string | null }>(
    "select sent_at, channel, recipients, status, summary, error from notifications_log where sent_at > now() - ($1::int * interval '1 day') order by sent_at desc limit 200",
    [days],
  );
  return rows.map((r) => {
    let summary = r.summary ?? "";
    try {
      summary = (JSON.parse(summary) as { text?: string }).text ?? summary;
    } catch {
      // free text
    }
    const recipients = Array.isArray(r.recipients) ? r.recipients : String(r.recipients).replace(/^\{|\}$/g, "").split(",").filter(Boolean).map((x) => x.replace(/^"|"$/g, ""));
    return { at: new Date(r.sent_at).toISOString(), channel: r.channel, recipients, status: r.status, summary, error: r.error };
  });
}
