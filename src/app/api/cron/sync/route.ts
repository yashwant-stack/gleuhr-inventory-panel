import { NextResponse } from "next/server";
import { sendReorderAlerts } from "@/server/alerts";
import { buildDataset } from "@/server/dataset";
import { refreshDataset } from "@/server/dataset-cache";
import { panelDb } from "@/server/db";
import { crmSource } from "@/server/sources";
import { DAILY_JOBS, FREQUENT_JOBS, restJobs, runSync, SyncBusy, type JobName } from "@/server/sync";
import { zohoConfig } from "@/server/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled sync (vercel.json crons). Vercel sends "Authorization: Bearer <CRON_SECRET>".
 * Scheduled once a day (decided 20 Nov 2026, to keep Zoho calls low, ~18 a day): 9:00 AM IST ?run=all (every job,
 * Zoho stock last inside the time budget), then 9:10 ?run=rest (stock at any location the 9:00 run did not reach,
 * the access check if it was missed, then the reorder alerts on the complete data).
 * Also: ?run=frequent · ?run=daily · ?run=alerts (only the alerts)
 * · ?run=all · ?run=alerts (only the reorder alerts, on the data already synced)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const run = new URL(req.url).searchParams.get("run") ?? "frequent";
  const jobs: JobName[] = run === "alerts" || run === "rest" ? [] : run === "daily" ? DAILY_JOBS : run === "all" ? [...FREQUENT_JOBS, ...DAILY_JOBS] : FREQUENT_JOBS;
  try {
    const panel = panelDb();
    if (run === "alerts") return NextResponse.json({ ok: true, alerts: await runAlerts(panel) });
    if (run === "rest") {
      const results = await runSync(await restJobs(panel), {
        panel,
        crm: crmSource(),
        zohoCfg: zohoConfig(),
        deadline: Date.now() + 200_000,
        stockSince: new Date(Date.now() - 20 * 60_000),
      });
      refreshDataset(panel);
      return NextResponse.json({ ok: results.every((r) => r.ok || r.skipped), results, alerts: await runAlerts(panel) });
    }
    const crm = crmSource();
    // No Zoho call starts after the time budget (default 250 s, inside maxDuration 300 s), so the run
    // finishes and logs itself. On a plan that allows less time per run, set SYNC_TIME_BUDGET_SECONDS.
    const budget = Number(process.env.SYNC_TIME_BUDGET_SECONDS) > 0 ? Number(process.env.SYNC_TIME_BUDGET_SECONDS) : 250;
    const results = await runSync(jobs, { panel, crm, zohoCfg: zohoConfig(), deadline: Date.now() + budget * 1000 });
    refreshDataset(panel); // the screens get the new data at once
    // the 9:00 run=all leaves the alerts to the 9:10 run=rest, so they go out on complete data
    const alerts = run === "daily" ? await runAlerts(panel) : undefined;
    return NextResponse.json({ ok: results.every((r) => r.ok || r.skipped), results, alerts });
  } catch (e) {
    if (e instanceof SyncBusy) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}

/** The reorder alerts on today's data, recorded as their own line in the sync log (Data health shows it). */
async function runAlerts(panel: ReturnType<typeof panelDb>) {
  const [run] = await panel.query<{ id: number }>("insert into sync_runs (job) values ('reorder_alerts') returning id");
  try {
    const out = await sendReorderAlerts(panel, await buildDataset(panel));
    const ok = out.email !== "failed" && out.whatsapp !== "failed";
    await panel.query("update sync_runs set finished_at = now(), ok = $2, rows_written = $3, note = $4 where id = $1", [run!.id, ok, out.sent, out.note.slice(0, 500)]);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await panel.query("update sync_runs set finished_at = now(), ok = false, note = $2 where id = $1", [run!.id, msg.slice(0, 500)]);
    return { error: msg };
  }
}
