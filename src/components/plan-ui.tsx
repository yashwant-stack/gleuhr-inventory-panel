"use client";

import clsx from "clsx";
import type { SubmissionStatus } from "@/lib/data/plans";

export const SUB_META: Record<SubmissionStatus, { label: string; cls: string }> = {
  on_time: { label: "Submitted on time", cls: "bg-st-healthy-soft text-st-healthy" },
  late: { label: "Submitted late", cls: "bg-st-low-soft text-st-low" },
  pending: { label: "Pending", cls: "bg-st-low-soft text-st-low" },
  missing: { label: "Missing", cls: "bg-st-critical-soft text-st-critical" },
  not_open: { label: "Not open yet", cls: "bg-st-none-soft text-st-none" },
};

export function SubmissionChip({ status }: { status: SubmissionStatus }) {
  const m = SUB_META[status];
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap", m.cls)}>{m.label}</span>;
}
