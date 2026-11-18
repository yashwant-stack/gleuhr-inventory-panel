import "server-only";
// Interim access gate for live data, until proper logins (one per person, with roles) are added.
// The panel's data is business data: with no PANEL_ACCESS_KEY configured, live data is refused.
import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "panel_access";

export function accessToken(key: string): string {
  return createHash("sha256").update(`gleuhr-inventory-panel:${key}`).digest("hex");
}

export function accessConfigured(): boolean {
  return (process.env.PANEL_ACCESS_KEY ?? "").length >= 12;
}

export function keyMatches(given: string): boolean {
  const key = process.env.PANEL_ACCESS_KEY ?? "";
  if (key.length < 12) return false;
  const a = Buffer.from(accessToken(given));
  const b = Buffer.from(accessToken(key));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hasAccess(cookieValue: string | undefined): boolean {
  const key = process.env.PANEL_ACCESS_KEY ?? "";
  if (key.length < 12 || !cookieValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(accessToken(key));
  return a.length === b.length && timingSafeEqual(a, b);
}
