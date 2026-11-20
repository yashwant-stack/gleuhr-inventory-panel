// The decided rules and formulas (see "Rules & Formulas", sections B and C).
// Pure functions only: no React, no data access. The backend will run these same
// functions once it is built, so there is exactly one place each number is computed.

import type { FormulaSettings, StockStatus } from "./types";

/** Floating-point safe rounding before ceil/floor: 308.00000000000006 must stay 308. */
export function clean(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Round up to the next multiple of `pack` (pack 1 = whole units). */
export function roundUpToPack(qty: number, pack: number): number {
  const q = clean(qty);
  if (q <= 0) return 0;
  const p = Math.max(1, Math.floor(pack));
  return Math.ceil(clean(q / p)) * p;
}

/**
 * Average per day over the last `days` entries of `series`, leaving out days the
 * product was out of stock (so a stock-out never makes demand look lower).
 * `series` runs oldest → newest and ends today. Returns null when no in-stock day exists.
 */
export interface RateResult {
  rate: number;
  /** Units sold over the days averaged. */
  sold: number;
  /** Days averaged: the last 60 (the setting), or fewer when there is less history. */
  days: number;
  /** Fewer than 30 days of history: uses the data it has and is flagged "New". */
  isNew: boolean;
}

/**
 * Formula 1 · Daily sales rate (decided 17 Nov 2026): a rolling window of the last 60 days.
 * Per day = (day 1 sales + day 2 sales + … + day N sales) ÷ N, N = 60, or fewer when there is less history.
 * Every day counts, including days with no sales. Each day the oldest day drops off and today is added.
 */
export function dailyRate(
  series: ArrayLike<number>,
  settings: Pick<FormulaSettings, "rateWindowDays">,
  opts: { historyDays?: number } = {},
): RateResult {
  const history = Math.min(opts.historyDays ?? series.length, series.length);
  const days = Math.max(0, Math.min(settings.rateWindowDays, history));
  let sold = 0;
  for (let i = series.length - days; i < series.length; i++) sold += series[i] ?? 0;
  return { rate: days ? clean(sold / days, 4) : 0, sold, days, isNew: history < 30 };
}

/**
 * Optional trend factor = last 30 days ÷ previous 30 days, capped at ±cap%.
 * Returns 1 when there is no previous-period data to compare against.
 */
export function trendFactor(series: ArrayLike<number>, capPct: number): number {
  const n = series.length;
  if (n < 60) return 1;
  let last = 0;
  let prev = 0;
  for (let i = n - 30; i < n; i++) last += series[i] ?? 0;
  for (let i = n - 60; i < n - 30; i++) prev += series[i] ?? 0;
  if (prev <= 0) return 1;
  const cap = capPct / 100;
  return Math.min(1 + cap, Math.max(1 - cap, last / prev));
}

/** Formula 2 · Projected sales for N days = Rate × N (× trend factor when switched on). */
export function projection(rate: number, days: number, factor = 1): number {
  return clean(rate * days * factor, 2);
}

/** Formula 3 · Days of cover = Current stock ÷ Rate. Infinity when nothing is selling. */
export function daysOfCover(stock: number, rate: number): number {
  if (rate <= 0) return stock > 0 ? Number.POSITIVE_INFINITY : 0;
  return clean(Math.max(0, stock) / rate, 2);
}

/** Stock-out date = Today + Days of cover (null when it never runs out at the current rate). */
export function stockOutDate(today: Date, cover: number): Date | null {
  if (!Number.isFinite(cover)) return null;
  const d = new Date(today);
  d.setDate(d.getDate() + Math.floor(cover));
  return d;
}

/** Formula 4 · Safety stock = Rate × Safety days. */
export function safetyStock(rate: number, safetyDays: number): number {
  return clean(rate * safetyDays, 2);
}

/**
 * Formula 4 · When to order (decided 20 Nov 2026): when the stock left (plus what is on the way) falls to
 * 150 days of sales (the setting). When the lead time is longer than that, at the lead time instead: ordering
 * any later would run out before the order lands.
 */
export function orderTriggerDays(reorderAtDays: number, leadTime: number): number {
  return Math.max(reorderAtDays, leadTime);
}

/** Formula 4 · Reorder point (units) = Rate × the days of stock at which to order. */
export function reorderPoint(rate: number, reorderAtDays: number, leadTime: number): number {
  return clean(rate * orderTriggerDays(reorderAtDays, leadTime), 2);
}

export interface IndentInput {
  rate: number;
  leadTime: number;
  /** Days of sales the order should cover after it lands (default 45). */
  coverDays: number;
  /** Safety stock kept on top, in days of sales (default 90). */
  safetyDays: number;
  /** Order only once the stock left falls to this many days (default 150; see orderTriggerDays). */
  reorderAtDays: number;
  stock: number;
  onOrder: number;
  packSize: number;
  /** Extra units expected from campaigns and festivals within the order's window (Marketing impact). */
  extraUnits?: number;
}

export interface IndentResult {
  /** Before rounding to pack size; may be ≤ 0 (then nothing to order). */
  raw: number;
  /** What to order now, rounded up to the pack size. 0 until the order is due. */
  qty: number;
  /** The stock left (plus on the way) has fallen to the reorder point: the order is due now. */
  due: boolean;
  /** Safety stock in units = Rate × safety days. */
  safety: number;
  /** Campaign and festival units included. */
  extra: number;
}

/**
 * Formula 5 · Auto-indent (decided 20 Nov 2026):
 * Order qty = Rate × (Lead time + Cover days) + Safety stock − Current stock − Stock on the way
 *             (+ campaign and festival units in the window), rounded UP to pack size.
 * Defaults: lead 60, cover 45, safety 90 days. Nothing is ordered until the stock left falls to the reorder
 * point (150 days of sales); expected campaign and festival units bring that day forward.
 * Example: 20 a day, 3,000 in stock (150 days): 20 × (60 + 45) + 20 × 90 − 3,000 = 900 (45 days).
 */
export function indentQuantity(i: IndentInput): IndentResult {
  const position = Math.max(0, i.stock) + i.onOrder;
  const safety = safetyStock(i.rate, i.safetyDays);
  const extra = Math.max(0, i.extraUnits ?? 0);
  const raw = clean(i.rate * (i.leadTime + i.coverDays) + safety + extra - position, 2);
  const due = (i.rate > 0 || extra > 0) && position - extra <= reorderPoint(i.rate, i.reorderAtDays, i.leadTime);
  return { raw, qty: due && raw > 0 ? roundUpToPack(raw, i.packSize) : 0, due, safety, extra };
}

/** Formula 6 · Excess units = Current stock − Rate × Overstock days (never below 0; a part-unit counts as one). */
export function excessUnits(stock: number, rate: number, overstockDays: number): number {
  return Math.max(0, Math.ceil(clean(stock - rate * overstockDays)));
}

export interface StatusInput {
  stock: number;
  onOrder: number;
  /** Days until the earliest open purchase order arrives (null = none on order). */
  nextArrivalDays: number | null;
  rate: number;
  leadTime: number;
  /** Days of stock at which to order (see orderTriggerDays). */
  reorderAtDays: number;
  overstockDays: number;
  /** Campaign and festival units expected (they bring the order forward). */
  extraUnits?: number;
}

/**
 * Section C · Stock status rules.
 *  Critical  — days of cover < lead time: runs out before new stock can arrive
 *              (an open order that lands before the stock-out date means it can, so it is not critical).
 *  Low       — current stock + stock on the way (less campaign units) ≤ reorder point (150 days of sales): time to order.
 *  Overstock — days of cover > overstock limit.
 *  Healthy   — everything else.
 *  No sales  — nothing sold in the rate windows (no rate to judge cover by).
 */
export function stockStatus(s: StatusInput): StockStatus {
  if (s.rate <= 0) return "no_sales";
  const cover = daysOfCover(s.stock, s.rate);
  const rescuedByOpenOrder = s.nextArrivalDays !== null && s.nextArrivalDays <= cover;
  if (cover < s.leadTime && !rescuedByOpenOrder) return "critical";
  if (s.stock + s.onOrder - (s.extraUnits ?? 0) <= reorderPoint(s.rate, s.reorderAtDays, s.leadTime)) return "low";
  if (cover > s.overstockDays) return "overstock";
  return "healthy";
}

/**
 * When to place the order: the day stock (plus what is on the way) falls to the reorder point.
 * 0 = today (already at or below it).
 */
export function daysUntilOrder(stock: number, onOrder: number, rate: number, reorderAtDays: number, leadTime: number, extraUnits = 0): number | null {
  if (rate <= 0) return null;
  const gap = stock + onOrder - extraUnits - reorderPoint(rate, reorderAtDays, leadTime);
  return gap <= 0 ? 0 : Math.floor(clean(gap / rate));
}

/** Days with no stock if an order placed today takes `leadTime` days to arrive. */
export function daysWithNoStock(stock: number, rate: number, leadTime: number): number {
  const cover = daysOfCover(stock, rate);
  if (!Number.isFinite(cover)) return 0;
  return Math.max(0, Math.ceil(clean(leadTime - cover)));
}

/** Plan vs projection gap in percent (+ = plan above the system). null when projection is 0. */
export function gapPct(plan: number, systemProjection: number): number | null {
  if (systemProjection <= 0) return null;
  return clean(((plan - systemProjection) / systemProjection) * 100, 1);
}

export function isGapFlagged(plan: number, systemProjection: number, thresholdPct: number): boolean {
  const g = gapPct(plan, systemProjection);
  return g !== null && Math.abs(g) > thresholdPct;
}

export interface ClinicCover {
  locationId: string;
  stock: number;
  rate: number;
}

export interface TransferSuggestion {
  fromId: string;
  toId: string;
  qty: number;
  fromCover: number;
  toCover: number;
}

/**
 * Clinic transfer suggestion: a clinic with more than `highDays` of cover sends stock to a
 * clinic with less than `lowDays`, bringing the receiver up to `lowDays × 2` without dropping
 * the sender below `highDays`.
 */
export function transferSuggestions(clinics: ClinicCover[], highDays: number, lowDays: number): TransferSuggestion[] {
  const givers = clinics
    .filter((c) => c.rate > 0 && daysOfCover(c.stock, c.rate) > highDays)
    .map((c) => ({ ...c, spare: Math.floor(clean(c.stock - c.rate * highDays)) }))
    .sort((a, b) => b.spare - a.spare);
  const takers = clinics
    .filter((c) => c.rate > 0 && daysOfCover(c.stock, c.rate) < lowDays)
    .sort((a, b) => daysOfCover(a.stock, a.rate) - daysOfCover(b.stock, b.rate));
  const out: TransferSuggestion[] = [];
  for (const t of takers) {
    let need = Math.ceil(clean(t.rate * lowDays * 2 - t.stock));
    for (const g of givers) {
      if (need <= 0) break;
      if (g.spare <= 0) continue;
      const qty = Math.min(need, g.spare);
      out.push({ fromId: g.locationId, toId: t.locationId, qty, fromCover: daysOfCover(g.stock, g.rate), toCover: daysOfCover(t.stock, t.rate) });
      g.spare -= qty;
      need -= qty;
    }
  }
  return out;
}
