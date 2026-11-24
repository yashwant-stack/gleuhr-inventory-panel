import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cyclesFor } from "@/lib/mock/plans";
import { ACCESS_COOKIE, hasAccess } from "@/server/access";
import { panelDb } from "@/server/db";
import { sendPlanSubmitted } from "@/server/plan-mail";
import { istToday } from "@/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A plan was submitted (the plan form calls this): email Management, cc the Marketing head and the Sales head. */
export async function POST(req: Request) {
  const jar = await cookies();
  if (!hasAccess(jar.get(ACCESS_COOKIE)?.value)) return NextResponse.json({ error: "Access key needed." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const part = b.part === "marketing" || b.part === "sales" ? b.part : null;
  const today = istToday(new Date());
  // the cycle as the server knows it (this week's and the neighbouring ones)
  const cycle = [...cyclesFor(today), ...cyclesFor(String(b.periodFrom ?? today))].find((c) => c.id === b.cycleId);
  if (!part || !cycle) return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let db = null;
  try {
    db = panelDb();
  } catch {
    // not logged without the panel database
  }
  try {
    await sendPlanSubmitted(
      { cycle, part, version: num(b.version) ?? 1, late: today > cycle.dueOn, expected: num(b.expected), system: num(b.system), budget: num(b.budget), note: String(b.note ?? "").slice(0, 500) },
      db,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
