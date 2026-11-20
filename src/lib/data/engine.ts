// Turns the dataset + settings + filters into the numbers every screen shows.
// Screens never compute business numbers themselves; they call these functions, which call the
// decided formulas in lib/domain. The same code runs on the server for alerts.
//
// SALES are read per channel (sold / value). STOCK planning uses USAGE (sold + free samples +
// exchanges) per Zoho location: a location's usage is the sum of every source that ships from it.
// Each channel's daily rate is worked out over that channel's own history, then added up, so a
// channel whose data starts later (clinic sales from 28 Aug) never drags the average down.

import { addDays, diffDays, parseDay } from "../dates";
import type { ExtraPart } from "./campaigns";
import {
  dailyRate,
  daysOfCover,
  daysUntilOrder,
  excessUnits,
  indentQuantity,
  orderTriggerDays,
  projection,
  reorderPoint,
  stockOutDate,
  stockStatus,
  trendFactor,
  transferSuggestions,
  type TransferSuggestion,
} from "../domain/formulas";
import type { ChannelId, FormulaSettings, Location, LocationKind, Product, PurchaseOrder, PurchaseRule, Segment, StockStatus } from "../domain/types";
import { DEFAULT_LEAD_DAYS, PROJECTION_HORIZONS, purchaseRule } from "../domain/types";
import { CHANNELS } from "../mock/catalog";
import { primaryLocation, salesPointId, type Dataset, type Source } from "./model";

export interface Filters {
  from: string;
  to: string;
  channels: ChannelId[];
  /** Sales points: "clinic:<id>" or "loc:<zoho location id>" (sales pages). */
  points: string[];
  /** Zoho location ids (stock pages). */
  locations: string[];
  categories: string[];
  /** Day / night / wellness, or "none" for not set (Purchase only, decided 20 Nov 2026). Absent = all. */
  segments?: string[];
  search: string;
}

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);

function zeroByChannel(): Record<ChannelId, number> {
  return Object.fromEntries(CHANNEL_IDS.map((c) => [c, 0])) as Record<ChannelId, number>;
}

// ── filters → which sources / products count ──────────────────────────────────

export function sourceMask(ds: Dataset, f: Pick<Filters, "channels" | "points">): boolean[] {
  return ds.sources.map((s) => (f.channels.length === 0 || f.channels.includes(s.channel)) && (f.points.length === 0 || f.points.includes(salesPointId(s))));
}

export function productMatches(p: Product, f: Pick<Filters, "categories" | "search" | "segments">): boolean {
  if (f.categories.length > 0 && !f.categories.includes(p.category)) return false;
  if (f.segments?.length && !f.segments.includes(p.segment ?? "none")) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
  return true;
}

/** Clamp a date range to the data held; returns day indexes [start, end] inclusive. */
export function rangeIndexes(ds: Dataset, from: string, to: string): [number, number] {
  const first = ds.days[0]!;
  return [Math.max(0, diffDays(from, first)), Math.min(ds.days.length - 1, diffDays(to, first))];
}

/** `comparable` for the period before `f`'s range, with extra filters (a channel, a sales point) or one product. */
export function comparer(ds: Dataset, f: Filters): (extra?: Partial<Filters>, pi?: number) => boolean {
  const prevFrom = previousRange(f.from, f.to).from;
  return (extra = {}, pi) => comparable(ds, { ...f, ...extra }, { from: f.from, to: f.to }, prevFrom, pi);
}

export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = diffDays(to, from) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

// ── sales in a date range ─────────────────────────────────────────────────────

export interface ProductSales {
  product: Product;
  qty: number;
  value: number;
  byChannel: Record<ChannelId, { qty: number; value: number }>;
  /** Net units by source id. */
  bySource: Record<string, number>;
  /** Net value by source id. */
  valueBySource: Record<string, number>;
}

export function salesByProduct(ds: Dataset, f: Filters, range?: { from: string; to: string }): ProductSales[] {
  const [s, e] = rangeIndexes(ds, range?.from ?? f.from, range?.to ?? f.to);
  const mask = sourceMask(ds, f);
  const out: ProductSales[] = [];
  ds.products.forEach((p, pi) => {
    if (!productMatches(p, f)) return;
    const byChannel = Object.fromEntries(CHANNEL_IDS.map((c) => [c, { qty: 0, value: 0 }])) as ProductSales["byChannel"];
    const bySource: Record<string, number> = {};
    const valueBySource: Record<string, number> = {};
    let qty = 0;
    let value = 0;
    ds.sources.forEach((src, si) => {
      if (!mask[si]) return;
      const q = ds.sold[pi]![si]!;
      const v = ds.value[pi]![si]!;
      let sq = 0;
      let sv = 0;
      for (let d = s; d <= e; d++) {
        sq += q[d]!;
        sv += v[d]!;
      }
      if (!sq && !sv) return;
      byChannel[src.channel].qty += sq;
      byChannel[src.channel].value += sv;
      bySource[src.id] = (bySource[src.id] ?? 0) + sq;
      valueBySource[src.id] = (valueBySource[src.id] ?? 0) + sv;
      qty += sq;
      value += sv;
    });
    out.push({ product: p, qty, value, byChannel, bySource, valueBySource });
  });
  return out;
}

export interface DayPoint {
  day: string;
  total: number;
  totalValue: number;
  byChannel: Record<ChannelId, number>;
  byChannelValue: Record<ChannelId, number>;
}

/** Units and value per day in the range, split by channel. */
export function dailyTotals(ds: Dataset, f: Filters, productIds?: string[]): DayPoint[] {
  const [s, e] = rangeIndexes(ds, f.from, f.to);
  const mask = sourceMask(ds, f);
  const points: DayPoint[] = [];
  for (let d = s; d <= e; d++) points.push({ day: ds.days[d]!, total: 0, totalValue: 0, byChannel: zeroByChannel(), byChannelValue: zeroByChannel() });
  ds.products.forEach((p, pi) => {
    if (productIds ? !productIds.includes(p.id) : !productMatches(p, f)) return;
    ds.sources.forEach((src, si) => {
      if (!mask[si]) return;
      const q = ds.sold[pi]![si]!;
      const v = ds.value[pi]![si]!;
      for (let d = s; d <= e; d++) {
        if (!q[d] && !v[d]) continue;
        const pt = points[d - s]!;
        pt.total += q[d]!;
        pt.totalValue += v[d]!;
        pt.byChannel[src.channel] += q[d]!;
        pt.byChannelValue[src.channel] += v[d]!;
      }
    });
  });
  return points;
}

// ── daily rates ───────────────────────────────────────────────────────────────

export function historyDays(ds: Dataset, p: Product): number {
  return Math.max(1, diffDays(ds.today, p.launchedOn) + 1);
}

/** Days of data this channel has for this product (channel start or product launch, whichever is later). */
export function channelHistoryDays(ds: Dataset, p: Product, ch: ChannelId): number {
  const from = ds.channels.find((c) => c.id === ch)?.dataFrom;
  const chDays = from ? Math.max(1, diffDays(ds.today, from) + 1) : 0;
  return Math.min(historyDays(ds, p), chDays);
}

/** Daily series summed over the sources that pass `pick`. */
export function seriesFor(ds: Dataset, pi: number, pick: (s: Source) => boolean, kind: "sold" | "used"): number[] {
  const out = new Array<number>(ds.days.length).fill(0);
  const arrs = kind === "sold" ? ds.sold[pi]! : ds.used[pi]!;
  ds.sources.forEach((src, si) => {
    if (!pick(src)) return;
    const a = arrs[si]!;
    for (let d = 0; d < a.length; d++) out[d]! += a[d]!;
  });
  return out;
}

export interface RateBreakdown {
  rate: number;
  /** Units sold over the averaged days (all sales points). */
  sold: number;
  /** Days averaged for the product: the window (60) or fewer when there is less history. */
  days: number;
  isNew: boolean;
  byChannel: Partial<Record<ChannelId, number>>;
  /** The rate's parts: sales points with the same number of recorded days, each averaged over those days. */
  parts: RatePart[];
}

export interface RatePart {
  /** Days averaged (the window, or fewer for sales points that joined the CRM later). */
  days: number;
  /** The latest start day among these sales points (null = all recorded through the whole window). */
  from: string | null;
  points: number;
  sold: number;
  rate: number;
}

/** The day a sales point began recording sales: its own first day (live data), else its channel's. */
export function sourceStart(ds: Dataset, s: Source): string | null {
  return s.dataFrom ?? ds.channels.find((c) => c.id === s.channel)?.dataFrom ?? null;
}

export interface SourceGroup {
  channel: ChannelId;
  /** The day these sales points began recording (null = never). */
  from: string | null;
  sources: number[];
}

/**
 * The picked sales points grouped by channel and the day they began recording. A clinic that joined the CRM
 * in October is measured from October: counting its earlier weeks as zero sales would understate its rate.
 */
export function sourceGroups(ds: Dataset, pick: (s: Source) => boolean): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  ds.sources.forEach((s, si) => {
    if (!pick(s)) return;
    const from = sourceStart(ds, s);
    const key = `${s.channel}|${from}`;
    const g = groups.get(key) ?? { channel: s.channel, from, sources: [] };
    g.sources.push(si);
    groups.set(key, g);
  });
  return [...groups.values()];
}

/** Days of data a group has for this product (the group's start or the product's launch, whichever is later). */
export function groupHistoryDays(ds: Dataset, p: Product, from: string | null): number {
  return from ? Math.min(historyDays(ds, p), Math.max(1, diffDays(ds.today, from) + 1)) : 0;
}

/**
 * Daily rate over the picked sources: per day = sales of the last 60 days ÷ 60 (rolling window), worked out for each
 * group of sales points over its own recorded days (a clinic that joined the CRM later is never averaged over
 * days before it joined), then added up.
 */
export function rateFor(ds: Dataset, settings: FormulaSettings, pi: number, pick: (s: Source) => boolean, kind: "sold" | "used"): RateBreakdown {
  const p = ds.products[pi]!;
  const out: RateBreakdown = { rate: 0, sold: 0, days: Math.min(settings.rateWindowDays, historyDays(ds, p)), isNew: historyDays(ds, p) < 30, byChannel: {}, parts: [] };
  const arrs = kind === "sold" ? ds.sold[pi]! : ds.used[pi]!;
  for (const g of sourceGroups(ds, pick)) {
    const hd = groupHistoryDays(ds, p, g.from);
    if (hd <= 0) continue;
    const series = new Array<number>(ds.days.length).fill(0);
    for (const si of g.sources) {
      const a = arrs[si]!;
      for (let d = 0; d < a.length; d++) series[d]! += a[d]!;
    }
    const r = dailyRate(series, settings, { historyDays: hd });
    out.rate += r.rate;
    out.sold += r.sold;
    if (r.sold) {
      const part = out.parts.find((x) => x.days === r.days);
      const from = r.days < out.days ? g.from : null;
      if (part) {
        part.points += g.sources.length;
        part.sold += r.sold;
        part.rate += r.rate;
        if (from && (!part.from || from > part.from)) part.from = from;
      } else out.parts.push({ days: r.days, from, points: g.sources.length, sold: r.sold, rate: r.rate });
    }
    if (r.rate) out.byChannel[g.channel] = Math.round(((out.byChannel[g.channel] ?? 0) + r.rate) * 10000) / 10000;
  }
  out.rate = Math.round(out.rate * 10000) / 10000;
  out.parts.sort((a, b) => b.days - a.days);
  return out;
}

/**
 * Can sales in `range` be compared with the period before it (starting `prevFrom`)? Only when the sales points
 * behind them were all recording by then — otherwise a "rise" is a clinic joining the CRM, not growth.
 * Points that make under 5% of the selected sales are ignored. `pi` narrows the check to one product.
 */
export function comparable(ds: Dataset, f: Filters, range: { from: string; to: string }, prevFrom: string, pi?: number): boolean {
  const mask = sourceMask(ds, f);
  const s = Math.max(0, diffDays(range.from, ds.days[0]!));
  const e = Math.min(ds.days.length - 1, diffDays(range.to, ds.days[0]!));
  let total = 0;
  let late = 0;
  const products = pi === undefined ? ds.products.map((_, i) => i) : [pi];
  ds.sources.forEach((src, si) => {
    if (!mask[si]) return;
    let v = 0;
    for (const p of products) {
      const a = ds.value[p]![si]!;
      for (let d = s; d <= e; d++) v += a[d]!;
    }
    total += v;
    const start = sourceStart(ds, src);
    if (!start || start > prevFrom) late += v;
  });
  return total <= 0 || late / total < 0.05;
}

export function channelRates(ds: Dataset, settings: FormulaSettings, pi: number): Record<ChannelId, number> {
  const out = zeroByChannel();
  for (const ch of CHANNEL_IDS) out[ch] = rateFor(ds, settings, pi, (s) => s.channel === ch, "sold").rate;
  return out;
}

/** Clinic-sales rate per CRM clinic (clinic channel only). */
export function clinicRates(ds: Dataset, settings: FormulaSettings, pi: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of ds.clinics) out[c.id] = rateFor(ds, settings, pi, (s) => s.channel === "clinic" && s.clinicId === c.id, "sold").rate;
  return out;
}

/** Average net ₹ per unit for a product in a channel over the last 90 days (catalogue price when nothing sold). */
export function avgUnitValue(ds: Dataset, pi: number, ch: ChannelId): number {
  let q = 0;
  let v = 0;
  const start = Math.max(0, ds.days.length - 90);
  ds.sources.forEach((src, si) => {
    if (src.channel !== ch) return;
    for (let d = start; d < ds.days.length; d++) {
      q += ds.sold[pi]![si]![d]!;
      v += ds.value[pi]![si]![d]!;
    }
  });
  return q > 0 ? v / q : ds.products[pi]!.price;
}

// ── network planning metrics (what to buy) ───────────────────────────────────

export interface ProductMetrics {
  product: Product;
  vendorName: string;
  leadTime: number;
  rate: number;
  /** Units used over the averaged days, and how many days (the 60-day window or less). */
  windowSold: number;
  windowDays: number;
  /** More than one entry when some sales points joined the CRM inside the window (each averaged over its own days). */
  rateParts: RatePart[];
  isNew: boolean;
  /** Usage rate split by channel. */
  rateByChannel: Partial<Record<ChannelId, number>>;
  trend: number;
  proj: Record<number, number>;
  stockByLocation: Record<string, number | null>;
  /** Sum of the locations that can be read. */
  stock: number;
  warehouseStock: number;
  clinicStock: number;
  /** Locations whose stock is unknown (Zoho refuses the read). */
  unknownLocations: string[];
  onOrder: number;
  openPOs: PurchaseOrder[];
  nextArrivalDays: number | null;
  cover: number;
  stockOut: string | null;
  /** Days of stock at which to order: 60, or the lead time when that is longer. */
  /** The product's purchase rule (from its regimen). */
  rule: PurchaseRule;
  reorderAt: number;
  reorderPoint: number;
  status: StockStatus;
  orderInDays: number | null;
  indentQty: number;
  indentRaw: number;
  /** The order is due now (stock + on the way at or below the reorder point). */
  indentDue: boolean;
  /** Safety stock in the order (units = rate × purchase safety days). */
  safety: number;
  /** Campaign and festival units over the order's window (lead time + cover days), and where they come from. */
  extraUnits: number;
  extraParts: ExtraPart[];
  /** Campaign and festival units over the next `days` days (for other lead times and cover periods). */
  extraFor: (days: number) => number;
  excess: number;
  /** Last 30 days of usage, every channel (for sparklines). */
  last30: number[];
}

export function leadTimeFor(ds: Dataset, p: Product, leadOverrides: Record<string, number> = {}): number {
  const vendor = ds.vendors.find((v) => v.id === p.vendorId);
  return leadOverrides[p.id] ?? p.leadTimeOverride ?? leadOverrides[`vendor:${p.vendorId}`] ?? vendor?.leadTimeDays ?? DEFAULT_LEAD_DAYS;
}

/** Extra units from applied campaigns and festivals for product `pi` between two days (Marketing impact). */
export type ExtraFn = (pi: number, from: string, to: string) => { units: number; parts: ExtraPart[] };

export function computeMetrics(ds: Dataset, settings: FormulaSettings, leadOverrides: Record<string, number> = {}, extraFn?: ExtraFn): ProductMetrics[] {
  const primary = primaryLocation(ds);
  return ds.products.map((p, pi) => {
    const all = () => true;
    const r = rateFor(ds, settings, pi, all, "used");
    const usedSeries = seriesFor(ds, pi, all, "used");
    const factor = settings.useTrendFactor ? trendFactor(usedSeries, settings.trendCapPct) : 1;
    const proj: Record<number, number> = {};
    for (const h of PROJECTION_HORIZONS) proj[h] = projection(r.rate, h, factor);
    const stockByLocation = ds.stock[p.id] ?? {};
    let stock = 0;
    const unknownLocations: string[] = [];
    for (const l of ds.locations) {
      const q = stockByLocation[l.id];
      if (q === null || q === undefined) {
        if (!l.readable || q === null) unknownLocations.push(l.id);
      } else stock += q;
    }
    const warehouseStock = stockByLocation[primary.id] ?? 0;
    const openPOs = ds.purchaseOrders.filter((po) => po.productId === p.id);
    const onOrder = openPOs.reduce((a, po) => a + po.qty, 0);
    const nextArrivalDays = openPOs.length ? Math.min(...openPOs.map((po) => diffDays(po.expectedOn, ds.today))) : null;
    const leadTime = leadTimeFor(ds, p, leadOverrides);
    const cover = daysOfCover(stock, r.rate);
    const out = stockOutDate(parseDay(ds.today), cover);
    const extraFor = (days: number) => (extraFn && days > 0 ? extraFn(pi, ds.today, addDays(ds.today, days - 1)).units : 0);
    // the product's own rule, from its regimen (Night 150 → 180, Day / Wellness 120 → 150, else the general rule)
    const rule = purchaseRule(p.segment, settings);
    const window = extraFn ? extraFn(pi, ds.today, addDays(ds.today, leadTime + rule.coverDays - 1)) : { units: 0, parts: [] };
    const indent = indentQuantity({
      rate: r.rate,
      leadTime,
      coverDays: rule.coverDays,
      safetyDays: rule.safetyDays,
      reorderAtDays: rule.reorderAtDays,
      stock,
      onOrder,
      packSize: p.packSize,
      extraUnits: window.units,
    });
    return {
      product: p,
      vendorName: ds.vendors.find((v) => v.id === p.vendorId)?.name ?? "—",
      leadTime,
      rate: r.rate,
      windowSold: r.sold,
      windowDays: r.days,
      rateParts: r.parts,
      isNew: r.isNew,
      rateByChannel: r.byChannel,
      trend: factor,
      proj,
      stockByLocation,
      stock,
      warehouseStock: warehouseStock ?? 0,
      clinicStock: stock - (warehouseStock ?? 0),
      unknownLocations,
      onOrder,
      openPOs,
      nextArrivalDays,
      cover,
      stockOut: out ? out.toISOString().slice(0, 10) : null,
      rule,
      reorderAt: orderTriggerDays(rule.reorderAtDays, leadTime),
      reorderPoint: reorderPoint(r.rate, rule.reorderAtDays, leadTime),
      status: stockStatus({ stock, onOrder, nextArrivalDays, rate: r.rate, leadTime, reorderAtDays: rule.reorderAtDays, overstockDays: settings.overstockDays, extraUnits: window.units }),
      orderInDays: daysUntilOrder(stock, onOrder, r.rate, rule.reorderAtDays, leadTime, window.units),
      indentQty: indent.qty,
      indentRaw: indent.raw,
      indentDue: indent.due,
      safety: indent.safety,
      extraUnits: window.units,
      extraParts: window.parts,
      extraFor,
      excess: excessUnits(stock, r.rate, settings.overstockDays),
      last30: usedSeries.slice(-30),
    };
  });
}

// ── per-location view (what each place holds and uses) ───────────────────────

export interface LocationRow {
  location: Location;
  /** null = Zoho refuses the read. */
  stock: number | null;
  /** Usage rate of every source that ships from this location. */
  rate: number;
  byChannel: Partial<Record<ChannelId, number>>;
  cover: number | null;
  /** "unknown" when the stock cannot be read. */
  status: StockStatus | "unknown";
}

export function locationBreakdown(ds: Dataset, settings: FormulaSettings, pi: number, m: ProductMetrics): LocationRow[] {
  return ds.locations.map((l) => {
    const r = rateFor(ds, settings, pi, (s) => s.locationId === l.id, "used");
    const q = m.stockByLocation[l.id];
    const stock = q === undefined ? (l.readable ? 0 : null) : q;
    if (stock === null) return { location: l, stock: null, rate: r.rate, byChannel: r.byChannel, cover: null, status: "unknown" };
    const lead = l.isPrimary ? m.leadTime : settings.replenishLeadDays;
    return {
      location: l,
      stock,
      rate: r.rate,
      byChannel: r.byChannel,
      cover: daysOfCover(stock, r.rate),
      // the warehouse orders from vendors by the purchase rule; a clinic is topped up below lead + safety days
      status: stockStatus({ stock, onOrder: 0, nextArrivalDays: null, rate: r.rate, leadTime: lead, reorderAtDays: l.isPrimary ? m.rule.reorderAtDays : lead + settings.safetyDays, overstockDays: settings.overstockDays }),
    };
  });
}

export interface SendSuggestion {
  product: Product;
  to: Location;
  qty: number;
  toStock: number;
  toCover: number;
  rate: number;
  /** false = the warehouse does not hold enough to send the full quantity. */
  covered: boolean;
}

/**
 * Send to clinics: a location below its reorder point (usage × (send lead + safety days)) is topped up
 * to usage × (send lead + cover + safety days) from the primary warehouse, most urgent first.
 */
export function sendToClinics(ds: Dataset, settings: FormulaSettings, metrics: ProductMetrics[]): SendSuggestion[] {
  const primary = primaryLocation(ds);
  const out: SendSuggestion[] = [];
  ds.products.forEach((p, pi) => {
    const m = metrics[pi]!;
    let available = m.stockByLocation[primary.id] ?? 0;
    const rows = locationBreakdown(ds, settings, pi, m)
      .filter((r) => !r.location.isPrimary && r.stock !== null && r.rate > 0)
      .filter((r) => (r.stock ?? 0) < r.rate * (settings.replenishLeadDays + settings.safetyDays))
      .sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
    for (const r of rows) {
      const target = r.rate * (settings.replenishLeadDays + settings.replenishCoverDays + settings.safetyDays);
      const need = Math.ceil(target - (r.stock ?? 0));
      if (need <= 0) continue;
      const qty = Math.min(need, Math.max(0, Math.floor(available)));
      available -= qty;
      out.push({ product: p, to: r.location, qty: qty > 0 ? qty : need, toStock: r.stock ?? 0, toCover: r.cover ?? 0, rate: r.rate, covered: qty >= need });
    }
  });
  return out.sort((a, b) => a.toCover - b.toCover);
}

export interface ProductTransfer extends TransferSuggestion {
  product: Product;
}

/**
 * Clinic-to-clinic moves (readable clinic locations, by each location's own usage) — suggested only for
 * products the warehouse cannot cover itself; otherwise sending from Mohali is the normal route.
 */
export function allTransfers(ds: Dataset, settings: FormulaSettings, metrics: ProductMetrics[]): ProductTransfer[] {
  const short = new Set(sendToClinics(ds, settings, metrics).filter((x) => !x.covered).map((x) => x.product.id));
  const out: ProductTransfer[] = [];
  ds.products.forEach((p, pi) => {
    if (!short.has(p.id)) return;
    const rows = locationBreakdown(ds, settings, pi, metrics[pi]!).filter((r) => r.location.kind === "clinic" && r.stock !== null);
    const clinics = rows.map((r) => ({ locationId: r.location.id, rate: r.rate, stock: r.stock ?? 0 }));
    for (const t of transferSuggestions(clinics, settings.transferHighDays, settings.transferLowDays)) out.push({ ...t, product: p });
  });
  return out;
}

/** Projected units (sales) per channel for a horizon, summed over the given products. */
export function projectionByChannel(ds: Dataset, settings: FormulaSettings, horizon: number, productIds?: Set<string>): Record<ChannelId, number> {
  const out = zeroByChannel();
  ds.products.forEach((p, pi) => {
    if (productIds && !productIds.has(p.id)) return;
    const rates = channelRates(ds, settings, pi);
    const factor = settings.useTrendFactor ? trendFactor(seriesFor(ds, pi, () => true, "sold"), settings.trendCapPct) : 1;
    for (const ch of CHANNEL_IDS) out[ch] += projection(rates[ch], horizon, factor);
  });
  return out;
}

export function projectionValueByChannel(ds: Dataset, settings: FormulaSettings, horizon: number, productIds?: Set<string>): Record<ChannelId, number> {
  const out = zeroByChannel();
  ds.products.forEach((p, pi) => {
    if (productIds && !productIds.has(p.id)) return;
    const rates = channelRates(ds, settings, pi);
    const factor = settings.useTrendFactor ? trendFactor(seriesFor(ds, pi, () => true, "sold"), settings.trendCapPct) : 1;
    for (const ch of CHANNEL_IDS) if (rates[ch]) out[ch] += projection(rates[ch], horizon, factor) * avgUnitValue(ds, pi, ch);
  });
  return out;
}

export const STATUS_ORDER: StockStatus[] = ["critical", "low", "healthy", "overstock", "no_sales"];

export function urgency(m: ProductMetrics): number {
  const rank = { critical: 0, low: 1, overstock: 2, healthy: 3, no_sales: 4 }[m.status];
  return rank * 10000 + (Number.isFinite(m.cover) ? m.cover : 9999);
}

// ---------------------------------------------------------------------------------------------------------------
// Total inventory value (decided 20 Nov 2026, Purchase): the working capital sitting in stock, at purchase cost.
// = Mohali warehouse + every clinic (+ darkstores) + unused bottles. Stock below zero counts as 0; a location the
// Zoho login cannot read is left out and named. A product whose Zoho purchase price is missing is valued at the
// cost fallback (a share of its selling price): that part is reported as an estimate.

export interface InventoryValue {
  total: number;
  byKind: Record<LocationKind, number>;
  /** Locations counted per kind. */
  counted: Record<LocationKind, number>;
  bottles: number;
  /** Locations left out because Zoho cannot read them. */
  unreadable: string[];
  /** Part of the stock value that uses an estimated cost, and how many products that is (of how many). */
  estimated: number;
  estimatedProducts: number;
  products: number;
  units: number;
  bySegment: { segment: Segment | "none"; value: number; units: number; products: number }[];
}

export function inventoryValue(ds: Dataset, products: Product[], bottleValue: number): InventoryValue {
  const byKind: Record<LocationKind, number> = { warehouse: 0, clinic: 0, darkstore: 0 };
  const counted: Record<LocationKind, number> = { warehouse: 0, clinic: 0, darkstore: 0 };
  const readable = ds.locations.filter((l) => l.readable);
  for (const l of readable) counted[l.kind] += 1;
  const seg = new Map<Segment | "none", { value: number; units: number; products: number }>();
  let estimated = 0;
  let estimatedProducts = 0;
  let units = 0;
  for (const p of products) {
    let pv = 0;
    let pu = 0;
    for (const l of readable) {
      const q = Math.max(0, ds.stock[p.id]?.[l.id] ?? 0);
      byKind[l.kind] += q * p.cost;
      pv += q * p.cost;
      pu += q;
    }
    units += pu;
    if (p.costEstimated) {
      estimated += pv;
      estimatedProducts += 1;
    }
    const key = p.segment ?? "none";
    const cur = seg.get(key) ?? { value: 0, units: 0, products: 0 };
    seg.set(key, { value: cur.value + pv, units: cur.units + pu, products: cur.products + 1 });
  }
  const order: (Segment | "none")[] = ["day", "night", "wellness", "none"];
  const bottles = Math.max(0, bottleValue);
  return {
    total: byKind.warehouse + byKind.clinic + byKind.darkstore + bottles,
    byKind,
    counted,
    bottles,
    unreadable: ds.locations.filter((l) => !l.readable).map((l) => l.name),
    estimated,
    estimatedProducts,
    products: products.length,
    units,
    // Day, Night and Wellness always show (₹0 until Zoho's Type Regimen is filled in); "not set" only when it has products
    bySegment: order.filter((k) => k !== "none" || seg.has(k)).map((k) => ({ segment: k, ...(seg.get(k) ?? { value: 0, units: 0, products: 0 }) })),
  };
}
