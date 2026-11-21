// Planning: the auto-filled current trend, the system's projection for a plan period,
// seed submissions, consolidation (system + trend + team plans) and stock readiness.

import { addDays, diffDays } from "../dates";
import { dailyRate, gapPct, isGapFlagged, projection } from "../domain/formulas";
import type { ChannelId, FormulaSettings, Product } from "../domain/types";
import { CYCLES, SEED_SUBMISSIONS, type PlanCycle } from "../mock/plans";
import type { PlanPart, RoleId } from "../roles";
import { avgUnitValue, CHANNEL_IDS, groupHistoryDays, rateFor, sourceGroups, type ProductMetrics } from "./engine";
import { connectedChannels, type Dataset, type Source } from "./model";

/** One product inside a plan line (the marketing plan is planned product by product). */
export interface PlanProductLine {
  productId: string;
  systemUnits: number;
  plannedUnits: number;
  /** Ad budget on this product in this channel (₹). */
  budget?: number;
}

/** One clinic inside the sales plan's Clinics line (the former clinic plan, merged 19 Nov 2026). */
export interface PlanClinicLine {
  key: string;
  label: string;
  systemUnits: number;
  plannedUnits: number;
}

/** What the planner confirmed before a plan was locked. */
export interface PlanConsent {
  at: string;
  by: RoleId;
  /** Products shown as at risk of running out, and overstock not pushed, when they confirmed. */
  atRisk: string[];
  overstock: string[];
  /** "This plan was discussed with and approved by the MD." */
  mdApproved: true;
}

export interface PlanLine {
  key: string;
  label: string;
  systemUnits: number;
  /** When `products` is present, this is their sum. */
  plannedUnits: number;
  activity: string;
  /** When `products` carry budgets, this is their sum. */
  budget: number;
  products?: PlanProductLine[];
  /** The sales plan's Clinics line, clinic by clinic; `plannedUnits` is their sum. */
  clinics?: PlanClinicLine[];
}

export interface PlanSubmission {
  cycleId: string;
  part: PlanPart;
  by: RoleId;
  submittedAt: string;
  lines: PlanLine[];
  note: string;
  version: number;
  /** Locked plans cannot be edited; Management can reopen them. */
  locked?: boolean;
  consent?: PlanConsent;
  reopened?: { at: string; by: RoleId };
}

/** One product's share of a plan line: its own last 30 days and system projection. */
export interface ProductTrend {
  productId: string;
  last30: number;
  systemUnits: number;
}

export interface TrendRow {
  key: string;
  label: string;
  last30: number;
  last30Value: number;
  perDay: number;
  growthPct: number | null;
  /** The sum of `products[].systemUnits`, so a line and its products always agree. */
  systemUnits: number;
  systemValue: number;
  products: ProductTrend[];
}

export function cycleById(id: string): PlanCycle | undefined {
  return CYCLES.find((c) => c.id === id);
}

export function periodDays(c: PlanCycle): number {
  return diffDays(c.periodTo, c.periodFrom) + 1;
}

export type CycleState = "upcoming" | "open" | "closed";

/**
 * Can the planner still fill or edit this plan? From the request day until the plan's period starts (decided 21 Nov
 * 2026): after the due day it is still accepted, and counts as late.
 */
export function canStillSubmit(c: PlanCycle, today: string): boolean {
  return today >= c.requestOn && today < c.periodFrom;
}

export function cycleState(c: PlanCycle, today: string): CycleState {
  if (today < c.requestOn) return "upcoming";
  if (today <= c.dueOn) return "open";
  return "closed";
}

/** A set of plan lines: the channels (both plans), or the active clinics (inside the sales plan's Clinics line). */
export type LineSet = PlanPart | "clinic";

/** The lines a set plans: connected channels, or active clinics. */
export function partKeys(ds: Dataset, part: LineSet): { key: string; label: string }[] {
  const label = (c: ChannelId) => ds.channels.find((x) => x.id === c)!.label;
  if (part === "clinic") return ds.clinics.filter((c) => c.active).map((c) => ({ key: `clinic:${c.id}`, label: c.name }));
  return connectedChannels(ds).map((c) => ({ key: c, label: label(c) }));
}

/** Which sources a plan line covers: a channel, or one clinic's own clinic sales. */
function keyPick(key: string): (s: Source) => boolean {
  if (key.startsWith("clinic:")) {
    const id = key.slice(7);
    return (s) => s.channel === "clinic" && s.clinicId === id;
  }
  return (s) => s.channel === key;
}

function keyChannel(key: string): ChannelId {
  return key.startsWith("clinic:") ? "clinic" : (key as ChannelId);
}

/**
 * Current trend (auto-filled from data) and the system projection for a plan period, per line.
 * `asOf` = the day the projection is made (defaults to today; past cycles use their request day).
 */
export function planBaseline(ds: Dataset, settings: FormulaSettings, part: LineSet, cycle: PlanCycle, asOf?: string): TrendRow[] {
  const days = periodDays(cycle);
  const cut = Math.min(ds.days.length, Math.max(1, diffDays(asOf ?? ds.today, ds.days[0]!) + 1));
  const lag = ds.days.length - cut;
  return partKeys(ds, part).map(({ key, label }) => {
    const pick = keyPick(key);
    const ch = keyChannel(key);
    const groups = sourceGroups(ds, pick);
    // growth vs the 30 days before: only when every sales point of the line was recording through them
    const prevStart = ds.days[Math.max(0, cut - 60)]!;
    const complete = groups.every((g) => g.from !== null && g.from <= prevStart);
    let last30 = 0;
    let prev30 = 0;
    let last30Value = 0;
    let systemUnits = 0;
    let systemValue = 0;
    const products: ProductTrend[] = [];
    ds.products.forEach((p, pi) => {
      const series = new Array<number>(cut).fill(0);
      const values = new Array<number>(cut).fill(0);
      ds.sources.forEach((src, si) => {
        if (!pick(src)) return;
        const a = ds.sold[pi]![si]!;
        const v = ds.value[pi]![si]!;
        for (let d = 0; d < cut; d++) {
          series[d]! += a[d]!;
          values[d]! += v[d]!;
        }
      });
      let pLast30 = 0;
      for (let i = Math.max(0, cut - 30); i < cut; i++) {
        pLast30 += series[i]!;
        last30Value += values[i]!;
      }
      last30 += pLast30;
      let pUnits = 0;
      for (let i = Math.max(0, cut - 60); i < cut - 30; i++) prev30 += series[i]!;
      // each group of sales points over its own history (a clinic that joined the CRM late is measured from then)
      for (const g of groups) {
        const hd = Math.max(0, groupHistoryDays(ds, p, g.from) - lag);
        if (hd <= 0) continue;
        const gs = new Array<number>(cut).fill(0);
        for (const si of g.sources) {
          const a = ds.sold[pi]![si]!;
          for (let d = 0; d < cut; d++) gs[d]! += a[d]!;
        }
        const r = dailyRate(gs, settings, { historyDays: hd }).rate;
        const units = projection(r, days);
        pUnits += units;
        systemValue += units * avgUnitValue(ds, pi, ch);
      }
      // rounded per product; the line is their sum (one number, one place)
      const pRounded = Math.round(pUnits);
      systemUnits += pRounded;
      products.push({ productId: p.id, last30: pLast30, systemUnits: pRounded });
    });
    return {
      key,
      label,
      last30,
      last30Value,
      perDay: last30 / 30,
      growthPct: complete && prev30 > 0 ? ((last30 - prev30) / prev30) * 100 : null,
      systemUnits,
      systemValue,
      products,
    };
  });
}

/**
 * Splits a line's planned total over its products in proportion to their system projection, in whole units that
 * add up exactly (largest remainder). Used when a plan saved as one number per line is opened product by product.
 */
export function spreadPlan(products: { productId: string; systemUnits: number }[], total: number): Record<string, number> {
  const out: Record<string, number> = {};
  const base = products.reduce((a, p) => a + p.systemUnits, 0);
  if (base <= 0 || total <= 0) {
    for (const p of products) out[p.productId] = 0;
    return out;
  }
  const shares = products.map((p) => {
    const exact = (p.systemUnits / base) * total;
    return { id: p.productId, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((a, s) => a + s.floor, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    out[s.id] = s.floor + (left > 0 ? 1 : 0);
    if (left > 0) left--;
  }
  return out;
}

/**
 * The sales plan's Clinics line, clinic by clinic: each clinic's own system projection, adjusted in whole units so
 * the clinics add up exactly to the Clinics channel's figure (each is rounded on its own).
 */
export function clinicSplit(ds: Dataset, settings: FormulaSettings, cycle: PlanCycle, channelSystem: number, asOf?: string): (PlanClinicLine & { last30: number })[] {
  const rows = planBaseline(ds, settings, "clinic", cycle, asOf);
  const fit = spreadPlan(rows.map((r) => ({ productId: r.key, systemUnits: r.systemUnits })), channelSystem);
  return rows.map((r) => ({ key: r.key, label: r.label, last30: r.last30, systemUnits: fit[r.key] ?? 0, plannedUnits: fit[r.key] ?? 0 }));
}

/** Seed submissions become real submissions using the baseline at the cycle's request day. */
export function seedSubmissions(ds: Dataset, settings: FormulaSettings): PlanSubmission[] {
  return SEED_SUBMISSIONS.map((s) => {
    const cycle = cycleById(s.cycleId)!;
    const asOf = cycle.requestOn < ds.today ? cycle.requestOn : ds.today;
    const base = planBaseline(ds, settings, s.part, cycle, asOf);
    const mult = (key: string) => s.multipliers[key] ?? s.multipliers.default;
    return {
      cycleId: s.cycleId,
      part: s.part,
      by: s.by,
      submittedAt: s.submittedAt,
      note: s.note,
      version: 1,
      lines: base.map((b) => {
        if (s.part === "sales" && b.key === "clinic") {
          const clinics = clinicSplit(ds, settings, cycle, b.systemUnits, asOf).map((c) => ({ key: c.key, label: c.label, systemUnits: c.systemUnits, plannedUnits: Math.round(c.systemUnits * (s.multipliers[c.key] ?? mult("clinic"))) }));
          return { key: b.key, label: b.label, systemUnits: b.systemUnits, plannedUnits: clinics.reduce((a, c) => a + c.plannedUnits, 0), activity: s.activities[b.key] ?? "", budget: s.budgets[b.key] ?? 0, clinics };
        }
        return {
          key: b.key,
          label: b.label,
          systemUnits: b.systemUnits,
          plannedUnits: Math.round(b.systemUnits * mult(b.key)),
          activity: s.activities[b.key] ?? "",
          budget: s.budgets[b.key] ?? 0,
        };
      }),
    };
  });
}

export type SubmissionStatus = "on_time" | "late" | "pending" | "missing" | "not_open";

export function submissionStatus(cycle: PlanCycle, sub: PlanSubmission | undefined, today: string): SubmissionStatus {
  if (sub) return sub.submittedAt.slice(0, 10) > cycle.dueOn ? "late" : "on_time";
  const state = cycleState(cycle, today);
  if (state === "upcoming") return "not_open";
  if (state === "open") return "pending";
  return "missing";
}

/** Actual units sold per line within the plan period so far. */
export function actualsForPeriod(ds: Dataset, part: PlanPart, cycle: PlanCycle): { byKey: Record<string, number>; elapsedDays: number } {
  const end = cycle.periodTo < ds.today ? cycle.periodTo : ds.today;
  const elapsedDays = Math.max(0, diffDays(end, cycle.periodFrom) + 1);
  const byKey: Record<string, number> = {};
  if (elapsedDays === 0) return { byKey, elapsedDays };
  const s = Math.max(0, diffDays(cycle.periodFrom, ds.days[0]!));
  const e = diffDays(end, ds.days[0]!);
  for (const { key } of partKeys(ds, part)) {
    const pick = keyPick(key);
    let q = 0;
    ds.products.forEach((_, pi) => {
      ds.sources.forEach((src, si) => {
        if (!pick(src)) return;
        const a = ds.sold[pi]![si]!;
        for (let d = s; d <= e; d++) q += a[d] ?? 0;
      });
    });
    byKey[key] = q;
  }
  return { byKey, elapsedDays };
}

// ── consolidation ─────────────────────────────────────────────────────────────

export interface ConsolidatedRow {
  channel: ChannelId;
  label: string;
  system: number;
  systemValue: number;
  salesPlan: number | null;
  marketing: number | null;
  /** The plan the readiness check uses: the sales plan, else the marketing plan, else the system. */
  plan: number;
  gap: number | null;
  flagged: boolean;
}

export interface ReadinessRow {
  product: Product;
  demand: number;
  availableAtStart: number;
  shortfall: number;
}

export interface Consolidated {
  rows: ConsolidatedRow[];
  /** The sales plan's Clinics line, clinic by clinic. */
  clinics: { key: string; label: string; system: number; plan: number | null; gap: number | null; flagged: boolean }[];
  readiness: ReadinessRow[];
  totals: { system: number; plan: number; systemValue: number };
}

export function consolidate(
  ds: Dataset,
  settings: FormulaSettings,
  metrics: ProductMetrics[],
  cycle: PlanCycle,
  submissions: Partial<Record<PlanPart, PlanSubmission>>,
): Consolidated {
  const asOf = cycle.requestOn < ds.today ? cycle.requestOn : ds.today;
  const base = planBaseline(ds, settings, "marketing", cycle, asOf);
  const pick = (part: PlanPart, key: string) => submissions[part]?.lines.find((l) => l.key === key)?.plannedUnits ?? null;

  // per channel: the plan line the readiness check uses, when it was planned product by product
  const productPlans: Record<string, { byProduct: Map<string, PlanProductLine> }> = {};
  const rows: ConsolidatedRow[] = base.map((b) => {
    const channel = b.key as ChannelId;
    const salesPlan = pick("sales", channel);
    const marketing = pick("marketing", channel);
    const plan = salesPlan ?? marketing ?? b.systemUnits;
    const usedPart: PlanPart | null = salesPlan !== null ? "sales" : marketing !== null ? "marketing" : null;
    const usedLine = usedPart ? submissions[usedPart]?.lines.find((l) => l.key === channel) : undefined;
    if (usedLine?.products?.length) productPlans[channel] = { byProduct: new Map(usedLine.products.map((x) => [x.productId, x])) };
    const compare = salesPlan ?? marketing;
    return {
      channel,
      label: b.label,
      system: b.systemUnits,
      systemValue: b.systemValue,
      salesPlan,
      marketing,
      plan,
      gap: compare === null ? null : gapPct(compare, b.systemUnits),
      flagged: compare !== null && isGapFlagged(compare, b.systemUnits, settings.gapFlagPct),
    };
  });

  const clinicRow = rows.find((r) => r.channel === "clinic");
  const salesClinics = submissions.sales?.lines.find((l) => l.key === "clinic")?.clinics;
  const clinics = clinicSplit(ds, settings, cycle, clinicRow?.system ?? 0, asOf).map((c) => {
    const saved = salesClinics?.find((x) => x.key === c.key);
    const plan = saved ? saved.plannedUnits : null;
    return { key: c.key, label: c.label, system: c.systemUnits, plan, gap: plan === null ? null : gapPct(plan, c.systemUnits), flagged: plan !== null && isGapFlagged(plan, c.systemUnits, settings.gapFlagPct) };
  });

  // Stock readiness: demand in the period with each channel's plan uplift, vs what will be left at period start.
  const uplift: Record<string, number> = {};
  for (const r of rows) uplift[r.channel] = r.system > 0 ? r.plan / r.system : 1;
  const days = periodDays(cycle);
  const leadIn = Math.max(0, diffDays(cycle.periodFrom, ds.today));
  const readiness: ReadinessRow[] = [];
  ds.products.forEach((p, pi) => {
    const m = metrics[pi]!;
    let demand = 0;
    for (const ch of CHANNEL_IDS) {
      const r = rateFor(ds, settings, pi, (src) => src.channel === ch, "used").rate;
      const pp = productPlans[ch]?.byProduct.get(p.id);
      if (productPlans[ch]) {
        // planned product by product: this product's own change on its usage (a product planned from nothing adds its units)
        if (!pp) demand += r * days;
        else if (pp.systemUnits > 0) demand += r * days * (pp.plannedUnits / pp.systemUnits);
        else demand += r * days + pp.plannedUnits;
      } else demand += r * days * (uplift[ch] ?? 1);
    }
    const arriving = m.openPOs.filter((po) => po.expectedOn <= addDays(cycle.periodTo, 0)).reduce((a, po) => a + po.qty, 0);
    const availableAtStart = Math.max(0, m.stock - m.rate * leadIn) + arriving;
    const shortfall = Math.ceil(demand - availableAtStart);
    if (shortfall > 0 && cycle.periodTo >= ds.today) readiness.push({ product: p, demand: Math.round(demand), availableAtStart: Math.round(availableAtStart), shortfall });
  });
  readiness.sort((a, b) => b.shortfall * b.product.cost - a.shortfall * a.product.cost);

  return {
    rows,
    clinics,
    readiness,
    totals: {
      system: rows.reduce((a, r) => a + r.system, 0),
      plan: rows.reduce((a, r) => a + r.plan, 0),
      systemValue: rows.reduce((a, r) => a + r.systemValue, 0),
    },
  };
}

// ── stock check for a plan (marketing) ────────────────────────────────────────

/** at_risk: runs out during the plan before new stock can land · tight: runs out during the plan, new stock can land
 *  first (if it is ordered in time) · overstock: excess stock the plan does not push · ok: lasts the plan. */
export type StockRisk = "at_risk" | "tight" | "overstock" | "ok";

export interface ProductPlanTotal {
  /** System units for the period, all channels of the plan. */
  system: number;
  /** Planned units for the period, all channels of the plan. */
  planned: number;
  /** Ad budget on the product, all channels (₹). */
  budget: number;
}

export interface StockCheckRow extends ProductPlanTotal {
  product: Product;
  stock: number;
  /** Usage per day during the plan period at the plan's pace. */
  dailyAtPlan: number;
  /** Days from today until the stock runs out (Infinity: it does not). */
  daysLeft: number;
  runOut: string | null;
  /** When new stock can arrive: the earliest open purchase order, else today + the lead time (if ordered today). */
  eta: string;
  etaOnOrder: boolean;
  risk: StockRisk;
}

const RISK_ORDER: Record<StockRisk, number> = { at_risk: 0, tight: 1, overstock: 2, ok: 3 };

/**
 * Days of stock left and when new stock arrives, for every product the plan touches. Usage runs at today's pace
 * until the plan period starts, at the plan's pace during it (today's pace + the plan's extra units ÷ period days),
 * and at today's pace after it.
 */
export function planStockCheck(ds: Dataset, metrics: ProductMetrics[], cycle: PlanCycle, totals: Record<string, ProductPlanTotal>): StockCheckRow[] {
  const days = periodDays(cycle);
  const leadIn = Math.max(0, diffDays(cycle.periodFrom, ds.today));
  const end = Math.max(leadIn, diffDays(cycle.periodTo, ds.today) + 1);
  const rows: StockCheckRow[] = [];
  for (const m of metrics) {
    const t = totals[m.product.id] ?? { system: 0, planned: 0, budget: 0 };
    if (m.rate <= 0 && t.planned <= 0) continue;
    const stock = Math.max(0, m.stock);
    const dailyAtPlan = Math.max(0, m.rate + (t.planned - t.system) / days);
    let daysLeft = Number.POSITIVE_INFINITY;
    let left = stock;
    const before = m.rate * leadIn;
    if (before >= left && m.rate > 0) daysLeft = left / m.rate;
    else {
      left -= before;
      const during = dailyAtPlan * (end - leadIn);
      if (during >= left && dailyAtPlan > 0) daysLeft = leadIn + left / dailyAtPlan;
      else if (m.rate > 0) daysLeft = end + (left - during) / m.rate;
    }
    const runOut = Number.isFinite(daysLeft) ? addDays(ds.today, Math.floor(daysLeft)) : null;
    const onOrder = m.nextArrivalDays !== null;
    const eta = addDays(ds.today, onOrder ? Math.max(0, m.nextArrivalDays!) : m.leadTime);
    let risk: StockRisk = "ok";
    if (t.planned > 0 && runOut !== null && daysLeft < end) risk = runOut < eta ? "at_risk" : "tight";
    else if (m.status === "overstock" && t.planned <= t.system) risk = "overstock";
    rows.push({ product: m.product, ...t, stock, dailyAtPlan, daysLeft, runOut, eta, etaOnOrder: onOrder, risk });
  }
  return rows.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.daysLeft - b.daysLeft || a.product.name.localeCompare(b.product.name));
}
