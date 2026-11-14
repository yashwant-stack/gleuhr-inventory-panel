"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getDataset } from "../mock/dataset";
import { CYCLES } from "../mock/plans";
import { roleById, type PlanPart } from "../roles";
import { usePanel } from "../state/store";
import { computeMetrics, type Filters } from "./engine";
import { seedSubmissions, type PlanSubmission } from "./plans";

/** The data source. Today: the sample dataset. Backend stage: the synced Zoho data. */
export function useDataset() {
  return getDataset();
}

export function useFilters(): Filters {
  return usePanel(
    useShallow((s) => ({ from: s.from, to: s.to, channels: s.channels, locations: s.locations, categories: s.categories, search: s.search })),
  );
}

export function useMetrics() {
  const ds = useDataset();
  const settings = usePanel((s) => s.settings);
  const leadOverrides = usePanel((s) => s.leadOverrides);
  return useMemo(() => computeMetrics(ds, settings, leadOverrides), [ds, settings, leadOverrides]);
}

export function useRole() {
  const role = usePanel((s) => s.role);
  return roleById(role);
}

/** Seed submissions plus anything submitted in this browser (a local one replaces the seed). */
export function useSubmissions(): Record<string, PlanSubmission> {
  const ds = useDataset();
  const settings = usePanel((s) => s.settings);
  const local = usePanel((s) => s.submissions);
  const seeds = useMemo(() => seedSubmissions(ds, settings), [ds, settings]);
  return useMemo(() => {
    const out: Record<string, PlanSubmission> = {};
    for (const s of seeds) out[`${s.cycleId}:${s.part}`] = s;
    for (const [k, v] of Object.entries(local)) out[k] = v;
    return out;
  }, [seeds, local]);
}

export function cycleSubmissions(all: Record<string, PlanSubmission>, cycleId: string): Partial<Record<PlanPart, PlanSubmission>> {
  const out: Partial<Record<PlanPart, PlanSubmission>> = {};
  for (const part of ["marketing", "sales", "d2c", "clinic"] as PlanPart[]) {
    const s = all[`${cycleId}:${part}`];
    if (s) out[part] = s;
  }
  return out;
}

export { CYCLES };
