// Planning: the auto-filled current trend, the system's projection for a plan period,
// seed submissions, consolidation (system + trend + team plans) and stock readiness.

import { addDays, diffDays } from "../dates";
import { dailyRate, gapPct, isGapFlagged, projection } from "../domain/formulas";
import type { ChannelId, FormulaSettings, Product } from "../domain/types";
import { CHANNELS, D2C_CHANNELS, LOCATIONS } from "../mock/catalog";
import type { Dataset } from "../mock/dataset";
import { CYCLES, SEED_SUBMISSIONS, type PlanCycle } from "../mock/plans";
import type { PlanPart, RoleId } from "../roles";
import { CHANNEL_IDS, historyDays, sourceSeries, totalSeries, unitValue, type ProductMetrics } from "./engine";

export interface PlanLine {
  key: string;
  label: string;
  systemUnits: number;
  plannedUnits: number;
  activity: string;
  budget: number;
}

export interface PlanSubmission {
  cycleId: string;
  part: PlanPart;
  by: RoleId;
  submittedAt: string;
  lines: PlanLine[];
  note: string;
  version: number;
}

export interface TrendRow {
  key: string;
  label: string;
  last30: number;
  last30Value: number;
  perDay: number;
  growthPct: number | null;
  systemUnits: number;
  systemValue: number;
}

export function cycleById(id: string): PlanCycle | undefined {
  return CYCLES.find((c) => c.id === id);
}

export function periodDays(c: PlanCycle): number {
  return diffDays(c.periodTo, c.periodFrom) + 1;
}

export type CycleState = "upcoming" | "open" | "closed";

export function cycleState(c: PlanCycle, today: string): CycleState {
  if (today < c.requestOn) return "upcoming";
  if (today <= c.dueOn) return "open";
  return "closed";
}

/** The lines each part plans: channels, D2C channels or clinics. */
export function partKeys(part: PlanPart): { key: string; label: string }[] {
  if (part === "d2c") return D2C_CHANNELS.map((c) => ({ key: c, label: CHANNELS.find((x) => x.id === c)!.label }));
  if (part === "clinic") return LOCATIONS.filter((l) => l.kind === "clinic").map((l) => ({ key: l.id, label: l.name }));
  return CHANNELS.map((c) => ({ key: c.id, label: c.label }));
}

function keySeries(ds: Dataset, pi: number, key: string): ArrayLike<number> {
  if ((CHANNEL_IDS as string[]).includes(key)) return totalSeries(ds, pi, [key as ChannelId]);
  const si = ds.sources.findIndex((s) => s.channel === "clinic" && s.locationId === key);
  return si >= 0 ? sourceSeries(ds, pi, si) : new Uint16Array(ds.days.length);
}

function keyChannel(key: string): ChannelId {
  return (CHANNEL_IDS as string[]).includes(key) ? (key as ChannelId) : "clinic";
}

/**
 * Current trend (auto-filled from data) and the system projection for a plan period, per line.
 * `asOf` = the day the projection is made (defaults to today; past cycles use their request day).
 */
export function planBaseline(ds: Dataset, settings: FormulaSettings, part: PlanPart, cycle: PlanCycle, asOf?: string): TrendRow[] {
  const days = periodDays(cycle);
  const cut = Math.min(ds.days.length, Math.max(1, diffDays(asOf ?? ds.today, ds.days[0]!) + 1));
  return partKeys(part).map(({ key, label }) => {
    let last30 = 0;
    let prev30 = 0;
    let last30Value = 0;
    let systemUnits = 0;
    let systemValue = 0;
    ds.products.forEach((p, pi) => {
      const series = Array.from(keySeries(ds, pi, key)).slice(0, cut);
      const n = series.length;
      let l = 0;
      for (let i = Math.max(0, n - 30); i < n; i++) l += series[i]!;
      for (let i = Math.max(0, n - 60); i < n - 30; i++) prev30 += series[i]!;
      last30 += l;
      last30Value += l * unitValue(p, keyChannel(key));
      const r = dailyRate(series, settings, { inStock: ds.inStock[pi]!.slice(0, cut), historyDays: Math.min(historyDays(ds, p), n) }).rate;
      const units = projection(r, days);
      systemUnits += units;
      systemValue += units * unitValue(p, keyChannel(key));
    });
    return {
      key,
      label,
      last30,
      last30Value,
      perDay: last30 / 30,
      growthPct: prev30 > 0 ? ((last30 - prev30) / prev30) * 100 : null,
      systemUnits: Math.round(systemUnits),
      systemValue,
    };
  });
}

/** Seed submissions become real submissions using the baseline at the cycle's request day. */
export function seedSubmissions(ds: Dataset, settings: FormulaSettings): PlanSubmission[] {
  return SEED_SUBMISSIONS.map((s) => {
    const cycle = cycleById(s.cycleId)!;
    const base = planBaseline(ds, settings, s.part, cycle, cycle.requestOn < ds.today ? cycle.requestOn : ds.today);
    return {
      cycleId: s.cycleId,
      part: s.part,
      by: s.by,
      submittedAt: s.submittedAt,
      note: s.note,
      version: 1,
      lines: base.map((b) => ({
        key: b.key,
        label: b.label,
        systemUnits: b.systemUnits,
        plannedUnits: Math.round(b.systemUnits * (s.multipliers[b.key] ?? s.multipliers.default)),
        activity: s.activities[b.key] ?? "",
        budget: s.budgets[b.key] ?? 0,
      })),
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
  const s = diffDays(cycle.periodFrom, ds.days[0]!);
  const e = diffDays(end, ds.days[0]!);
  for (const { key } of partKeys(part)) {
    let q = 0;
    ds.products.forEach((_, pi) => {
      const series = keySeries(ds, pi, key);
      for (let d = Math.max(0, s); d <= e; d++) q += series[d] ?? 0;
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
  team: number | null;
  /** The plan the readiness check uses: sales plan, else team, else marketing, else system. */
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
  clinics: { key: string; label: string; system: number; team: number | null; gap: number | null; flagged: boolean }[];
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
  const clinicTeam = submissions.clinic ? submissions.clinic.lines.reduce((a, l) => a + l.plannedUnits, 0) : null;

  const rows: ConsolidatedRow[] = base.map((b) => {
    const channel = b.key as ChannelId;
    const salesPlan = pick("sales", channel);
    const marketing = pick("marketing", channel);
    const team = channel === "clinic" ? clinicTeam : pick("d2c", channel);
    const plan = salesPlan ?? team ?? marketing ?? b.systemUnits;
    const compare = salesPlan ?? team ?? marketing;
    return {
      channel,
      label: b.label,
      system: b.systemUnits,
      systemValue: b.systemValue,
      salesPlan,
      marketing,
      team,
      plan,
      gap: compare === null ? null : gapPct(compare, b.systemUnits),
      flagged: compare !== null && isGapFlagged(compare, b.systemUnits, settings.gapFlagPct),
    };
  });

  const clinicBase = planBaseline(ds, settings, "clinic", cycle, asOf);
  const clinics = clinicBase.map((c) => {
    const team = pick("clinic", c.key);
    return { key: c.key, label: c.label, system: c.systemUnits, team, gap: team === null ? null : gapPct(team, c.systemUnits), flagged: team !== null && isGapFlagged(team, c.systemUnits, settings.gapFlagPct) };
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
      const r = dailyRate(totalSeries(ds, pi, [ch]), settings, { inStock: ds.inStock[pi], historyDays: historyDays(ds, p) }).rate;
      demand += r * days * (uplift[ch] ?? 1);
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
