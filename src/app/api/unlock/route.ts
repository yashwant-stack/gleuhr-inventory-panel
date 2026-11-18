import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfigured, accessToken, keyMatches } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { key } → sets the access cookie when the key is right. */
export async function POST(req: Request) {
  if (!accessConfigured()) return NextResponse.json({ error: "The panel’s access key is not set up on the server yet." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!keyMatches(key)) return NextResponse.json({ error: "That key is not right." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, accessToken(key), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
