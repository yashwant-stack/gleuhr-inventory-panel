// Turns the dataset + settings + filters into the numbers every screen shows.
// Screens never compute business numbers themselves; they call these functions, which call the
// decided formulas in lib/domain. The same code runs on the server for alerts.
//
// SALES are read per channel (sold / value). STOCK planning uses USAGE (sold + free samples +
// exchanges) per Zoho location: a location's usage is the sum of every source that ships from it.
// Each channel's daily rate is worked out over that channel's own history, then added up, so a
// channel whose data starts later (clinic sales from 28 Aug) never drags the average down.

import { addDays, diffDays, parseDay } from "../dates";
import {
  dailyRate,
  daysOfCover,
  daysUntilOrder,
  excessUnits,
  indentQuantity,
  projection,
  reorderPoint,
  stockOutDate,
  stockStatus,
  trendFactor,
  transferSuggestions,
  type TransferSuggestion,
} from "../domain/formulas";
import type { ChannelId, FormulaSettings, Location, Product, PurchaseOrder, StockStatus } from "../domain/types";
import { PROJECTION_HORIZONS } from "../domain/types";
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

export function productMatches(p: Product, f: Pick<Filters, "categories" | "search">): boolean {
  if (f.categories.length > 0 && !f.categories.includes(p.category)) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
  return true;
}

/** Clamp a date range to the data held; returns day indexes [start, end] inclusive. */
export function rangeIndexes(ds: Dataset, from: string, to: string): [number, number] {
  const first = ds.days[0]!;
  return [Math.max(0, diffDays(from, first)), Math.min(ds.days.length - 1, diffDays(to, first))];
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
  avg7: number;
  avg30: number;
  avg90: number;
  isNew: boolean;
  byChannel: Partial<Record<ChannelId, number>>;
}

/** Daily rate over the picked sources: each channel over its own history, then added up. */
export function rateFor(ds: Dataset, settings: FormulaSettings, pi: number, pick: (s: Source) => boolean, kind: "sold" | "used"): RateBreakdown {
  const p = ds.products[pi]!;
  const out: RateBreakdown = { rate: 0, avg7: 0, avg30: 0, avg90: 0, isNew: historyDays(ds, p) < 30, byChannel: {} };
  for (const ch of CHANNEL_IDS) {
    if (!ds.sources.some((s) => s.channel === ch && pick(s))) continue;
    const hd = channelHistoryDays(ds, p, ch);
    if (hd <= 0) continue;
    const r = dailyRate(seriesFor(ds, pi, (s) => s.channel === ch && pick(s), kind), settings, { inStock: ds.inStock?.[pi], historyDays: hd });
    out.rate += r.rate;
    out.avg7 += r.avg7;
    out.avg30 += r.avg30;
    out.avg90 += r.avg90;
    if (r.rate) out.byChannel[ch] = r.rate;
  }
  out.rate = Math.round(out.rate * 10000) / 10000;
  return out;
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
  avg7: number;
  avg30: number;
  avg90: number;
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
  reorderPoint: number;
  status: StockStatus;
  orderInDays: number | null;
  indentQty: number;
  indentRaw: number;
  safety: number;
  excess: number;
  /** Last 30 days of usage, every channel (for sparklines). */
  last30: number[];
}

export function leadTimeFor(ds: Dataset, p: Product, leadOverrides: Record<string, number> = {}): number {
  const vendor = ds.vendors.find((v) => v.id === p.vendorId);
  return leadOverrides[p.id] ?? p.leadTimeOverride ?? leadOverrides[`vendor:${p.vendorId}`] ?? vendor?.leadTimeDays ?? 15;
}

export function computeMetrics(ds: Dataset, settings: FormulaSettings, leadOverrides: Record<string, number> = {}): ProductMetrics[] {
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
    const indent = indentQuantity({ rate: r.rate, leadTime, coverDays: settings.defaultCoverDays, safetyDays: settings.safetyDays, stock, onOrder, packSize: p.packSize });
    return {
      product: p,
      vendorName: ds.vendors.find((v) => v.id === p.vendorId)?.name ?? "—",
      leadTime,
      rate: r.rate,
      avg7: r.avg7,
      avg30: r.avg30,
      avg90: r.avg90,
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
      reorderPoint: reorderPoint(r.rate, leadTime, settings.safetyDays),
      status: stockStatus({ stock, onOrder, nextArrivalDays, rate: r.rate, leadTime, safetyDays: settings.safetyDays, overstockDays: settings.overstockDays }),
      orderInDays: daysUntilOrder(stock, onOrder, r.rate, leadTime, settings.safetyDays),
      indentQty: indent.qty,
      indentRaw: indent.raw,
      safety: indent.safety,
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
      status: stockStatus({ stock, onOrder: 0, nextArrivalDays: null, rate: r.rate, leadTime: lead, safetyDays: settings.safetyDays, overstockDays: settings.overstockDays }),
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
