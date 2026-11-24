import { NextResponse } from "next/server";
import { panelDb } from "@/server/db";
import { cycleRequestedOn, sendPlanRequests } from "@/server/plan-mail";
import { istToday } from "@/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Please fill your plan" emails (vercel.json): ?kind=weekly every Thursday, ?kind=monthly on the 23rd, 10:00 IST.
 * Vercel sends "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const kind = new URL(req.url).searchParams.get("kind") === "monthly" ? "monthly" : "weekly";
  const today = istToday(new Date());
  const cycle = cycleRequestedOn(today, kind);
  if (!cycle) return NextResponse.json({ ok: true, sent: [], note: `No ${kind} plan is requested on ${today}` });
  let db = null;
  try {
    db = panelDb();
  } catch {
    // no panel database: still send, just not logged
  }
  const sent = await sendPlanRequests(cycle, db);
  return NextResponse.json({ ok: sent.every((s) => s.ok), cycle: cycle.id, sent });
}
