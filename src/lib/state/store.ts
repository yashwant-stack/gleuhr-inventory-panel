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
import type { PlanPart, RoleId } from "../roles";

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

export function presetRange(p: Exclude<DatePreset, "custom">, today = TODAY): { from: string; to: string } {
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
  cbo: string;
  md: string;
  herman: string;
  mh: string;
  sh: string;
  online: string;
  manisha: string;
  cboWhatsapp: string;
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
  locations: string[];
  categories: string[];
  search: string;
  setPreset: (p: Exclude<DatePreset, "custom">) => void;
  setCustomRange: (from: string, to: string) => void;
  setChannels: (c: ChannelId[]) => void;
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

  // UI
  openProductId: string | null;
  openProduct: (id: string | null) => void;
}

export const DEFAULT_RECIPIENTS: Recipients = {
  cbo: "cbo@gleuhr.com",
  md: "md@gleuhr.com",
  herman: "herman@gleuhr.com",
  mh: "marketing.head@gleuhr.com",
  sh: "sales.head@gleuhr.com",
  online: "online.team@gleuhr.com",
  manisha: "manisha@gleuhr.com",
  cboWhatsapp: "+91 98xxx xxxxx",
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
      locations: [],
      categories: [],
      search: "",
      setPreset: (p) => set({ preset: p, ...presetRange(p) }),
      setCustomRange: (from, to) => set({ preset: "custom", from: from <= to ? from : to, to: from <= to ? to : from }),
      setChannels: (channels) => set({ channels }),
      setLocations: (locations) => set({ locations }),
      setCategories: (categories) => set({ categories }),
      setSearch: (search) => set({ search }),
      resetFilters: () => set({ preset: "30d", ...presetRange("30d"), channels: [], locations: [], categories: [], search: "" }),

      role: "cbo",
      setRole: (role) => set({ role }),

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

      openProductId: null,
      openProduct: (openProductId) => set({ openProductId }),
    }),
    {
      name: "gleuhr-inventory-panel",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        preset: s.preset,
        from: s.from,
        to: s.to,
        channels: s.channels,
        locations: s.locations,
        categories: s.categories,
        role: s.role,
        settings: s.settings,
        leadOverrides: s.leadOverrides,
        recipients: s.recipients,
        schedule: s.schedule,
        approvals: s.approvals,
        submissions: s.submissions,
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
