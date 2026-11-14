// Number and money formatting in Indian style (lakh / crore).

const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return INT.format(Math.round(n));
}

export function fmtRate(n: number): string {
  if (n === 0) return "0";
  return n < 10 ? n.toFixed(1) : INT.format(Math.round(n));
}

/** Full rupees: ₹1,84,000 */
export function fmtMoney(n: number): string {
  return `₹${INT.format(Math.round(n))}`;
}

/** Short rupees: ₹18.4 L · ₹1.2 Cr · ₹42.5 K */
export function fmtMoneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${ONE.format(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${ONE.format(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${ONE.format(a / 1e3)} K`;
  return `${sign}₹${INT.format(a)}`;
}

export function fmtPct(n: number | null, signed = false): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const s = `${Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n)}%`;
  return signed && n > 0 ? `+${s}` : s.replace("-", "−");
}

export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

export function fmtDays(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 1) return "<1";
  return INT.format(Math.floor(n));
}

/** 1st, 2nd, 3rd, 23rd, 25th */
export function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suf}`;
}
