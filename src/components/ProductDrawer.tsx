"use client";

import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { locationBreakdown, seriesFor } from "@/lib/data/engine";
import { connectedChannels } from "@/lib/data/model";
import { useDataset, useMetrics, useRole } from "@/lib/data/hooks";
import { fmtDay, fmtDayLong } from "@/lib/dates";
import { PROJECTION_HORIZONS } from "@/lib/domain/types";
import { fmtDays, fmtInt, fmtMoney, fmtRate } from "@/lib/format";
import { usePanel } from "@/lib/state/store";
import { lastNDays, ProductDailyChart } from "./charts";
import { Select } from "./Select";
import { ChannelTag, channelLabel, StatusChip } from "./ui";
import type { ChannelId } from "@/lib/domain/types";
import { toast } from "./Toast";

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-ink-2">{k}</span>
      <span className={strong ? "font-semibold text-ink tabular" : "text-ink tabular"}>{v}</span>
    </div>
  );
}

/** The rate as the formula uses it (2 decimals), so a worked line adds up on screen. */
const exactRate = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function Step({ n, title, formula, result }: { n: number; title: string; formula: React.ReactNode; result: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-line px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">
          {n} · {title}
        </span>
        <span className="text-[13px] font-semibold text-ink tabular">{result}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11.5px] leading-relaxed text-ink-2">{formula}</div>
    </li>
  );
}

export function ProductDrawer() {
  const id = usePanel((s) => s.openProductId);
  const close = usePanel((s) => s.openProduct);
  const settings = usePanel((s) => s.settings);
  const setLeadOverride = usePanel((s) => s.setLeadOverride);
  const leadOverrides = usePanel((s) => s.leadOverrides);
  const role = useRole();
  const ds = useDataset();
  const metrics = useMetrics();
  const pi = ds.products.findIndex((p) => p.id === id);
  const m = pi >= 0 ? metrics[pi] : undefined;

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, close]);

  const extra = useMemo(() => {
    if (pi < 0 || !m) return null;
    const series = seriesFor(ds, pi, () => true, "used").slice(-60);
    return { series, locations: locationBreakdown(ds, settings, pi, m) };
  }, [ds, pi, settings, m]);

  if (!id || !m || !extra) return null;
  const p = m.product;
  const w = settings;
  const last30ByChannel = connectedChannels(ds).map((c) => {
    let q = 0;
    ds.sources.forEach((s, si) => {
      if (s.channel !== c) return;
      for (let d = ds.days.length - 30; d < ds.days.length; d++) q += ds.sold[pi]![si]![d]!;
    });
    return { c, q };
  });

  return (
    <div className="no-print fixed inset-0 z-40" role="dialog" aria-modal aria-label={p.name}>
      <div className="absolute inset-0 bg-ink/25" onClick={() => close(null)} />
      <div className="anim-slide absolute top-0 right-0 flex h-full w-full max-w-[560px] flex-col bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold text-ink">{p.name}</h2>
              <StatusChip status={m.status} />
              {m.isNew ? <span className="rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-semibold text-ink-2">New · since {fmtDay(p.launchedOn)}</span> : null}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              {p.sku} · {p.category} · {fmtMoney(p.price)} · Zoho item {p.id}
            </div>
          </div>
          <button onClick={() => close(null)} className="rounded-md p-1.5 text-ink-2 hover:bg-sunken" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[13px] scroll-thin">
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <Row k="Daily sales rate" v={`${fmtRate(m.rate)} / day`} strong />
              <Row k="Stock now" v={`${fmtInt(m.stock)} (WH ${fmtInt(m.warehouseStock)} + others ${fmtInt(m.clinicStock)})${m.unknownLocations.length ? ` + ${m.unknownLocations.length} unreadable` : ""}`} />
              <Row k="On the way" v={m.onOrder ? fmtInt(m.onOrder) : "—"} />
              <Row k="Days of cover" v={fmtDays(m.cover)} strong />
            </div>
            <div>
              <Row k="Runs out around" v={m.stockOut ? fmtDayLong(m.stockOut) : "—"} />
              <Row k="Lead time" v={`${m.leadTime} days`} />
              <Row k="Reorder point" v={m.rate > 0 ? `${fmtInt(m.reorderPoint)} (${m.reorderAt} days)` : "—"} />
              <Row
                k="Order now"
                v={m.indentQty ? <span className="text-coral-dark">{fmtInt(m.indentQty)}</span> : m.orderInDays ? `Not yet · due in ${m.orderInDays} days` : "Nothing"}
                strong
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Units used, last 60 days (all channels)</h3>
              <span className="text-[11.5px] text-muted">dashed line = daily rate</span>
            </div>
            <ProductDailyChart days={lastNDays(ds.today, 60)} values={extra.series} rate={m.rate} />
          </div>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold">How the numbers are worked out</h3>
            <ol className="space-y-1.5">
              <Step
                n={1}
                title="Daily sales rate"
                formula={
                  <>
                    {m.rateParts.length > 1 ? (
                      <>
                        {fmtInt(m.windowSold)} used in the last {m.windowDays} days, each sales point ÷ the days it has recorded:
                        {m.rateParts.map((x) => (
                          <span key={x.days} className="block">
                            {`${x.points} sales point${x.points === 1 ? "" : "s"} `}{x.from ? `that joined the CRM on ${fmtDayLong(x.from)}` : `recording all ${x.days} days`}: {fmtInt(x.sold)} ÷ {x.days} = {fmtRate(x.rate)}
                          </span>
                        ))}
                      </>
                    ) : (
                      <>
                        {fmtInt(m.windowSold)} used in the last {m.windowDays} days ÷ {m.windowDays}
                        {m.windowDays < w.rateWindowDays ? ` · only ${m.windowDays} days of history so far` : ""}
                      </>
                    )}
                    {m.isNew ? " · new product" : ""}
                  </>
                }
                result={`${fmtRate(m.rate)} / day`}
              />
              <Step
                n={2}
                title="Projection"
                formula={<>{PROJECTION_HORIZONS.map((h) => `${h}d ${fmtInt(m.proj[h] ?? 0)}`).join(" · ")}{m.trend !== 1 ? ` · trend ×${m.trend.toFixed(2)}` : ""}</>}
                result={`${fmtInt(m.proj[30] ?? 0)} in 30d`}
              />
              <Step n={3} title="Days of cover" formula={<>{fmtInt(m.stock)} in stock ÷ {fmtRate(m.rate)} a day</>} result={`${fmtDays(m.cover)} days`} />
              <Step
                n={4}
                title="Reorder point (order when the stock left falls to it)"
                formula={
                  <>
                    {exactRate(m.rate)} a day × {m.reorderAt} days of stock left
                    {m.reorderAt > w.reorderAtDays ? ` (the ${m.leadTime}-day lead time, longer than ${w.reorderAtDays} days)` : ""}
                  </>
                }
                result={fmtInt(m.reorderPoint)}
              />
              <Step
                n={5}
                title="Status"
                formula={
                  m.status === "critical"
                    ? `${fmtDays(m.cover)} days of cover < ${m.leadTime}-day lead time: runs out before new stock can arrive`
                    : m.status === "low"
                      ? `${fmtInt(m.stock)} + ${fmtInt(m.onOrder)} on the way ≤ reorder point ${fmtInt(m.reorderPoint)}: time to order`
                      : m.status === "overstock"
                        ? `${fmtDays(m.cover)} days of cover > ${w.overstockDays}-day limit · ${fmtInt(m.excess)} excess units`
                        : m.status === "no_sales"
                          ? `Nothing sold in the last ${w.rateWindowDays} days`
                          : `Above the reorder point and under ${w.overstockDays} days of cover${m.nextArrivalDays !== null ? ` · order lands in ${m.nextArrivalDays} days` : ""}`
                }
                result={<StatusChip status={m.status} size="sm" />}
              />
              <Step
                n={6}
                title={`Order quantity (cover ${w.defaultCoverDays} days)`}
                formula={
                  <>
                    {exactRate(m.rate)} × ({m.leadTime} lead + {w.defaultCoverDays} cover) − {fmtInt(m.stock)} stock − {fmtInt(m.onOrder)} on the way = {fmtRate(m.indentRaw)}
                    {p.packSize > 1 ? ` → round up to pack of ${p.packSize}` : ""}
                    {!m.indentDue && m.rate > 0 ? ` · not due yet: the stock left is above the reorder point${m.orderInDays ? ` (due in ${m.orderInDays} days)` : ""}` : ""}
                  </>
                }
                result={m.indentQty ? fmtInt(m.indentQty) : "0"}
              />
            </ol>
          </div>

          <div>
            <h3 className="mb-1 text-[13px] font-semibold">Stock by location</h3>
            <p className="mb-2 text-[11.5px] text-muted">Zoho counts stock per location. Each location’s usage is every channel that takes stock from it.</p>
            <div className="overflow-x-auto scroll-thin">
              <table className="dtable text-[12.5px]">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th className="num">Stock</th>
                    <th className="num">Uses / day</th>
                    <th>Taken by</th>
                    <th className="num">Days left</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {extra.locations
                    .filter((r) => r.stock !== 0 || r.rate > 0 || r.stock === null)
                    .map((r) => (
                      <tr key={r.location.id}>
                        <td className="whitespace-nowrap">{r.location.name}</td>
                        <td className="num">{r.stock === null ? <span className="text-muted" title="The Zoho login can’t read this location">can’t read</span> : fmtInt(r.stock)}</td>
                        <td className="num">{fmtRate(r.rate)}</td>
                        <td className="text-[11.5px] text-ink-2">
                          {Object.entries(r.byChannel)
                            .filter(([, v]) => (v ?? 0) > 0)
                            .map(([c, v]) => `${channelLabel(c as ChannelId, true)} ${fmtRate(v ?? 0)}`)
                            .join(" · ") || "—"}
                        </td>
                        <td className="num">{r.cover === null ? "—" : fmtDays(r.cover)}</td>
                        <td>{r.status === "unknown" ? <span className="text-[11.5px] text-muted">unknown</span> : <StatusChip status={r.status} size="sm" />}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[13px] font-semibold">Sold in the last 30 days</h3>
              {last30ByChannel.map(({ c, q }) => (
                <Row key={c} k={""} v={<span className="flex w-full justify-between gap-6"><ChannelTag channel={c} /> {fmtInt(q)}</span>} />
              ))}
            </div>
            <div>
              <h3 className="mb-2 text-[13px] font-semibold">Open purchase orders</h3>
              {m.openPOs.length === 0 ? (
                <p className="text-muted">None on the way.</p>
              ) : (
                m.openPOs.map((po) => (
                  <div key={po.id} className="mb-1 rounded-lg bg-sunken px-2.5 py-1.5">
                    <div className="font-medium">
                      {po.id} · {fmtInt(po.qty)} units
                    </div>
                    <div className="text-[12px] text-ink-2">
                      Ordered {fmtDay(po.orderedOn)} · arrives {fmtDay(po.expectedOn)}
                    </div>
                  </div>
                ))
              )}
              <h3 className="mt-4 mb-1 text-[13px] font-semibold">Lead time for this product</h3>
              <Select<string>
                value={String(leadOverrides[p.id] ?? "vendor")}
                onChange={(v) => {
                  setLeadOverride(p.id, v === "vendor" ? null : Number(v));
                  toast("Lead time saved in this browser only. Saving it for everyone comes with personal logins.");
                }}
                disabled={role.access !== "admin"}
                disabledReason="Only Management can change lead times"
                options={[
                  { value: "vendor", label: `Vendor default (${ds.vendors.find((v) => v.id === p.vendorId)?.leadTimeDays ?? "—"} days)` },
                  ...[7, 15, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `${d} days` })),
                ]}
              />
              <p className="mt-1 text-[11.5px] text-muted">{m.vendorName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
