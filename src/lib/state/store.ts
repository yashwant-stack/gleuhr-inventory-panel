"use client";

// Panel state: filters, who is viewing, settings, approvals and plan submissions.
// Until the backend exists, changes are kept in THIS BROWSER ONLY (localStorage) and every
// screen that saves says so. Storage can be unavailable (private window); the panel still works.

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { addDays, startOfMonth } from "../dates";
import { DEFAULT_FORMULA_SETTINGS, type ChannelId, type FormulaSettings } from "../domain/types";
import type { PlanSubmission } from "../data/plans";
import { TODAY } from "../mock/dataset";
import { LEGACY_ROLES, ROLES, type PlanPart, type RoleId } from "../roles";
import type { Campaign, Festival } from "../data/campaigns";
import { setCyclesToday } from "../mock/plans";

export type DatePreset = "today" | "7d" | "15d" | "30d" | "60d" | "90d" | "mtd" | "last_month" | "custom";

export const DATE_PRESETS: { id: Exclude<DatePreset, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "15d", label: "Last 15 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "60d", label: "Last 60 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "mtd", label: "This month so far" },
  { id: "last_month", label: "Last month" },
];

/** "Today" for date presets: the sample's day until live data says otherwise. */
let panelToday = TODAY;
export function setPanelToday(day: string): void {
  panelToday = day;
  setCyclesToday(day); // the plan cycles follow the data's day
}

export function presetRange(p: Exclude<DatePreset, "custom">, today = panelToday): { from: string; to: string } {
  switch (p) {
    case "today":
      return { from: today, to: today };
    case "mtd":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end };
    }
    default: {
      const n = Number(p.replace("d", ""));
      return { from: addDays(today, -(n - 1)), to: today };
    }
  }
}

export interface Recipients {
  management: string;
  managementWhatsapp: string;
  marketing: string;
  sales: string;
  purchase: string;
  supply: string;
}

export interface Schedule {
  dailyAlertTime: string;
  monthlyRequestDay: number;
  monthlyDueDay: number;
  monthlyReportDay: number;
  weeklyRequestDay: string;
  weeklyDueDay: string;
  weeklyReportDay: string;
  requestTime: string;
}

export interface Approval {
  qty: number;
  at: string;
  by: RoleId;
}

interface PanelState {
  // filters
  preset: DatePreset;
  from: string;
  to: string;
  channels: ChannelId[];
  /** Sales pages: "clinic:<id>" / "loc:<zoho location>". */
  points: string[];
  /** Stock pages: Zoho location ids. */
  locations: string[];
  categories: string[];
  /** Segment filter, Purchase only (cleared when the role changes). */
  segments: string[];
  setSegments: (s: string[]) => void;
  search: string;
  setPreset: (p: Exclude<DatePreset, "custom">) => void;
  setCustomRange: (from: string, to: string) => void;
  setChannels: (c: ChannelId[]) => void;
  setPoints: (p: string[]) => void;
  setLocations: (l: string[]) => void;
  setCategories: (c: string[]) => void;
  setSearch: (s: string) => void;
  resetFilters: () => void;

  // who is viewing
  role: RoleId;
  setRole: (r: RoleId) => void;

  // settings
  settings: FormulaSettings;
  leadOverrides: Record<string, number>;
  recipients: Recipients;
  schedule: Schedule;
  saveSettings: (s: FormulaSettings) => void;
  setLeadOverride: (key: string, days: number | null) => void;
  saveRecipients: (r: Recipients) => void;
  saveSchedule: (s: Schedule) => void;
  resetSettings: () => void;

  // indent approvals
  approvals: Record<string, Approval>;
  approve: (items: { productId: string; qty: number }[], by: RoleId) => void;
  clearApproval: (productId: string) => void;

  // plan submissions made in this browser
  submissions: Record<string, PlanSubmission>;
  submitPlan: (s: PlanSubmission) => void;

  // Marketing impact: campaigns and festival surges (applied ones raise the demand behind Order now)
  campaigns: Campaign[];
  festivals: Festival[];
  saveCampaign: (c: Campaign) => void;
  removeCampaign: (id: string) => void;
  saveFestival: (f: Festival) => void;
  removeFestival: (id: string) => void;

  // UI
  openProductId: string | null;
  openProduct: (id: string | null) => void;
}

export const DEFAULT_RECIPIENTS: Recipients = {
  management: "management@gleuhr.com",
  managementWhatsapp: "+91 98xxx xxxxx",
  marketing: "marketing.head@gleuhr.com",
  sales: "sales.head@gleuhr.com",
  purchase: "purchase@gleuhr.com",
  supply: "supply.chain@gleuhr.com",
};

export const DEFAULT_SCHEDULE: Schedule = {
  dailyAlertTime: "09:00",
  monthlyRequestDay: 23,
  monthlyDueDay: 25,
  monthlyReportDay: 26,
  weeklyRequestDay: "Thursday",
  weeklyDueDay: "Saturday",
  weeklyReportDay: "Monday",
  requestTime: "10:00",
};

const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* storage unavailable — the panel keeps working for this visit */
    }
  },
  removeItem: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const initialRange = presetRange("30d");

export const usePanel = create<PanelState>()(
  persist(
    (set) => ({
      preset: "30d",
      from: initialRange.from,
      to: initialRange.to,
      channels: [],
      points: [],
      locations: [],
      categories: [],
      segments: [],
      setSegments: (segments) => set({ segments }),
      search: "",
      setPreset: (p) => set({ preset: p, ...presetRange(p) }),
      setCustomRange: (from, to) => set({ preset: "custom", from: from <= to ? from : to, to: from <= to ? to : from }),
      setChannels: (channels) => set({ channels }),
      setPoints: (points) => set({ points }),
      setLocations: (locations) => set({ locations }),
      setCategories: (categories) => set({ categories }),
      setSearch: (search) => set({ search }),
      resetFilters: () => set({ preset: "30d", ...presetRange("30d"), channels: [], points: [], locations: [], categories: [], segments: [], search: "" }),

      role: "management",
      setRole: (role) => set({ role, segments: [] }),

      settings: DEFAULT_FORMULA_SETTINGS,
      leadOverrides: {},
      recipients: DEFAULT_RECIPIENTS,
      schedule: DEFAULT_SCHEDULE,
      saveSettings: (settings) => set({ settings }),
      setLeadOverride: (key, days) =>
        set((s) => {
          const next = { ...s.leadOverrides };
          if (days === null) delete next[key];
          else next[key] = days;
          return { leadOverrides: next };
        }),
      saveRecipients: (recipients) => set({ recipients }),
      saveSchedule: (schedule) => set({ schedule }),
      resetSettings: () => set({ settings: DEFAULT_FORMULA_SETTINGS, leadOverrides: {}, recipients: DEFAULT_RECIPIENTS, schedule: DEFAULT_SCHEDULE }),

      approvals: {},
      approve: (items, by) =>
        set((s) => {
          const next = { ...s.approvals };
          const at = new Date().toISOString();
          for (const it of items) next[it.productId] = { qty: it.qty, at, by };
          return { approvals: next };
        }),
      clearApproval: (productId) =>
        set((s) => {
          const next = { ...s.approvals };
          delete next[productId];
          return { approvals: next };
        }),

      submissions: {},
      submitPlan: (sub) => set((s) => ({ submissions: { ...s.submissions, [`${sub.cycleId}:${sub.part}`]: sub } })),

      campaigns: [],
      festivals: [],
      saveCampaign: (c) => set((s) => ({ campaigns: s.campaigns.some((x) => x.id === c.id) ? s.campaigns.map((x) => (x.id === c.id ? c : x)) : [...s.campaigns, c] })),
      removeCampaign: (id) => set((s) => ({ campaigns: s.campaigns.filter((x) => x.id !== id) })),
      saveFestival: (f) => set((s) => ({ festivals: s.festivals.some((x) => x.id === f.id) ? s.festivals.map((x) => (x.id === f.id ? f : x)) : [...s.festivals, f] })),
      removeFestival: (id) => set((s) => ({ festivals: s.festivals.filter((x) => x.id !== id) })),

      openProductId: null,
      openProduct: (openProductId) => set({ openProductId }),
    }),
    {
      name: "gleuhr-inventory-panel",
      version: 7,
      // v1 stored old-style location ids; v2 starts its filters fresh; v3 replaces the 7/30/90 weights with
      // the 60-day window (the old weights are dropped, the window starts at its default); v4 (17 Nov 2026)
      // orders at 60 days of stock left for 60 days of cover: the old 30-day default cover becomes 60; v5 (19 Nov
      // 2026) has five roles: old roles map to the new ones, the CBO's addresses become Management's, and plans of
      // the retired parts (D2C, clinic) are dropped; v6 (20 Nov 2026) orders at 150 days with 90 safety days for 45
      // days of cover, overstock above 180 days: settings still at the old defaults move to the new ones; v7 (20 Nov
      // 2026, later) adds the per-regimen rules and moves overstock from 180 to 210 days when still at the old default.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as {
          settings?: Partial<FormulaSettings> & Record<string, unknown>;
          role?: string;
          recipients?: Record<string, string>;
          submissions?: Record<string, PlanSubmission>;
        };
        if (version < 5) {
          if (p.role) p.role = LEGACY_ROLES[p.role] ?? (ROLES.some((r) => r.id === p.role) ? p.role : "management");
          const r = p.recipients ?? {};
          p.recipients = {
            ...DEFAULT_RECIPIENTS,
            ...(r.cbo ? { management: r.cbo } : {}),
            ...(r.cboWhatsapp ? { managementWhatsapp: r.cboWhatsapp } : {}),
            ...(r.mh ? { marketing: r.mh } : {}),
            ...(r.sh ? { sales: r.sh } : {}),
          } as unknown as Record<string, string>;
          p.submissions = Object.fromEntries(
            Object.entries(p.submissions ?? {})
              .filter(([, v]) => v.part === "marketing" || v.part === "sales")
              .map(([k, v]) => [k, { ...v, by: LEGACY_ROLES[v.by] ?? v.by }]),
          );
        }
        const { weight7: _w7, weight30: _w30, weight90: _w90, ...kept } = p.settings ?? {};
        if (version < 4 && kept.defaultCoverDays === 30) kept.defaultCoverDays = DEFAULT_FORMULA_SETTINGS.defaultCoverDays;
        if (version < 6) {
          if (kept.reorderAtDays === undefined || kept.reorderAtDays === 60) kept.reorderAtDays = DEFAULT_FORMULA_SETTINGS.reorderAtDays;
          if (kept.defaultCoverDays === undefined || kept.defaultCoverDays === 60) kept.defaultCoverDays = DEFAULT_FORMULA_SETTINGS.defaultCoverDays;
          if (kept.overstockDays === undefined || kept.overstockDays === 90) kept.overstockDays = DEFAULT_FORMULA_SETTINGS.overstockDays;
        }
        if (version < 7 && (kept.overstockDays === undefined || kept.overstockDays === 180)) kept.overstockDays = DEFAULT_FORMULA_SETTINGS.overstockDays;
        const settings = { ...DEFAULT_FORMULA_SETTINGS, ...kept };
        return (version < 2 ? { ...p, settings, locations: [], points: [] } : { ...p, settings }) as never;
      },
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        preset: s.preset,
        from: s.from,
        to: s.to,
        channels: s.channels,
        points: s.points,
        locations: s.locations,
        categories: s.categories,
        role: s.role,
        settings: s.settings,
        leadOverrides: s.leadOverrides,
        recipients: s.recipients,
        schedule: s.schedule,
        approvals: s.approvals,
        submissions: s.submissions,
        campaigns: s.campaigns,
        festivals: s.festivals,
      }),
      onRehydrateStorage: () => (state) => {
        // A saved preset re-resolves against today, so "Last 30 days" never goes stale.
        if (state && state.preset !== "custom") state.setPreset(state.preset);
      },
    },
  ),
);

export function submissionKey(cycleId: string, part: PlanPart): string {
  return `${cycleId}:${part}`;
}
