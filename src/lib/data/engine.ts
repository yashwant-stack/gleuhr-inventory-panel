// Turns the dataset + settings + filters into the numbers every screen shows.
// Screens never compute business numbers themselves; they call these functions,
// which call the decided formulas in lib/domain. When the backend arrives, this file's
// inputs come from the API instead of the sample dataset; its outputs stay the same.

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
import type { ChannelId, FormulaSettings, Product, PurchaseOrder, StockStatus } from "../domain/types";
import { PROJECTION_HORIZONS } from "../domain/types";
import { CHANNELS, WAREHOUSE_ID } from "../mock/catalog";
import type { Dataset } from "../mock/dataset";

export interface Filters {
  from: string;
  to: string;
  channels: ChannelId[];
  locations: string[];
  categories: string[];
  search: string;
}

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
const PRICE_FACTOR: Record<ChannelId, number> = Object.fromEntries(CHANNELS.map((c) => [c.id, c.priceFactor])) as Record<ChannelId, number>;

export function unitValue(product: Product, channel: ChannelId): number {
  return product.price * PRICE_FACTOR[channel];
}

// ── filters → which sources / products count ──────────────────────────────────

export function sourceMask(ds: Dataset, f: Pick<Filters, "channels" | "locations">): boolean[] {
  return ds.sources.map(
    (s) => (f.channels.length === 0 || f.channels.includes(s.channel)) && (f.locations.length === 0 || f.locations.includes(s.locationId)),
  );
}

export function productMatches(p: Product, f: Pick<Filters, "categories" | "search">): boolean {
  if (f.categories.length > 0 && !f.categories.includes(p.category)) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
  return true;
}

/** Clamp a date range to the data we hold; returns day indexes [start, end] inclusive. */
export function rangeIndexes(ds: Dataset, from: string, to: string): [number, number] {
  const first = ds.days[0]!;
  const start = Math.max(0, diffDays(from, first));
  const end = Math.min(ds.days.length - 1, diffDays(to, first));
  return [start, end];
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
  /** By source id (each clinic + each online channel). */
  bySource: Record<string, number>;
}

function emptyChannels(): Record<ChannelId, { qty: number; value: number }> {
  return Object.fromEntries(CHANNEL_IDS.map((c) => [c, { qty: 0, value: 0 }])) as Record<ChannelId, { qty: number; value: number }>;
}

export function salesByProduct(ds: Dataset, f: Filters, range?: { from: string; to: string }): ProductSales[] {
  const [s, e] = rangeIndexes(ds, range?.from ?? f.from, range?.to ?? f.to);
  const mask = sourceMask(ds, f);
  const out: ProductSales[] = [];
  ds.products.forEach((p, pi) => {
    if (!productMatches(p, f)) return;
    const byChannel = emptyChannels();
    const bySource: Record<string, number> = {};
    let qty = 0;
    let value = 0;
    ds.sources.forEach((src, si) => {
      if (!mask[si]) return;
      const arr = ds.qty[pi]![si]!;
      let q = 0;
      for (let d = s; d <= e; d++) q += arr[d]!;
      if (q === 0) return;
      const v = q * unitValue(p, src.channel);
      byChannel[src.channel].qty += q;
      byChannel[src.channel].value += v;
      bySource[src.id] = (bySource[src.id] ?? 0) + q;
      qty += q;
      value += v;
    });
    out.push({ product: p, qty, value, byChannel, bySource });
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
  const zero = () => Object.fromEntries(CHANNEL_IDS.map((c) => [c, 0])) as Record<ChannelId, number>;
  for (let d = s; d <= e; d++) points.push({ day: ds.days[d]!, total: 0, totalValue: 0, byChannel: zero(), byChannelValue: zero() });
  ds.products.forEach((p, pi) => {
    if (productIds ? !productIds.includes(p.id) : !productMatches(p, f)) return;
    ds.sources.forEach((src, si) => {
      if (!mask[si]) return;
      const arr = ds.qty[pi]![si]!;
      const uv = unitValue(p, src.channel);
      for (let d = s; d <= e; d++) {
        const q = arr[d]!;
        if (!q) continue;
        const pt = points[d - s]!;
        pt.total += q;
        pt.totalValue += q * uv;
        pt.byChannel[src.channel] += q;
        pt.byChannelValue[src.channel] += q * uv;
      }
    });
  });
  return points;
}

// ── per-product planning metrics (always "as of today", every channel) ────────

export interface ProductMetrics {
  product: Product;
  vendorName: string;
  leadTime: number;
  rate: number;
  avg7: number;
  avg30: number;
  avg90: number;
  isNew: boolean;
  trend: number;
  /** Projected units for 7/15/30/60/90 days (trend factor applied when switched on). */
  proj: Record<number, number>;
  stockByLocation: Record<string, number>;
  stock: number;
  warehouseStock: number;
  clinicStock: number;
  onOrder: number;
  openPOs: PurchaseOrder[];
  nextArrivalDays: number | null;
  cover: number;
  stockOut: string | null;
  reorderPoint: number;
  status: StockStatus;
  /** Days until the order should be placed (0 = now). */
  orderInDays: number | null;
  /** Indent for the default cover period. */
  indentQty: number;
  indentRaw: number;
  safety: number;
  excess: number;
  /** Last 30 days of units, every channel (for sparklines). */
  last30: number[];
}

export function totalSeries(ds: Dataset, pi: number, channels?: ChannelId[]): number[] {
  const out = new Array<number>(ds.days.length).fill(0);
  ds.sources.forEach((src, si) => {
    if (channels && !channels.includes(src.channel)) return;
    const arr = ds.qty[pi]![si]!;
    for (let d = 0; d < arr.length; d++) out[d]! += arr[d]!;
  });
  return out;
}

export function sourceSeries(ds: Dataset, pi: number, sourceIndex: number): Uint16Array {
  return ds.qty[pi]![sourceIndex]!;
}

export function historyDays(ds: Dataset, p: Product): number {
  return Math.max(1, diffDays(ds.today, p.launchedOn) + 1);
}

export function leadTimeFor(ds: Dataset, p: Product, leadOverrides: Record<string, number> = {}): number {
  const vendor = ds.vendors.find((v) => v.id === p.vendorId);
  return leadOverrides[p.id] ?? p.leadTimeOverride ?? leadOverrides[`vendor:${p.vendorId}`] ?? vendor?.leadTimeDays ?? 15;
}

export function computeMetrics(ds: Dataset, settings: FormulaSettings, leadOverrides: Record<string, number> = {}): ProductMetrics[] {
  return ds.products.map((p, pi) => {
    const series = totalSeries(ds, pi);
    const r = dailyRate(series, settings, { inStock: ds.inStock[pi], historyDays: historyDays(ds, p) });
    const factor = settings.useTrendFactor ? trendFactor(series, settings.trendCapPct) : 1;
    const proj: Record<number, number> = {};
    for (const h of PROJECTION_HORIZONS) proj[h] = projection(r.rate, h, factor);
    const stockByLocation = ds.stock[p.id] ?? {};
    const stock = Object.values(stockByLocation).reduce((a, b) => a + b, 0);
    const warehouseStock = stockByLocation[WAREHOUSE_ID] ?? 0;
    const openPOs = ds.purchaseOrders.filter((po) => po.productId === p.id);
    const onOrder = openPOs.reduce((a, po) => a + po.qty, 0);
    const nextArrivalDays = openPOs.length ? Math.min(...openPOs.map((po) => diffDays(po.expectedOn, ds.today))) : null;
    const leadTime = leadTimeFor(ds, p, leadOverrides);
    const cover = daysOfCover(stock, r.rate);
    const out = stockOutDate(parseDay(ds.today), cover);
    const indent = indentQuantity({
      rate: r.rate,
      leadTime,
      coverDays: settings.defaultCoverDays,
      safetyDays: settings.safetyDays,
      stock,
      onOrder,
      packSize: p.packSize,
    });
    return {
      product: p,
      vendorName: ds.vendors.find((v) => v.id === p.vendorId)?.name ?? "—",
      leadTime,
      rate: r.rate,
      avg7: r.avg7,
      avg30: r.avg30,
      avg90: r.avg90,
      isNew: r.isNew,
      trend: factor,
      proj,
      stockByLocation,
      stock,
      warehouseStock,
      clinicStock: stock - warehouseStock,
      onOrder,
      openPOs,
      nextArrivalDays,
      cover,
      stockOut: out ? out.toISOString().slice(0, 10) : null,
      reorderPoint: reorderPoint(r.rate, leadTime, settings.safetyDays),
      status: stockStatus({
        stock,
        onOrder,
        nextArrivalDays,
        rate: r.rate,
        leadTime,
        safetyDays: settings.safetyDays,
        overstockDays: settings.overstockDays,
      }),
      orderInDays: daysUntilOrder(stock, onOrder, r.rate, leadTime, settings.safetyDays),
      indentQty: indent.qty,
      indentRaw: indent.raw,
      safety: indent.safety,
      excess: excessUnits(stock, r.rate, settings.overstockDays),
      last30: series.slice(-30),
    };
  });
}

/** Daily rate per channel for one product (for channel-level projections). */
export function channelRates(ds: Dataset, settings: FormulaSettings, pi: number): Record<ChannelId, number> {
  const p = ds.products[pi]!;
  const out = {} as Record<ChannelId, number>;
  for (const ch of CHANNEL_IDS) {
    const series = totalSeries(ds, pi, [ch]);
    out[ch] = dailyRate(series, settings, { inStock: ds.inStock[pi], historyDays: historyDays(ds, p) }).rate;
  }
  return out;
}

/** Daily rate per clinic for one product. */
export function clinicRates(ds: Dataset, settings: FormulaSettings, pi: number): Record<string, number> {
  const p = ds.products[pi]!;
  const out: Record<string, number> = {};
  ds.sources.forEach((src, si) => {
    if (src.channel !== "clinic") return;
    out[src.locationId] = dailyRate(sourceSeries(ds, pi, si), settings, { inStock: ds.inStock[pi], historyDays: historyDays(ds, p) }).rate;
  });
  return out;
}

export interface ProductTransfer extends TransferSuggestion {
  product: Product;
}

export function allTransfers(ds: Dataset, settings: FormulaSettings): ProductTransfer[] {
  const out: ProductTransfer[] = [];
  ds.products.forEach((p, pi) => {
    const rates = clinicRates(ds, settings, pi);
    const clinics = Object.entries(rates).map(([locationId, rate]) => ({ locationId, rate, stock: ds.stock[p.id]?.[locationId] ?? 0 }));
    for (const t of transferSuggestions(clinics, settings.transferHighDays, settings.transferLowDays)) out.push({ ...t, product: p });
  });
  return out;
}

/** Projected units per channel for a horizon, summed over the given products. */
export function projectionByChannel(ds: Dataset, settings: FormulaSettings, horizon: number, productIds?: Set<string>): Record<ChannelId, number> {
  const out = Object.fromEntries(CHANNEL_IDS.map((c) => [c, 0])) as Record<ChannelId, number>;
  ds.products.forEach((p, pi) => {
    if (productIds && !productIds.has(p.id)) return;
    const rates = channelRates(ds, settings, pi);
    const factor = settings.useTrendFactor ? trendFactor(totalSeries(ds, pi), settings.trendCapPct) : 1;
    for (const ch of CHANNEL_IDS) out[ch] += projection(rates[ch], horizon, factor);
  });
  return out;
}

export function projectionValueByChannel(ds: Dataset, settings: FormulaSettings, horizon: number, productIds?: Set<string>): Record<ChannelId, number> {
  const out = Object.fromEntries(CHANNEL_IDS.map((c) => [c, 0])) as Record<ChannelId, number>;
  ds.products.forEach((p, pi) => {
    if (productIds && !productIds.has(p.id)) return;
    const rates = channelRates(ds, settings, pi);
    const factor = settings.useTrendFactor ? trendFactor(totalSeries(ds, pi), settings.trendCapPct) : 1;
    for (const ch of CHANNEL_IDS) out[ch] += projection(rates[ch], horizon, factor) * unitValue(p, ch);
  });
  return out;
}

export const STATUS_ORDER: StockStatus[] = ["critical", "low", "healthy", "overstock", "no_sales"];

export function urgency(m: ProductMetrics): number {
  const rank = { critical: 0, low: 1, overstock: 2, healthy: 3, no_sales: 4 }[m.status];
  return rank * 10000 + (Number.isFinite(m.cover) ? m.cover : 9999);
}
