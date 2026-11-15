import { NextResponse } from "next/server";
import { crmDb, NotConfigured, panelDb } from "@/server/db";
import { DAILY_JOBS, FREQUENT_JOBS, runSync, type JobName } from "@/server/sync";
import { zohoConfig } from "@/server/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled sync (vercel.json crons). Vercel sends "Authorization: Bearer <CRON_SECRET>".
 * ?run=frequent (default, every 2 hours) · ?run=daily (Zoho access + purchase orders) · ?run=all
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const run = new URL(req.url).searchParams.get("run") ?? "frequent";
  const jobs: JobName[] = run === "daily" ? DAILY_JOBS : run === "all" ? [...FREQUENT_JOBS, ...DAILY_JOBS] : FREQUENT_JOBS;
  try {
    const panel = panelDb();
    let crm = null;
    try {
      crm = crmDb();
    } catch (e) {
      if (!(e instanceof NotConfigured)) throw e;
    }
    // No Zoho call starts after the time budget (default 250 s, inside maxDuration 300 s), so the run
    // finishes and logs itself. On a plan that allows less time per run, set SYNC_TIME_BUDGET_SECONDS.
    const budget = Number(process.env.SYNC_TIME_BUDGET_SECONDS) > 0 ? Number(process.env.SYNC_TIME_BUDGET_SECONDS) : 250;
    const results = await runSync(jobs, { panel, crm, zohoCfg: zohoConfig(), deadline: Date.now() + budget * 1000 });
    return NextResponse.json({ ok: results.every((r) => r.ok || r.skipped), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
