"use client";

import clsx from "clsx";
import { describe } from "@/lib/glossary";
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleSlash, Layers, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ChannelId, StockStatus } from "@/lib/domain/types";
import { CHANNELS } from "@/lib/mock/catalog";

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={clsx("min-w-0 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(28,27,25,0.04)]", pad && "p-4", className)}>{children}</section>;
}

export function CardHeader({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-3 flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "confirm";

export function Button({
  children,
  variant = "secondary",
  onClick,
  disabled,
  disabledReason,
  icon,
  size = "md",
  type = "button",
  className,
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  onClick?: () => void;
  disabled?: boolean;
  /** Plain-words reason shown on hover AND under the control for screen readers — never a dead button that looks alive. */
  disabledReason?: string;
  icon?: ReactNode;
  size?: "sm" | "md";
  type?: "button" | "submit";
  className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors whitespace-nowrap";
  const sizes = size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8.5 px-3 text-[13px]";
  const variants: Record<BtnVariant, string> = {
    primary: "bg-coral text-white hover:bg-coral-dark",
    confirm: "bg-confirm text-white hover:brightness-95",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
    ghost: "text-ink-2 hover:bg-sunken",
  };
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      className={clsx(base, sizes, disabled ? "cursor-not-allowed border border-dashed border-line-strong bg-sunken text-muted" : variants[variant], className)}
    >
      {icon}
      {children}
      {disabled && disabledReason ? <span className="sr-only">{` — ${disabledReason}`}</span> : null}
    </button>
  );
}

export const STATUS_META: Record<StockStatus, { label: string; cls: string; dot: string; Icon: typeof AlertOctagon; help: string }> = {
  critical: { label: "Critical", cls: "bg-st-critical-soft text-st-critical", dot: "bg-st-critical", Icon: AlertOctagon, help: "Runs out before new stock can arrive" },
  low: { label: "Low", cls: "bg-st-low-soft text-st-low", dot: "bg-st-low", Icon: AlertTriangle, help: "Stock + on the way is below the reorder point" },
  healthy: { label: "Healthy", cls: "bg-st-healthy-soft text-st-healthy", dot: "bg-st-healthy", Icon: CheckCircle2, help: "Enough stock, not too much" },
  overstock: { label: "Overstock", cls: "bg-st-over-soft text-st-over", dot: "bg-st-over", Icon: Layers, help: "More days of stock than the overstock limit" },
  no_sales: { label: "No sales", cls: "bg-st-none-soft text-st-none", dot: "bg-st-none", Icon: CircleSlash, help: "Nothing sold in the last 90 days" },
};

export function StatusChip({ status, size = "md" }: { status: StockStatus; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  return (
    <span title={m.help} className={clsx("inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap", m.cls, size === "sm" ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-[12px]")}>
      <m.Icon size={size === "sm" ? 11 : 12} strokeWidth={2.4} aria-hidden />
      {m.label}
    </span>
  );
}

export const CHANNEL_COLOR: Record<ChannelId, string> = {
  clinic: "var(--color-ch-clinic)",
  online_team: "var(--color-ch-online)",
  amazon: "var(--color-ch-amazon)",
  flipkart: "var(--color-ch-flipkart)",
  website: "var(--color-ch-website)",
};

export const CHANNEL_HEX: Record<ChannelId, string> = {
  clinic: "#2a78d6",
  online_team: "#eb6834",
  amazon: "#1baf7a",
  flipkart: "#eda100",
  website: "#e87ba4",
};

export function channelLabel(id: ChannelId, short = false): string {
  const c = CHANNELS.find((x) => x.id === id);
  return c ? (short ? c.short : c.label) : id;
}

export function ChannelDot({ channel, size = 8 }: { channel: ChannelId; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: CHANNEL_COLOR[channel] }} />;
}

export function ChannelTag({ channel }: { channel: ChannelId }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <ChannelDot channel={channel} />
      {channelLabel(channel)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "critical" | "low" | "over" | "good";
  onClick?: () => void;
  href?: string;
}) {
  const tones = {
    neutral: "bg-surface border-line",
    critical: "bg-st-critical-soft border-[#f2cccc]",
    low: "bg-st-low-soft border-[#f3dfae]",
    over: "bg-st-over-soft border-[#cfd6ec]",
    good: "bg-st-healthy-soft border-[#c6e4d3]",
  };
  const cls = clsx("block rounded-xl border p-3.5 text-left", tones[tone], (onClick || href) && "cursor-pointer transition hover:shadow-sm");
  const body = (
    <>
      <div className="text-[12px] font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-[22px] leading-tight font-bold tracking-tight text-ink tabular">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-ink-2">{sub}</div> : null}
    </>
  );
  // the whole tile explains itself on hover (src/lib/glossary.ts)
  const tip = (typeof label === "string" ? describe(label) : null) ?? undefined;
  if (href) return <Link href={href} className={cls} data-tip={tip}>{body}</Link>;
  if (onClick) return <button onClick={onClick} className={cls} data-tip={tip}>{body}</button>;
  return <div className={cls} data-tip={tip}>{body}</div>;
}

const INCOMPLETE_WHY = "Some of these sales points began recording in the CRM during the earlier period, so a change would mostly show them joining, not growth.";

export function Delta({ pct, invert = false, incomplete = false, short = false }: { pct: number | null; invert?: boolean; incomplete?: boolean; short?: boolean }) {
  if (incomplete)
    return (
      <span className="text-muted" title={INCOMPLETE_WHY}>
        {short ? "incomplete" : "earlier data incomplete"}
      </span>
    );
  if (pct === null || !Number.isFinite(pct)) return <span className="text-muted">no earlier data</span>;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={clsx("font-semibold tabular", good ? "text-st-healthy" : "text-st-critical")}>
      {up ? "▲" : "▼"} {Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : Math.round(Math.abs(pct))}%
    </span>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  disabledReason,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      className={clsx("inline-flex max-w-full flex-wrap rounded-lg border bg-surface p-0.5", disabled ? "cursor-not-allowed border-dashed border-line-strong bg-sunken" : "border-line-strong")}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-7 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
            o.value === value ? (disabled ? "bg-line-strong text-ink-2" : "bg-ink text-white") : disabled ? "cursor-not-allowed text-muted" : "text-ink-2 hover:bg-sunken",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap",
            t.value === value ? "border-coral text-ink" : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="rounded-full bg-confirm-soft px-1.5 text-[11px] font-semibold text-confirm">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]", tone === "warn" ? "bg-st-low-soft text-[#7a4f00]" : "bg-sunken text-ink-2")}>
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      {children ? <div className="mt-1 text-[12.5px] text-muted">{children}</div> : null}
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 22, color = "#52514e" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A horizontal share bar split by channel (with a 2px surface gap between segments). */
export function ChannelSplitBar({ parts, height = 8 }: { parts: { channel: ChannelId; value: number }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <div className="h-2 rounded-full bg-sunken" />;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.channel} title={`${channelLabel(p.channel)}: ${Math.round((p.value / total) * 100)}%`} style={{ width: `${(p.value / total) * 100}%`, background: CHANNEL_COLOR[p.channel] }} />
        ))}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{title}</h1>
        {sub ? <p className="mt-0.5 max-w-3xl text-[13px] text-ink-2">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function SortTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  num,
  title,
}: {
  label: ReactNode;
  sortKey: string;
  current: string;
  dir: "asc" | "desc";
  onSort: (k: string) => void;
  num?: boolean;
  title?: string;
}) {
  const active = current === sortKey;
  return (
    <th className={num ? "num" : undefined} title={title} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(sortKey)} className={clsx("inline-flex items-center gap-1 font-semibold", active ? "text-ink" : "")}>
        {label}
        <span className="text-[10px] text-muted">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function sortRows<T>(rows: T[], getters: Record<string, (r: T) => number | string>, key: string, dir: "asc" | "desc"): T[] {
  const g = getters[key];
  if (!g) return rows;
  return [...rows].sort((a, b) => {
    const x = g(a);
    const y = g(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? c : -c;
  });
}
