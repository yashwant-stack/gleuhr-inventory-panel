// Planning: the auto-filled current trend, the system's projection for a plan period,
// seed submissions, consolidation (system + trend + team plans) and stock readiness.

import { addDays, diffDays } from "../dates";
import { dailyRate, gapPct, isGapFlagged, projection } from "../domain/formulas";
import type { ChannelId, FormulaSettings, Product } from "../domain/types";
import { CYCLES, SEED_SUBMISSIONS, type PlanCycle } from "../mock/plans";
import type { PlanPart, RoleId } from "../roles";
import { avgUnitValue, CHANNEL_IDS, groupHistoryDays, rateFor, sourceGroups, type ProductMetrics } from "./engine";
import { connectedChannels, type Dataset, type Source } from "./model";

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

/** The lines each part plans: connected channels, connected D2C channels, or active clinics. */
export function partKeys(ds: Dataset, part: PlanPart): { key: string; label: string }[] {
  const connected = connectedChannels(ds);
  const label = (c: ChannelId) => ds.channels.find((x) => x.id === c)!.label;
  if (part === "d2c") return connected.filter((c) => c !== "clinic").map((c) => ({ key: c, label: label(c) }));
  if (part === "clinic") return ds.clinics.filter((c) => c.active).map((c) => ({ key: `clinic:${c.id}`, label: c.name }));
  return connected.map((c) => ({ key: c, label: label(c) }));
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
export function planBaseline(ds: Dataset, settings: FormulaSettings, part: PlanPart, cycle: PlanCycle, asOf?: string): TrendRow[] {
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
      for (let i = Math.max(0, cut - 30); i < cut; i++) {
        last30 += series[i]!;
        last30Value += values[i]!;
      }
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
        systemUnits += units;
        systemValue += units * avgUnitValue(ds, pi, ch);
      }
    });
    return {
      key,
      label,
      last30,
      last30Value,
      perDay: last30 / 30,
      growthPct: complete && prev30 > 0 ? ((last30 - prev30) / prev30) * 100 : null,
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
      const r = rateFor(ds, settings, pi, (src) => src.channel === ch, "used").rate;
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
