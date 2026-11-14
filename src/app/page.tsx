"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SalesTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Card, CardHeader, ChannelDot, channelLabel, Delta, PageHeader, Segmented, StatTile, StatusChip, CHANNEL_COLOR } from "@/components/ui";
import { CHANNEL_IDS, dailyTotals, previousRange, projectionValueByChannel, salesByProduct, urgency } from "@/lib/data/engine";
import { useDataset, useFilters, useMetrics, useRole, useSubmissions } from "@/lib/data/hooks";
import { cycleState, submissionStatus } from "@/lib/data/plans";
import { diffDays, fmtDay, fmtRange } from "@/lib/dates";
import type { ChannelId } from "@/lib/domain/types";
import { fmtDays, fmtInt, fmtMoneyShort, fmtRate, pctChange } from "@/lib/format";
import { CYCLES } from "@/lib/mock/plans";
import { PLAN_PARTS, roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

export default function HomePage() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const role = useRole();
  const subs = useSubmissions();
  const [measure, setMeasure] = useState<"value" | "units">("value");

  const channels = (f.channels.length ? f.channels : CHANNEL_IDS) as ChannelId[];
  const sales = useMemo(() => salesByProduct(ds, f), [ds, f]);
  const prev = useMemo(() => salesByProduct(ds, f, previousRange(f.from, f.to)), [ds, f]);
  const points = useMemo(() => dailyTotals(ds, f), [ds, f]);
  const proj = useMemo(() => [7, 15, 30].map((h) => ({ h, v: projectionValueByChannel(ds, settings, h) })), [ds, settings]);

  const total = sales.reduce((a, s) => a + s.value, 0);
  const prevTotal = prev.reduce((a, s) => a + s.value, 0);
  const units = sales.reduce((a, s) => a + s.qty, 0);
  const prevUnits = prev.reduce((a, s) => a + s.qty, 0);
  const days = diffDays(f.to, f.from) + 1;
  const byChannel = channels.map((c) => ({
    c,
    v: sales.reduce((a, s) => a + s.byChannel[c].value, 0),
    pv: prev.reduce((a, s) => a + s.byChannel[c].value, 0),
  }));
  const maxCh = Math.max(1, ...byChannel.map((x) => x.v));

  const critical = metrics.filter((m) => m.status === "critical");
  const low = metrics.filter((m) => m.status === "low");
  const over = metrics.filter((m) => m.status === "overstock");
  const stuck = over.reduce((a, m) => a + m.excess * m.product.cost, 0);
  const toOrder = [...critical, ...low].reduce((a, m) => a + m.indentQty * m.product.cost, 0);
  const action = [...metrics].filter((m) => m.status !== "healthy" && m.status !== "no_sales").sort((a, b) => urgency(a) - urgency(b)).slice(0, 8);

  const weekly = CYCLES.find((c) => c.kind === "weekly" && cycleState(c, ds.today) === "open");
  const nextMonthly = CYCLES.filter((c) => c.kind === "monthly" && cycleState(c, ds.today) === "upcoming").sort((a, b) => a.requestOn.localeCompare(b.requestOn))[0];

  return (
    <div>
      <PageHeader title="Home" sub={`Where sales and stock stand today, ${fmtDay(ds.today)}. Click any product to see how its numbers are worked out.`} />
      <FilterBar search={false} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label={`Sales · ${fmtRange(f.from, f.to)}`} value={fmtMoneyShort(total)} sub={<><Delta pct={pctChange(total, prevTotal)} /> vs previous {days} days</>} />
        <StatTile label="Units sold" value={fmtInt(units)} sub={<>{fmtInt(units / days)} a day · <Delta pct={pctChange(units, prevUnits)} /></>} />
        <StatTile href="/stock?status=urgent" tone="critical" label="Critical + Low products" value={critical.length + low.length} sub={`${critical.length} critical · ${low.length} low`} />
        <StatTile href="/stock?status=overstock" tone="over" label="Overstock products" value={over.length} sub={`${fmtMoneyShort(stuck)} stuck at cost`} />
        <StatTile href={role.access === "planner" ? undefined : "/indent"} label="Suggested order now" value={fmtMoneyShort(toOrder)} sub={`at cost, ${critical.length + low.length} products`} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Sales over time"
            sub={`${fmtRange(f.from, f.to)} · by channel`}
            right={<Segmented value={measure} onChange={setMeasure} label="Measure" options={[{ value: "value", label: "₹ Value" }, { value: "units", label: "Units" }]} />}
          />
          <SalesTrendChart points={points} measure={measure} channels={channels} />
        </Card>
        <Card>
          <CardHeader title="Sales by channel" sub="value, and change vs the previous period" right={<Link href="/channels" className="text-[12.5px] font-medium text-coral hover:underline">Channels →</Link>} />
          <ul className="space-y-3">
            {byChannel.map(({ c, v, pv }) => (
              <li key={c}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <ChannelDot channel={c} /> {channelLabel(c)}
                  </span>
                  <span className="tabular">
                    <span className="font-semibold">{fmtMoneyShort(v)}</span> <span className="text-[12px] text-muted">{total ? Math.round((v / total) * 100) : 0}%</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-sunken">
                    <div className="h-2 rounded-full" style={{ width: `${(v / maxCh) * 100}%`, background: CHANNEL_COLOR[c] }} />
                  </div>
                  <span className="w-14 text-right text-[12px]">
                    <Delta pct={pctChange(v, pv)} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2" pad={false}>
          <div className="p-4 pb-2">
            <CardHeader
              className="mb-0"
              title="Products that need action"
              sub="As of today, every channel and location · most urgent first"
              right={<Link href="/stock" className="text-[12.5px] font-medium text-coral hover:underline">All stock →</Link>}
            />
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Stock</th>
                  <th className="num">Sells / day</th>
                  <th className="num">Days left</th>
                  <th>Runs out</th>
                  <th>Status</th>
                  <th className="num">Order now</th>
                </tr>
              </thead>
              <tbody>
                {action.map((m) => (
                  <tr key={m.product.id} className="clickable" onClick={() => openProduct(m.product.id)}>
                    <td className="max-w-[240px] truncate font-medium">{m.product.name}</td>
                    <td className="num">{fmtInt(m.stock)}</td>
                    <td className="num">{fmtRate(m.rate)}</td>
                    <td className="num">{fmtDays(m.cover)}</td>
                    <td>{m.stockOut ? fmtDay(m.stockOut) : "—"}</td>
                    <td>
                      <StatusChip status={m.status} size="sm" />
                    </td>
                    <td className="num font-semibold">{m.indentQty ? fmtInt(m.indentQty) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader title="Forecast sales" sub="Next 7 / 15 / 30 days at today’s trend" right={<Link href="/projections" className="text-[12.5px] font-medium text-coral hover:underline">Projections →</Link>} />
            <div className="grid grid-cols-3 gap-2">
              {proj.map(({ h, v }) => (
                <div key={h} className="rounded-lg bg-sunken p-2.5">
                  <div className="text-[11.5px] text-ink-2">Next {h} days</div>
                  <div className="text-[16px] font-bold tabular">{fmtMoneyShort(channels.reduce((a, c) => a + v[c], 0))}</div>
                </div>
              ))}
            </div>
          </Card>
          {weekly ? (
            <Card>
              <CardHeader
                title={`Weekly plan · ${weekly.label}`}
                sub={weekly.dueOn === ds.today ? "Due today (Saturday)" : `Due ${fmtDay(weekly.dueOn)}`}
                right={<Link href="/plans" className="text-[12.5px] font-medium text-coral hover:underline">Plans →</Link>}
              />
              <ul className="space-y-1.5">
                {PLAN_PARTS.map((p) => {
                  const st = submissionStatus(weekly, subs[`${weekly.id}:${p.id}`], ds.today);
                  return (
                    <li key={p.id} className="flex items-center justify-between text-[13px]">
                      <span>
                        {p.label} <span className="text-muted">· {roleById(p.owner).person}</span>
                      </span>
                      <span className={st === "pending" ? "font-semibold text-st-low" : "font-semibold text-st-healthy"}>{st === "pending" ? "Pending" : "Submitted"}</span>
                    </li>
                  );
                })}
              </ul>
              {nextMonthly ? <p className="mt-2 border-t border-line pt-2 text-[12px] text-muted">Next monthly request ({nextMonthly.label}) goes out on {fmtDay(nextMonthly.requestOn)}.</p> : null}
              {role.planPart ? (
                <Link href={`/plans/form?cycle=${weekly.id}&part=${role.planPart}`} className="mt-3 inline-block rounded-lg bg-coral px-3 py-1.5 text-[13px] font-medium text-white">
                  Open my plan
                </Link>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
