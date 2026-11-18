import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfigured, hasAccess } from "@/server/access";
import { NotReady } from "@/server/dataset";
import { cachedDataset } from "@/server/dataset-cache";
import { NotConfigured, panelDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Building the data reads the panel database through the gateway (about 25 s on a cold start).
export const maxDuration = 120;

/** The panel's data (stock from Zoho, sales from the CRMs), for people holding the access key. */
export async function GET() {
  if (!accessConfigured()) return NextResponse.json({ error: "The panel’s access key is not set up on the server yet." }, { status: 503 });
  const jar = await cookies();
  if (!hasAccess(jar.get(ACCESS_COOKIE)?.value)) return NextResponse.json({ error: "Access key needed." }, { status: 401 });
  try {
    return NextResponse.json(await cachedDataset(panelDb()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const known = e instanceof NotConfigured || e instanceof NotReady;
    const message = known ? (e as Error).message : "The panel’s data could not be read. Try again in a minute.";
    if (!known) console.error("dataset failed", e);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
