// Date helpers. Dates are plain "yyyy-mm-dd" strings handled in UTC so the panel never
// shifts a day because of the viewer's time zone (business dates are IST calendar days).

export const DAY_MS = 86_400_000;

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return toDay(new Date(parseDay(iso).getTime() + n * DAY_MS));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / DAY_MS);
}

const SHORT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** "14 Nov" */
export function fmtDay(iso: string): string {
  return SHORT.format(parseDay(iso));
}

/** "14 Nov 2026" */
export function fmtDayLong(iso: string): string {
  return LONG.format(parseDay(iso));
}

/** "Sat" */
export function fmtWeekday(iso: string): string {
  return WEEKDAY.format(parseDay(iso));
}

/** "November 2026" */
export function fmtMonth(iso: string): string {
  return MONTH.format(parseDay(iso));
}

export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDay(from);
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + "01";
}
