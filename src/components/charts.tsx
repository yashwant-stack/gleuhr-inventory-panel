"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayPoint } from "@/lib/data/engine";
import { addDays, fmtDay, fmtRange } from "@/lib/dates";
import type { ChannelId } from "@/lib/domain/types";
import { fmtInt, fmtMoneyShort } from "@/lib/format";
import { CHANNEL_HEX, ChannelDot, channelLabel } from "./ui";

const AXIS = { stroke: "#c3c2b7", fontSize: 11.5, tickLine: false, axisLine: false, tick: { fill: "#7d7a72" } } as const;
const GRID = "#ebe8e1";

export function Legend({ channels }: { channels: ChannelId[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">
      {channels.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <ChannelDot channel={c} />
          {channelLabel(c)}
        </span>
      ))}
    </div>
  );
}

interface TipRow {
  label: string;
  value: string;
  channel?: ChannelId;
}

function TipBox({ title, rows, total }: { title: string; rows: TipRow[]; total?: string }) {
  return (
    <div className="min-w-[170px] rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-md">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            {r.channel ? <ChannelDot channel={r.channel} /> : null}
            {r.label}
          </span>
          <span className="font-medium text-ink tabular">{r.value}</span>
        </div>
      ))}
      {total ? (
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular">{total}</span>
        </div>
      ) : null}
    </div>
  );
}

interface Bucket {
  key: string;
  label: string;
  from: string;
  to: string;
  [ch: string]: number | string;
}

/** Sales over time, stacked by channel. Daily bars up to 45 days, weekly bars beyond. */
export function SalesTrendChart({ points, measure, channels, height = 240 }: { points: DayPoint[]; measure: "units" | "value"; channels: ChannelId[]; height?: number }) {
  const weekly = points.length > 45;
  const buckets: Bucket[] = [];
  if (!weekly) {
    for (const p of points) {
      const b: Bucket = { key: p.day, label: fmtDay(p.day), from: p.day, to: p.day };
      for (const c of channels) b[c] = measure === "units" ? p.byChannel[c] : p.byChannelValue[c];
      buckets.push(b);
    }
  } else {
    for (let i = points.length - 1; i >= 0; i -= 7) {
      const slice = points.slice(Math.max(0, i - 6), i + 1);
      const from = slice[0]!.day;
      const to = slice[slice.length - 1]!.day;
      const b: Bucket = { key: from, label: fmtDay(from), from, to };
      for (const c of channels) b[c] = slice.reduce((a, p) => a + (measure === "units" ? p.byChannel[c] : p.byChannelValue[c]), 0);
      buckets.unshift(b);
    }
  }
  const fmt = measure === "units" ? fmtInt : fmtMoneyShort;
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={weekly ? "18%" : "22%"}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...AXIS} width={48} tickFormatter={(v: number) => (measure === "units" ? fmtInt(v) : fmtMoneyShort(v).replace("₹", ""))} />
            <Tooltip
              cursor={{ fill: "rgba(28,27,25,0.05)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0]!.payload as Bucket;
                const rows = channels.map((c) => ({ label: channelLabel(c), value: fmt(Number(b[c] ?? 0)), channel: c }));
                const total = channels.reduce((a, c) => a + Number(b[c] ?? 0), 0);
                return <TipBox title={weekly ? `Week ${fmtRange(b.from, b.to)}` : fmtDay(b.from)} rows={rows} total={fmt(total)} />;
              }}
            />
            {channels.map((c, i) => (
              <Bar key={c} dataKey={c} stackId="s" fill={CHANNEL_HEX[c]} stroke="#fff" strokeWidth={1} radius={i === channels.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Legend channels={channels} />
        <span className="text-[11.5px] text-muted">{weekly ? "Weekly totals" : "Daily totals"}</span>
      </div>
    </div>
  );
}

/** Projected units for each horizon, stacked by channel. */
export function ProjectionChart({ data, channels, measure, height = 230 }: { data: { horizon: number; byChannel: Record<ChannelId, number> }[]; channels: ChannelId[]; measure: "units" | "value"; height?: number }) {
  const rows = data.map((d) => ({ label: `${d.horizon} days`, ...d.byChannel }));
  const fmt = measure === "units" ? fmtInt : fmtMoneyShort;
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} width={52} tickFormatter={(v: number) => (measure === "units" ? fmtInt(v) : fmtMoneyShort(v).replace("₹", ""))} />
            <Tooltip
              cursor={{ fill: "rgba(28,27,25,0.05)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as Record<string, number | string>;
                const total = channels.reduce((a, c) => a + Number(r[c] ?? 0), 0);
                return <TipBox title={`Next ${String(r.label)}`} rows={channels.map((c) => ({ label: channelLabel(c), value: fmt(Number(r[c] ?? 0)), channel: c }))} total={fmt(total)} />;
              }}
            />
            {channels.map((c, i) => (
              <Bar key={c} dataKey={c} stackId="p" fill={CHANNEL_HEX[c]} stroke="#fff" strokeWidth={1} radius={i === channels.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2">
        <Legend channels={channels} />
      </div>
    </div>
  );
}

/** One product's units per day with its daily-rate line. */
export function ProductDailyChart({ days, values, rate, height = 150 }: { days: string[]; values: number[]; rate: number; height?: number }) {
  const rows = days.map((d, i) => ({ day: d, label: fmtDay(d), units: values[i] ?? 0 }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...AXIS} width={28} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(28,27,25,0.05)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as { day: string; units: number };
              return <TipBox title={fmtDay(r.day)} rows={[{ label: "Units sold", value: fmtInt(r.units) }]} />;
            }}
          />
          <Bar dataKey="units" fill="#2a78d6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <ReferenceLine y={rate} stroke="#d75649" strokeDasharray="4 3" strokeWidth={1.5} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function lastNDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}
