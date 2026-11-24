import "server-only";
// Plan emails (decided 24 Nov 2026):
//  - every Thursday (weekly plan) and the 23rd (monthly plan), 10:00 IST: "please fill your plan", with the link.
//      Marketing plan → to the Marketing head, cc Management. Sales plan → to the Sales head, cc Management.
//  - when a plan is submitted: to Management, cc the Marketing head and the Sales head.
// Addresses are data (Vercel settings PLAN_MAIL_MARKETING / _SALES / _MANAGEMENT, comma-separated) with these defaults.
import { cyclesFor, type PlanCycle } from "../lib/mock/plans";
import type { PlanPart } from "../lib/roles";
import type { Db } from "./db";
import { panelUrl, sendMail } from "./mail";

const list = (v: string | undefined, d: string[]) => {
  const l = (v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  return l.length ? l : d;
};

export function planRecipients(env: Record<string, string | undefined> = process.env) {
  return {
    marketing: list(env.PLAN_MAIL_MARKETING, ["amanpreet@gleuhr.com"]),
    sales: list(env.PLAN_MAIL_SALES, ["manisha@gleuhr.com"]),
    management: list(env.PLAN_MAIL_MANAGEMENT, ["abhishek@gleuhr.com"]),
  };
}

const PART_NAME: Record<PlanPart, string> = { marketing: "Marketing plan", sales: "Sales plan" };
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The cycle whose request day is today (Thursday for weekly, the 23rd for monthly). */
export function cycleRequestedOn(today: string, kind: "weekly" | "monthly"): PlanCycle | null {
  return cyclesFor(today).find((c) => c.kind === kind && c.requestOn === today) ?? null;
}

async function log(db: Db | null, kind: string, to: string[], cc: string[], status: string, summary: string, error: string | null) {
  if (!db) return;
  await db
    .query("insert into notifications_log (kind, channel, recipients, status, summary, error) values ($1, 'email', $2::text[], $3, $4, $5)", [
      kind,
      `{${[...to, ...cc].map((r) => `"${r.replace(/"/g, "")}"`).join(",")}}`,
      status,
      summary.slice(0, 900),
      error,
    ])
    .catch(() => {});
}

/** "Please fill your plan" to the Marketing head and the Sales head, each cc Management. */
export async function sendPlanRequests(cycle: PlanCycle, db: Db | null): Promise<{ part: PlanPart; ok: boolean; error?: string }[]> {
  const r = planRecipients();
  const base = panelUrl();
  const out: { part: PlanPart; ok: boolean; error?: string }[] = [];
  for (const part of ["marketing", "sales"] as PlanPart[]) {
    const to = part === "marketing" ? r.marketing : r.sales;
    const link = `${base}/plans/form?cycle=${encodeURIComponent(cycle.id)}&part=${part}`;
    const subject = `Please fill the ${PART_NAME[part]} for ${cycle.label} (due ${fmt(cycle.dueOn)})`;
    const text =
      `Hello,\n\nThe ${PART_NAME[part]} for ${cycle.label} (${fmt(cycle.periodFrom)} – ${fmt(cycle.periodTo)}) is open.\n` +
      `Please fill it and submit by ${fmt(cycle.dueOn)}.\n\nOpen the plan: ${link}\n\nGleuhr Inventory Planning`;
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1b19"><p>Hello,</p>` +
      `<p>The <b>${PART_NAME[part]}</b> for <b>${esc(cycle.label)}</b> (${fmt(cycle.periodFrom)} – ${fmt(cycle.periodTo)}) is open.<br>Please fill it and submit by <b>${fmt(cycle.dueOn)}</b>.</p>` +
      `<p><a href="${esc(link)}" style="background:#d75649;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Open the ${PART_NAME[part]}</a></p>` +
      `<p style="color:#7d7a72;font-size:12px">${esc(link)}<br>Gleuhr Inventory Planning</p></div>`;
    try {
      await sendMail({ to, cc: r.management, subject, html, text });
      await log(db, "plan_request", to, r.management, "sent", `${PART_NAME[part]} · ${cycle.label}`, null);
      out.push({ part, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(db, "plan_request", to, r.management, "failed", `${PART_NAME[part]} · ${cycle.label}`, msg.slice(0, 500));
      out.push({ part, ok: false, error: msg });
    }
  }
  return out;
}

export interface SubmittedPlan {
  cycle: PlanCycle;
  part: PlanPart;
  version: number;
  late: boolean;
  expected: number | null;
  system: number | null;
  budget: number | null;
  note: string;
}

/** A plan was submitted: to Management, cc the Marketing head and the Sales head. */
export async function sendPlanSubmitted(p: SubmittedPlan, db: Db | null): Promise<void> {
  const r = planRecipients();
  const link = `${panelUrl()}/plans/form?cycle=${encodeURIComponent(p.cycle.id)}&part=${p.part}`;
  const n = (x: number | null) => (x === null ? "—" : Math.round(x).toLocaleString("en-IN"));
  const lines = [
    `Plan: ${PART_NAME[p.part]}${p.version > 1 ? ` (version ${p.version})` : ""}`,
    `Period: ${p.cycle.label} (${fmt(p.cycle.periodFrom)} – ${fmt(p.cycle.periodTo)})`,
    `Submitted: ${p.late ? "late (after " + fmt(p.cycle.dueOn) + ")" : "on time"}`,
    `Expected units: ${n(p.expected)} (system ${n(p.system)})`,
    ...(p.budget ? [`Ad budget: ₹${n(p.budget)}`] : []),
    ...(p.note.trim() ? [`Note: ${p.note.trim()}`] : []),
  ];
  const subject = `${PART_NAME[p.part]} submitted for ${p.cycle.label}`;
  const text = `${lines.join("\n")}\n\nView it: ${link}\n\nGleuhr Inventory Planning`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1b19"><p>The <b>${PART_NAME[p.part]}</b> has been submitted and locked.</p>` +
    `<p>${lines.map(esc).join("<br>")}</p><p><a href="${esc(link)}" style="color:#d75649">View the plan</a></p>` +
    `<p style="color:#7d7a72;font-size:12px">Gleuhr Inventory Planning</p></div>`;
  const cc = [...r.marketing, ...r.sales];
  try {
    await sendMail({ to: r.management, cc, subject, html, text });
    await log(db, "plan_submitted", r.management, cc, "sent", subject, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(db, "plan_submitted", r.management, cc, "failed", subject, msg.slice(0, 500));
    throw e;
  }
}
