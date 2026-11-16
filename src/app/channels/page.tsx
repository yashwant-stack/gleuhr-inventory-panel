"use client";

import clsx from "clsx";
import { Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { SalesTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Card, CardHeader, ChannelDot, channelLabel, Delta, PageHeader, Segmented } from "@/components/ui";
import { comparer, dailyTotals, previousRange, projectionValueByChannel, salesByProduct, type ProductSales } from "@/lib/data/engine";
import { useDataset, useFilters } from "@/lib/data/hooks";
import { connectedChannels } from "@/lib/data/model";
import { diffDays, fmtDay, fmtRange } from "@/lib/dates";
import type { ChannelId } from "@/lib/domain/types";
import { fmtInt, fmtMoneyShort, pctChange } from "@/lib/format";
import { usePanel } from "@/lib/state/store";

type ChannelPick = ChannelId | "d2c";

export default function ChannelsPage() {
  const ds = useDataset();
  const base = useFilters();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const [pick, setPick] = useState<ChannelPick>("clinic");
  const [measure, setMeasure] = useState<"value" | "units">("value");

  const connected = useMemo(() => connectedChannels(ds), [ds]);
  const d2c = useMemo(() => connected.filter((c) => c !== "clinic"), [connected]);
  // The cards ARE the channels, so the channel filter is ignored here; sold-at, category and date still apply.
  const f = useMemo(() => ({ ...base, channels: [] as ChannelId[] }), [base]);
  const sales = useMemo(() => salesByProduct(ds, f), [ds, f]);
  const prev = useMemo(() => salesByProduct(ds, f, previousRange(f.from, f.to)), [ds, f]);
  const proj30 = useMemo(() => projectionValueByChannel(ds, settings, 30), [ds, settings]);
  const cmp = useMemo(() => comparer(ds, f), [ds, f]);
  const days = diffDays(f.to, f.from) + 1;

  const sum = (rows: ProductSales[], chs: ChannelId[], k: "value" | "qty") => rows.reduce((a, s) => a + chs.reduce((b, c) => b + s.byChannel[c][k], 0), 0);
  const total = sum(sales, connected, "value");
  const picked = useMemo<ChannelId[]>(() => (pick === "d2c" ? d2c : [pick]), [pick, d2c]);

  const pickedFilter = useMemo(() => ({ ...f, channels: picked }), [f, picked]);
  const points = useMemo(() => dailyTotals(ds, pickedFilter), [ds, pickedFilter]);
  const top = useMemo(
    () =>
      sales
        .map((s) => ({ s, v: picked.reduce((a, c) => a + s.byChannel[c].value, 0), q: picked.reduce((a, c) => a + s.byChannel[c].qty, 0) }))
        .filter((x) => x.q > 0)
        .sort((a, b) => b.v - a.v),
    [sales, picked],
  );
  const prevById = useMemo(() => new Map(prev.map((p) => [p.product.id, p])), [prev]);

  // Clinic-wise: each CRM clinic's own clinic sales (real sale values).
  const clinicRows = ds.clinics
    .filter((c) => c.active)
    .map((c) => {
      const srcIds = ds.sources.filter((s) => s.channel === "clinic" && s.clinicId === c.id).map((s) => s.id);
      let v = 0;
      let q = 0;
      let pv = 0;
      let best = { name: "—", q: 0 };
      for (const s of sales) {
        const sq = srcIds.reduce((a, id) => a + (s.bySource[id] ?? 0), 0);
        q += sq;
        v += srcIds.reduce((a, id) => a + (s.valueBySource[id] ?? 0), 0);
        if (sq > best.q) best = { name: s.product.name, q: sq };
      }
      for (const s of prev) pv += srcIds.reduce((a, id) => a + (s.valueBySource[id] ?? 0), 0);
      return { c, v, q, pv, best };
    })
    .filter((r) => r.q || r.pv)
    .sort((a, b) => b.v - a.v);
  const clinicTotal = clinicRows.reduce((a, r) => a + r.v, 0);

  const cards: { id: ChannelPick; label: string; chs: ChannelId[] }[] = [...connected.map((c) => ({ id: c as ChannelPick, label: channelLabel(c), chs: [c] })), { id: "d2c", label: "D2C total", chs: d2c }];
  const notConnected = ds.channels.filter((c) => !c.connected);

  return (
    <div>
      <PageHeader title="Channels" sub="Sales and stats per channel, from the clinic and online CRMs. Pick a channel to see its trend and top products." />
      <FilterBar channels={false} search={false} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => {
          const v = sum(sales, c.chs, "value");
          const pv = sum(prev, c.chs, "value");
          const q = sum(sales, c.chs, "qty");
          const p30 = c.chs.reduce((a, ch) => a + proj30[ch], 0);
          return (
            <button
              key={c.id}
              onClick={() => setPick(c.id)}
              aria-pressed={pick === c.id}
              className={clsx("rounded-xl border bg-surface p-3.5 text-left transition", pick === c.id ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line hover:shadow-sm")}
            >
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">
                {c.id === "d2c" ? <span className="h-2 w-2 rounded-full bg-ink" aria-hidden /> : <ChannelDot channel={c.id} />}
                {c.label}
              </div>
              <div className="mt-1 text-[20px] font-bold tabular">{fmtMoneyShort(v)}</div>
              <div className="text-[12px] text-ink-2">
                {fmtInt(q)} units · {total ? Math.round((v / total) * 100) : 0}% share
              </div>
              <div className="mt-1 text-[12px]">
                <Delta pct={pctChange(v, pv)} incomplete={!cmp({ channels: c.id === "d2c" ? d2c : [c.id] })} /> <span className="text-muted">vs prev.</span>
              </div>
              <div className="mt-1.5 border-t border-line pt-1.5 text-[11.5px] text-muted">Next 30 days ≈ {fmtMoneyShort(p30)}</div>
            </button>
          );
        })}
        {notConnected.map((c) => (
          <div key={c.id} className="rounded-xl border border-dashed border-line-strong bg-sunken p-3.5" title={c.note}>
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <Unplug size={13} aria-hidden /> {c.label}
            </div>
            <div className="mt-1 text-[15px] font-semibold text-ink-2">Not connected</div>
            <div className="mt-1 text-[11.5px] leading-snug text-muted">{c.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title={`${pick === "d2c" ? "D2C total" : channelLabel(pick)} over time`}
            sub={`${fmtRange(f.from, f.to)}${pick === "d2c" ? ` · ${d2c.map((c) => channelLabel(c)).join(", ")}` : ""}`}
            right={<Segmented value={measure} onChange={setMeasure} label="Measure" options={[{ value: "value", label: "₹ Value" }, { value: "units", label: "Units" }]} />}
          />
          <SalesTrendChart points={points} measure={measure} channels={picked} height={230} />
          {picked.map((c) => ds.channels.find((x) => x.id === c)).filter((c) => c?.dataFrom && c.dataFrom > f.from).map((c) => (
            <p key={c!.id} className="mt-1 text-[11.5px] text-muted">
              {c!.label} data starts {fmtDay(c!.dataFrom!)}.
            </p>
          ))}
        </Card>
        <Card className="xl:col-span-2" pad={false}>
          <div className="p-4 pb-2">
            <CardHeader className="mb-0" title="Top products" sub={`in ${pick === "d2c" ? "D2C" : channelLabel(pick)} · ${fmtRange(f.from, f.to)}`} />
          </div>
          <div className="max-h-[300px] overflow-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th className="num">Units</th>
                  <th className="num">Value</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {top.slice(0, 15).map((t, i) => {
                  const p = prevById.get(t.s.product.id);
                  const pv = p ? picked.reduce((a, c) => a + p.byChannel[c].value, 0) : 0;
                  return (
                    <tr key={t.s.product.id} className="clickable" onClick={() => openProduct(t.s.product.id)}>
                      <td className="text-muted">{i + 1}</td>
                      <td className="max-w-[200px] truncate font-medium">{t.s.product.name}</td>
                      <td className="num">{fmtInt(t.q)}</td>
                      <td className="num">{fmtMoneyShort(t.v)}</td>
                      <td className="num">
                        <Delta pct={pctChange(t.v, pv)} incomplete={!cmp({ channels: picked }, ds.products.indexOf(t.s.product))} short />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader className="mb-0" title="Clinic-wise sales" sub={`Each clinic’s own sales (online pickups not included) · ${fmtRange(f.from, f.to)} · ${days} days`} />
        </div>
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Clinic</th>
                <th className="num">Value</th>
                <th className="num">Share of clinics</th>
                <th className="num">Units</th>
                <th className="num">Per day</th>
                <th className="num">Change</th>
                <th>Best seller</th>
              </tr>
            </thead>
            <tbody>
              {clinicRows.map((r) => (
                <tr key={r.c.id}>
                  <td className="font-medium">
                    {r.c.name}
                    {r.c.zohoLocationId ? null : <span className="ml-1.5 rounded bg-st-low-soft px-1.5 text-[11px] font-semibold text-st-low">no Zoho location</span>}
                  </td>
                  <td className="num font-medium">{fmtMoneyShort(r.v)}</td>
                  <td className="num">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-1.5 w-20 rounded-full bg-sunken">
                        <span className="block h-1.5 rounded-full bg-ch-clinic" style={{ width: `${clinicTotal ? (r.v / clinicTotal) * 100 : 0}%` }} />
                      </span>
                      {clinicTotal ? Math.round((r.v / clinicTotal) * 100) : 0}%
                    </span>
                  </td>
                  <td className="num">{fmtInt(r.q)}</td>
                  <td className="num">{fmtInt(r.q / days)}</td>
                  <td className="num">
                    <Delta pct={pctChange(r.v, r.pv)} incomplete={!cmp({ channels: ["clinic"], points: [`clinic:${r.c.id}`] })} short />
                  </td>
                  <td className="max-w-[240px] truncate text-ink-2">
                    {r.best.name} <span className="text-muted">({fmtInt(r.best.q)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
