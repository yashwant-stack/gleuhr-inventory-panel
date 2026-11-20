// Marketing impact (decided 20 Nov 2026): campaigns and festival surges that raise the demand behind Order now.
// A campaign's extra units = the product's usage per day in the targeted channels / clinics × its days inside the
// window × the uplift % of the chosen scenario. A festival's = the product's usage per day (all channels) × its days
// inside the window × the surge %. Uplift is entered by hand: ad spend does not turn into sales by a formula.
import { addDays, diffDays } from "../dates";
import { indentQuantity } from "../domain/formulas";
import type { ChannelId, FormulaSettings, Product, Segment } from "../domain/types";
import { rateFor, type ProductMetrics } from "./engine";
import type { Dataset, Source } from "./model";

export type Scenario = "conservative" | "expected" | "aggressive";
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "conservative", label: "Conservative" },
  { id: "expected", label: "Expected" },
  { id: "aggressive", label: "Aggressive" },
];

export interface Campaign {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Ad spend (₹). Shown next to the extra sales; it does not drive the uplift. */
  budget: number;
  /** Products in this segment ("all" = every segment), unless products are picked by hand. */
  segment: Segment | "all";
  productIds: string[];
  /** Channels targeted (empty = all). */
  channels: ChannelId[];
  /** Clinics targeted when the clinic channel is in (empty = all clinics). */
  clinicIds: string[];
  uplift: Record<Scenario, number>;
  scenario: Scenario;
  /** Only applied campaigns change Order now. */
  applied: boolean;
}

export interface Festival {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Extra demand during the festival, % of normal. */
  surgePct: number;
  segment: Segment | "all";
  applied: boolean;
}

export interface DemandEvents {
  campaigns: Campaign[];
  festivals: Festival[];
}

export interface ExtraPart {
  kind: "campaign" | "festival";
  id: string;
  name: string;
  /** Days of the event inside the window. */
  days: number;
  pct: number;
  units: number;
}

/** Days of [from, to] inside [winFrom, winTo], both ends included. */
export function overlapDays(from: string, to: string, winFrom: string, winTo: string): number {
  const a = from > winFrom ? from : winFrom;
  const b = to < winTo ? to : winTo;
  return b < a ? 0 : diffDays(b, a) + 1;
}

export function targets(p: Product, segment: Segment | "all", productIds: string[]): boolean {
  if (productIds.length) return productIds.includes(p.id);
  return segment === "all" || p.segment === segment;
}

export function campaignPick(c: Campaign): (s: Source) => boolean {
  return (s) => (c.channels.length === 0 || c.channels.includes(s.channel)) && (s.channel !== "clinic" || c.clinicIds.length === 0 || c.clinicIds.includes(s.clinicId ?? ""));
}

/**
 * Extra units for product `pi` from the events inside [from, to]. Only applied events count, unless `all` is set
 * (the Marketing impact page previews a campaign before it is applied). `scenario` overrides each campaign's own.
 */
export function eventExtra(
  ds: Dataset,
  settings: FormulaSettings,
  pi: number,
  ev: DemandEvents,
  from: string,
  to: string,
  opts: { all?: boolean; scenario?: Scenario } = {},
): { units: number; parts: ExtraPart[] } {
  const p = ds.products[pi]!;
  const parts: ExtraPart[] = [];
  for (const c of ev.campaigns) {
    if ((!c.applied && !opts.all) || !targets(p, c.segment, c.productIds)) continue;
    const days = overlapDays(c.from, c.to, from, to);
    if (!days) continue;
    const pct = c.uplift[opts.scenario ?? c.scenario] ?? 0;
    const rate = rateFor(ds, settings, pi, campaignPick(c), "used").rate;
    const units = (rate * days * pct) / 100;
    if (units > 0) parts.push({ kind: "campaign", id: c.id, name: c.name, days, pct, units });
  }
  let total: number | null = null;
  for (const f of ev.festivals) {
    if ((!f.applied && !opts.all) || !targets(p, f.segment, [])) continue;
    const days = overlapDays(f.from, f.to, from, to);
    if (!days) continue;
    total ??= rateFor(ds, settings, pi, () => true, "used").rate;
    const units = (total * days * f.surgePct) / 100;
    if (units > 0) parts.push({ kind: "festival", id: f.id, name: f.name, days, pct: f.surgePct, units });
  }
  return { units: Math.round(parts.reduce((a, x) => a + x.units, 0) * 100) / 100, parts };
}

export const NO_EVENTS: DemandEvents = { campaigns: [], festivals: [] };

// ---------------------------------------------------------------------------------------------------------------
// The impact of one campaign or festival, as the Marketing impact page shows it before (and after) it is applied.

export interface ImpactRow {
  product: Product;
  /** Units the targeted channels use over the event's days at today's pace. */
  normal: number;
  /** Extra units the event adds over its days. */
  extra: number;
  /** Order now without this event, and with it (rounded up to the pack). */
  orderWithout: number;
  orderWith: number;
}

export interface ImpactTotals {
  normal: number;
  extra: number;
  /** Units the event adds to Order now. */
  addedOrder: number;
  addedOrderCost: number;
  /** Extra units × selling price. */
  extraSales: number;
}

/**
 * One event's impact. Its extra units over its own days come from eventExtra; what it adds to Order now is the
 * order with it minus the order without it, both over the same window Order now uses (today to lead + cover days),
 * every other applied event included in both.
 */
export function eventImpact(
  ds: Dataset,
  settings: FormulaSettings,
  metrics: ProductMetrics[],
  one: { campaign?: Campaign; festival?: Festival },
  scenario?: Scenario,
): { rows: ImpactRow[]; totals: ImpactTotals } {
  const ev: DemandEvents = { campaigns: one.campaign ? [one.campaign] : [], festivals: one.festival ? [one.festival] : [] };
  const e = (one.campaign ?? one.festival)!;
  const applied = e.applied;
  const ownScenario = one.campaign?.scenario;
  const pct = one.campaign ? one.campaign.uplift[scenario ?? one.campaign.scenario] ?? 0 : one.festival!.surgePct;
  const eventDays = Math.max(0, diffDays(e.to, e.from) + 1);
  const index = new Map(ds.products.map((p, i) => [p.id, i]));
  const rows: ImpactRow[] = [];
  for (const m of metrics) {
    const pi = index.get(m.product.id);
    if (pi === undefined) continue;
    if (one.campaign ? !targets(m.product, one.campaign.segment, one.campaign.productIds) : !targets(m.product, one.festival!.segment, [])) continue;
    const rate = rateFor(ds, settings, pi, one.campaign ? campaignPick(one.campaign) : () => true, "used").rate;
    const normal = rate * eventDays;
    const extra = (normal * pct) / 100;
    const winDays = m.leadTime + m.rule.coverDays;
    const winTo = addDays(ds.today, winDays - 1);
    const mine = eventExtra(ds, settings, pi, ev, ds.today, winTo, { all: true, scenario }).units;
    const mineNow = applied ? eventExtra(ds, settings, pi, ev, ds.today, winTo, { scenario: ownScenario }).units : 0;
    const others = Math.max(0, m.extraFor(winDays) - mineNow);
    const order = (extraUnits: number) =>
      indentQuantity({ rate: m.rate, leadTime: m.leadTime, coverDays: m.rule.coverDays, safetyDays: m.rule.safetyDays, reorderAtDays: m.rule.reorderAtDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize, extraUnits }).qty;
    rows.push({ product: m.product, normal, extra, orderWithout: order(others), orderWith: order(others + mine) });
  }
  const totals = rows.reduce<ImpactTotals>(
    (a, r) => ({
      normal: a.normal + r.normal,
      extra: a.extra + r.extra,
      addedOrder: a.addedOrder + (r.orderWith - r.orderWithout),
      addedOrderCost: a.addedOrderCost + (r.orderWith - r.orderWithout) * r.product.cost,
      extraSales: a.extraSales + r.extra * r.product.price,
    }),
    { normal: 0, extra: 0, addedOrder: 0, addedOrderCost: 0, extraSales: 0 },
  );
  return { rows, totals };
}
