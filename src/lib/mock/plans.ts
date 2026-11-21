// Planning cycles and the submissions already in for them (sample data).
// Monthly: request on the 23rd, deadline the 25th, consolidated report the 26th.
// Weekly: request Thursday, deadline Saturday, consolidated report Monday.

import type { PlanPart, RoleId } from "../roles";

export type CycleKind = "weekly" | "monthly";

export interface PlanCycle {
  id: string;
  kind: CycleKind;
  label: string;
  /** The period the plan is for. */
  periodFrom: string;
  periodTo: string;
  requestOn: string;
  dueOn: string;
  reportOn: string;
}

/**
 * The plan cycles around a day, by the rule above (decided 20 Nov 2026: they follow the calendar, so live data always
 * has the current cycles; the fixed sample list it replaced ran out after 14 Nov and left nothing open):
 *  - weekly: the two latest weeks whose request day (Thursday) has come; a week runs Monday to Sunday,
 *    due the Saturday before, report on its Monday;
 *  - monthly: this month and next month; request the 23rd of the month before, due the 25th, report the 26th.
 */
export function cyclesFor(today: string): PlanCycle[] {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const add = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // the latest Monday whose Thursday-before has come: Monday ≤ today + 4
  const limit = day(add(today, 4));
  const latestMonday = add(iso(limit), -((limit.getUTCDay() + 6) % 7));
  const weekly = [0, -7].map((back) => {
    const from = add(latestMonday, back);
    const d = day(from);
    return { id: `w-${from}`, kind: "weekly" as const, label: `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, periodFrom: from, periodTo: add(from, 6), requestOn: add(from, -4), dueOn: add(from, -2), reportOn: from };
  });
  const t = day(today);
  const monthly = [0, 1].map((ahead) => {
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + ahead, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const before = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 23));
    const ym = iso(first).slice(0, 7);
    return {
      id: `m-${ym}`,
      kind: "monthly" as const,
      label: `${LONG[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
      periodFrom: iso(first),
      periodTo: iso(last),
      requestOn: iso(before),
      dueOn: add(iso(before), 2),
      reportOn: add(iso(before), 3),
    };
  });
  return [monthly[1]!, ...weekly, monthly[0]!];
}

/** The current cycles. Built for the sample day; the data's own day replaces it as soon as it loads (setCyclesToday). */
export const CYCLES: PlanCycle[] = cyclesFor("2026-11-14");

/** Called when the data loads: every screen reads this one list. */
export function setCyclesToday(today: string): void {
  CYCLES.splice(0, CYCLES.length, ...cyclesFor(today));
}

export interface SeedSubmission {
  cycleId: string;
  part: PlanPart;
  by: RoleId;
  submittedAt: string;
  /** Planned = system projection × this, per line (a line not listed uses `default`). */
  multipliers: Record<string, number> & { default: number };
  activities: Record<string, string>;
  budgets: Record<string, number>;
  note: string;
}

export const SEED_SUBMISSIONS: SeedSubmission[] = [
  // Week of 16 Nov — due today: marketing is in (before the consent step existed, so still open), sales is pending.
  {
    cycleId: "w-2026-11-16",
    part: "marketing",
    by: "marketing",
    submittedAt: "2026-11-13T18:40:00+05:30",
    multipliers: { default: 1.05, website: 1.28, online_team: 1.12 },
    activities: { online_team: "Lightning offer on Vitamin-C Serum (Wed–Fri)", website: "Winter skincare bundle + email to 18k list", clinic: "Hydra-facial add-on offer at front desk" },
    budgets: { online_team: 40000, website: 45000, clinic: 15000 },
    note: "Push Spa Cream and Body Lotion in the winter bundle (overstock).",
  },
  // Week of 9 Nov — both in, sales one day late. A "clinic:<id>" multiplier is that clinic's row in the sales plan.
  { cycleId: "w-2026-11-09", part: "marketing", by: "marketing", submittedAt: "2026-11-06T17:05:00+05:30", multipliers: { default: 1.08 }, activities: { website: "Diwali week bundle" }, budgets: { website: 30000 }, note: "" },
  { cycleId: "w-2026-11-09", part: "sales", by: "sales", submittedAt: "2026-11-08T11:20:00+05:30", multipliers: { default: 1.1, clinic: 1.15, "clinic:1": 1.25 }, activities: { clinic: "Festive package push" }, budgets: {}, note: "" },
  // November monthly — both in, sales late (26 Oct).
  { cycleId: "m-2026-11", part: "marketing", by: "marketing", submittedAt: "2026-10-24T15:30:00+05:30", multipliers: { default: 1.12, website: 1.3 }, activities: { website: "Diwali sale event", online_team: "Festive gift boxes" }, budgets: { website: 150000, online_team: 80000 }, note: "" },
  { cycleId: "m-2026-11", part: "sales", by: "sales", submittedAt: "2026-10-26T12:10:00+05:30", multipliers: { default: 1.15 }, activities: { clinic: "Package upsell at every clinic" }, budgets: {}, note: "" },
];
