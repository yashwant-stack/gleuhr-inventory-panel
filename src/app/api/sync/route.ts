import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfigured, hasAccess } from "@/server/access";
import { refreshDataset } from "@/server/dataset-cache";
import { panelDb } from "@/server/db";
import { crmSource } from "@/server/sources";
import { DAILY_JOBS, FREQUENT_JOBS, restJobs, runLeftWork, runSync, SyncBusy, type JobResult } from "@/server/sync";
import { zohoConfig } from "@/server/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A full sync by hand may not start within this many minutes of the last one: it protects the Zoho call allowance. */
const COOLDOWN_MIN = 15;

/**
 * "Sync from Zoho now" (decided 20 Nov 2026): the same full sync the 9:00 AM schedule runs (Zoho items, stock at every
 * location, Zoho access, CRM sales), for people holding the access key. The reorder alerts stay on the 9:00 AM run.
 */
export async function POST(req: Request) {
  if (!accessConfigured()) return NextResponse.json({ error: "The panel’s access key is not set up on the server yet." }, { status: 503 });
  const jar = await cookies();
  if (!hasAccess(jar.get(ACCESS_COOKIE)?.value)) return NextResponse.json({ error: "Access key needed." }, { status: 401 });
  try {
    const panel = panelDb();
    const budget = Number(process.env.SYNC_TIME_BUDGET_SECONDS) > 0 ? Number(process.env.SYNC_TIME_BUDGET_SECONDS) : 250;
    // ?continue=<start of this sync>: the button's catch-up when the first call ran out of time (no new cooldown)
    const cont = new URL(req.url).searchParams.get("continue");
    if (cont) {
      const since = new Date(cont);
      if (Number.isNaN(since.getTime()) || Date.now() - since.getTime() > 20 * 60_000) {
        return NextResponse.json({ error: "That sync is too old to continue. Start a new one." }, { status: 400 });
      }
      const results = await runSync(await restJobs(panel), { panel, crm: crmSource(), zohoCfg: zohoConfig(), deadline: Date.now() + budget * 1000, stockSince: since });
      refreshDataset(panel);
      return NextResponse.json(summary(results, since));
    }
    const [last] = await panel.query<{ at: string | Date | null }>("select max(finished_at) as at from sync_runs where job = 'zoho_stock' and ok");
    const since = last?.at ? (Date.now() - new Date(last.at).getTime()) / 60_000 : Infinity;
    if (since < COOLDOWN_MIN) {
      const wait = Math.ceil(COOLDOWN_MIN - since);
      return NextResponse.json(
        { error: `Zoho was synced ${Math.floor(since)} minute${Math.floor(since) === 1 ? "" : "s"} ago. Try again in ${wait} minute${wait === 1 ? "" : "s"} (this protects the Zoho call limit).` },
        { status: 429 },
      );
    }
    const startedAt = new Date();
    const results = await runSync([...FREQUENT_JOBS, ...DAILY_JOBS], { panel, crm: crmSource(), zohoCfg: zohoConfig(), deadline: Date.now() + budget * 1000 });
    refreshDataset(panel);
    return NextResponse.json(summary(results, startedAt));
  } catch (e) {
    if (e instanceof SyncBusy) return NextResponse.json({ error: "A sync is already running. Try again in a few minutes." }, { status: 409 });
    console.error("manual sync failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}

/** `more`: the run ran out of time; the button calls again with ?continue=startedAt to read what it missed. */
function summary(results: JobResult[], startedAt: Date) {
  return {
    ok: results.every((r) => r.ok || r.skipped),
    more: runLeftWork(results),
    startedAt: startedAt.toISOString(),
    zohoCalls: results.reduce((a, r) => a + (r.zohoCalls ?? 0), 0),
    results,
  };
}
