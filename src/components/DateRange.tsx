"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { fmtRange } from "@/lib/dates";
import { useDataset } from "@/lib/data/hooks";
import { DATE_PRESETS, usePanel } from "@/lib/state/store";
import { Popover } from "./Popover";

/** Date range: preset rows (today, last 7/15/30/60/90 days, this month, last month) + any custom range. */
export function DateRange() {
  const { preset, from, to, setPreset, setCustomRange } = usePanel();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);
  const ds = useDataset();
  const minDay = ds.days[0]!;
  const TODAY = ds.today;
  const label = preset === "custom" ? "Custom" : (DATE_PRESETS.find((p) => p.id === preset)?.label ?? "");
  return (
    <>
      <button
        ref={btn}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setCFrom(from);
          setCTo(to);
          setOpen((o) => !o);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink bg-surface px-2.5 text-[13px] hover:bg-sunken"
      >
        <CalendarDays size={14} aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="text-ink-2 tabular">{fmtRange(from, to)}</span>
        <ChevronDown size={14} className="text-muted" aria-hidden />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={270}>
        <ul className="p-1">
          {DATE_PRESETS.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setPreset(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
              >
                <span className="w-4">{preset === p.id ? <Check size={15} strokeWidth={2.6} /> : null}</span>
                {p.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-3">
          <div className="mb-2 text-[12px] font-semibold text-ink-2">Custom range</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11.5px] text-muted">
              From
              <input type="date" min={minDay} max={TODAY} value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong px-1.5 text-[12.5px] text-ink" />
            </label>
            <label className="text-[11.5px] text-muted">
              To
              <input type="date" min={minDay} max={TODAY} value={cTo} onChange={(e) => setCTo(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong px-1.5 text-[12.5px] text-ink" />
            </label>
          </div>
          <button
            onClick={() => {
              if (cFrom && cTo) {
                setCustomRange(cFrom < minDay ? minDay : cFrom, cTo > TODAY ? TODAY : cTo);
                setOpen(false);
              }
            }}
            className="mt-2 h-8 w-full rounded-lg bg-ink text-[13px] font-medium text-white hover:opacity-90"
          >
            Apply custom range
          </button>
          <p className="mt-1.5 text-[11px] text-muted">{ds.origin === "sample" ? "Sample data" : "Data"} covers {fmtRange(minDay, TODAY)}.</p>
        </div>
      </Popover>
    </>
  );
}
