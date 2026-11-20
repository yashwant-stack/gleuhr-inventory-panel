"use client";

import clsx from "clsx";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "./Popover";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  group?: string;
}

/** Custom dropdown (single choice). Searchable when it has more than 8 options. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  width,
  disabled,
  disabledReason,
  ariaLabel,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label?: string;
  width?: number;
  disabled?: boolean;
  disabledReason?: string;
  /** Accessible name when no visible label is shown. */
  ariaLabel?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q]);
  return (
    <>
      <button
        ref={btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        title={disabled ? disabledReason : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]",
          disabled ? "cursor-not-allowed border-dashed border-line-strong bg-sunken text-muted" : "border-line-strong bg-surface text-ink hover:bg-sunken",
        )}
        style={width ? { width } : undefined}
      >
        {label ? <span className="text-muted">{label}:</span> : null}
        {current?.icon}
        <span className="truncate font-medium">{current?.label ?? "Choose"}</span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-muted" aria-hidden />
      </button>
      <Popover anchor={btn} open={open} onClose={() => { setOpen(false); setQ(""); }} width={Math.max(width ?? 0, 220)}>
        {options.length > 8 ? (
          <div className="sticky top-0 border-b border-line bg-surface p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-line px-2">
              <Search size={13} className="text-muted" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-full bg-transparent text-[13px] outline-none" />
            </div>
          </div>
        ) : null}
        <ul role="listbox" className="p-1">
          {shown.map((o) => (
            <li key={o.value}>
              <button
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
              >
                <span className="w-4 shrink-0">{o.value === value ? <Check size={15} strokeWidth={2.6} /> : null}</span>
                {o.icon}
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint ? <span className="block truncate text-[11.5px] text-muted">{o.hint}</span> : null}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-muted">Nothing matches</li> : null}
        </ul>
      </Popover>
    </>
  );
}

/** Custom dropdown (several choices). Empty selection = "All". */
export function MultiSelect<T extends string>({
  values,
  options,
  onChange,
  label,
  allLabel = "All",
  width,
}: {
  values: T[];
  options: Option<T>[];
  onChange: (v: T[]) => void;
  label: string;
  allLabel?: string;
  width?: number;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q]);
  const summary =
    values.length === 0 ? allLabel : values.length === 1 ? (options.find((o) => o.value === values[0])?.label ?? "1 selected") : `${values.length} selected`;
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <>
      <button
        ref={btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] hover:bg-sunken",
          values.length ? "border-ink bg-surface" : "border-line-strong bg-surface",
        )}
        style={width ? { width } : undefined}
      >
        <span className="text-muted">{label}:</span>
        <span className="truncate font-medium">{summary}</span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-muted" aria-hidden />
      </button>
      <Popover anchor={btn} open={open} onClose={() => { setOpen(false); setQ(""); }} width={250}>
        <div className="sticky top-0 z-10 border-b border-line bg-surface p-2">
          {options.length > 8 ? (
            <div className="mb-2 flex items-center gap-1.5 rounded-md border border-line px-2">
              <Search size={13} className="text-muted" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-full bg-transparent text-[13px] outline-none" />
            </div>
          ) : null}
          <div className="flex justify-between text-[12px]">
            <button className="font-medium text-coral hover:underline" onClick={() => onChange([])}>
              {allLabel} (clear)
            </button>
            <button className="text-ink-2 hover:underline" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
        <ul role="listbox" aria-multiselectable className="p-1">
          {shown.map((o, i) => {
            const header = o.group && (i === 0 || shown[i - 1]?.group !== o.group) ? o.group : null;
            return (
              <li key={o.value}>
                {header ? <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{header}</div> : null}
                <button
                  role="option"
                  aria-selected={values.includes(o.value)}
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
                >
                  <span
                    className={clsx(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      values.includes(o.value) ? "border-ink bg-ink text-white" : "border-line-strong",
                    )}
                  >
                    {values.includes(o.value) ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
