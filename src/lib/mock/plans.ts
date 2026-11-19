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

export const CYCLES: PlanCycle[] = [
  { id: "m-2026-12", kind: "monthly", label: "December 2026", periodFrom: "2026-12-01", periodTo: "2026-12-31", requestOn: "2026-11-23", dueOn: "2026-11-25", reportOn: "2026-11-26" },
  { id: "w-2026-11-16", kind: "weekly", label: "Week of 16 Nov", periodFrom: "2026-11-16", periodTo: "2026-11-22", requestOn: "2026-11-12", dueOn: "2026-11-14", reportOn: "2026-11-16" },
  { id: "w-2026-11-09", kind: "weekly", label: "Week of 9 Nov", periodFrom: "2026-11-09", periodTo: "2026-11-15", requestOn: "2026-11-05", dueOn: "2026-11-07", reportOn: "2026-11-09" },
  { id: "m-2026-11", kind: "monthly", label: "November 2026", periodFrom: "2026-11-01", periodTo: "2026-11-30", requestOn: "2026-10-23", dueOn: "2026-10-25", reportOn: "2026-10-26" },
];

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
