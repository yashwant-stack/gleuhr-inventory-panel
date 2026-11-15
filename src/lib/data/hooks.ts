"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { getDataset } from "../mock/dataset";
import { CYCLES } from "../mock/plans";
import { roleById, type PlanPart } from "../roles";
import { setPanelToday, usePanel } from "../state/store";
import { computeMetrics, type Filters } from "./engine";
import { decodeDataset, type Dataset, type DatasetWire } from "./model";
import { seedSubmissions, type PlanSubmission } from "./plans";

/** "live" reads /api/dataset (the backend); anything else uses the sample data. */
const LIVE = typeof process !== "undefined" && process.env.NEXT_PUBLIC_DATA_SOURCE === "live";

const DatasetContext = createContext<Dataset | null>(null);

/** Loads the data once and shows loading / failure honestly; children only render with real data in hand. */
export function DatasetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ds?: Dataset; error?: string }>(() => (LIVE ? {} : { ds: getDataset() }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!LIVE) return;
    let alive = true;
    fetch("/api/dataset", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
        return (await r.json()) as DatasetWire;
      })
      .then((w) => {
        if (!alive) return;
        const ds = decodeDataset(w);
        setPanelToday(ds.today);
        const st = usePanel.getState();
        if (st.preset !== "custom") st.setPreset(st.preset);
        setState({ ds });
      })
      .catch((e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state.ds) return createElement(DatasetContext.Provider, { value: state.ds }, children);
  return createElement(
    "div",
    { className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-[13px]" },
    state.error
      ? [
          createElement("div", { key: "t", className: "text-[15px] font-semibold text-ink" }, "Couldn’t load the panel’s data"),
          createElement("div", { key: "m", className: "max-w-md text-ink-2" }, state.error.slice(0, 300)),
          createElement(
            "button",
            {
              key: "b",
              className: "rounded-lg bg-coral px-3 py-1.5 font-medium text-white",
              onClick: () => {
                setState({});
                setAttempt((a) => a + 1);
              },
            },
            "Try again",
          ),
        ]
      : createElement("div", { className: "text-muted" }, "Loading stock from Zoho and sales from the CRMs…"),
  );
}

export function useDataset(): Dataset {
  const ds = useContext(DatasetContext);
  if (!ds) throw new Error("useDataset outside DatasetProvider");
  return ds;
}

export function useFilters(): Filters {
  return usePanel(
    useShallow((s) => ({ from: s.from, to: s.to, channels: s.channels, points: s.points, locations: s.locations, categories: s.categories, search: s.search })),
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
  const seeds = useMemo(() => (ds.origin === "sample" ? seedSubmissions(ds, settings) : []), [ds, settings]);
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
