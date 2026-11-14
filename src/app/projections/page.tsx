"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { ProjectionChart } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Button, Card, CardHeader, Note, PageHeader, Segmented, sortRows, SortTh, StatTile, StatusChip, channelLabel } from "@/components/ui";
import { CHANNEL_IDS, channelRates, productMatches, totalSeries, unitValue } from "@/lib/data/engine";
import { useDataset, useFilters, useMetrics } from "@/lib/data/hooks";
import { downloadCsv } from "@/lib/csv";
import { projection, trendFactor } from "@/lib/domain/formulas";
import { PROJECTION_HORIZONS, type ChannelId } from "@/lib/domain/types";
import { fmtInt, fmtMoneyShort, fmtRate } from "@/lib/format";
import { usePanel } from "@/lib/state/store";

export default function ProjectionsPage() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const [measure, setMeasure] = useState<"units" | "value">("units");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "p30", dir: "desc" });
  const channels = (f.channels.length ? f.channels : CHANNEL_IDS) as ChannelId[];

  const perProduct = useMemo(
    () =>
      ds.products.map((p, pi) => {
        const rates = channelRates(ds, settings, pi);
        const factor = settings.useTrendFactor ? trendFactor(totalSeries(ds, pi), settings.trendCapPct) : 1;
        return { p, pi, rates, factor };
      }),
    [ds, settings],
  );

  const rows = useMemo(() => {
    const list = perProduct
      .filter((x) => productMatches(x.p, f))
      .map((x) => {
        const rate = channels.reduce((a, c) => a + x.rates[c], 0);
        const proj: Record<number, number> = {};
        const value: Record<number, number> = {};
        for (const h of PROJECTION_HORIZONS) {
          proj[h] = channels.reduce((a, c) => a + projection(x.rates[c], h, x.factor), 0);
          value[h] = channels.reduce((a, c) => a + projection(x.rates[c], h, x.factor) * unitValue(x.p, c), 0);
        }
        return { ...x, rate, proj, value, m: metrics[x.pi]! };
      });
    const pick = (h: number) => (r: (typeof list)[number]) => (measure === "units" ? r.proj[h]! : r.value[h]!);
    return sortRows(list, { name: (r) => r.p.name, rate: (r) => r.rate, trend: (r) => r.factor, p7: pick(7), p15: pick(15), p30: pick(30), p60: pick(60), p90: pick(90) }, sort.key, sort.dir);
  }, [perProduct, f, channels, metrics, measure, sort]);

  const chartData = PROJECTION_HORIZONS.map((h) => {
    const byChannel = Object.fromEntries(CHANNEL_IDS.map((c) => [c, 0])) as Record<ChannelId, number>;
    for (const r of rows)
      for (const c of channels) {
        const u = projection(r.rates[c], h, r.factor);
        byChannel[c] += measure === "units" ? u : u * unitValue(r.p, c);
      }
    return { horizon: h, byChannel };
  });
  const fmt = measure === "units" ? fmtInt : fmtMoneyShort;
  const onSort = (key: string) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  return (
    <div>
      <PageHeader
        title="Projections"
        sub="What each product is expected to sell in the next 7, 15, 30, 60 and 90 days at today’s trend. Projection = daily sales rate × days."
        right={
          <Button
            icon={<Download size={14} />}
            onClick={() =>
              downloadCsv(
                `projections_${ds.today}.csv`,
                ["Product", "SKU", "Daily rate", ...PROJECTION_HORIZONS.map((h) => `${h} days (units)`), ...PROJECTION_HORIZONS.map((h) => `${h} days (₹)`)],
                rows.map((r) => [r.p.name, r.p.sku, r.rate.toFixed(2), ...PROJECTION_HORIZONS.map((h) => Math.round(r.proj[h]!)), ...PROJECTION_HORIZONS.map((h) => Math.round(r.value[h]!))]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      <FilterBar date={false} locations={false} note="Based on the last 7, 30 and 90 days of sales, as of today" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {chartData.map((d) => (
          <StatTile key={d.horizon} label={`Next ${d.horizon} days`} value={fmt(channels.reduce((a, c) => a + d.byChannel[c], 0))} sub={measure === "units" ? "units" : "value at selling price"} />
        ))}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Projected sales by channel"
            sub={channels.length === CHANNEL_IDS.length ? "All channels" : channels.map((c) => channelLabel(c)).join(", ")}
            right={<Segmented value={measure} onChange={setMeasure} label="Measure" options={[{ value: "units", label: "Units" }, { value: "value", label: "₹ Value" }]} />}
          />
          <ProjectionChart data={chartData} channels={channels} measure={measure} />
        </Card>
        <Card>
          <CardHeader title="How projections are made" />
          <ol className="list-decimal space-y-2 pl-4 text-[13px] text-ink-2">
            <li>
              <b className="text-ink">Daily sales rate</b> = {settings.weight7}% of the last-7-day average + {settings.weight30}% of the last-30-day average + {settings.weight90}% of the last-90-day average.
            </li>
            <li>Days a product was out of stock are left out, so a stock-out never makes demand look lower.</li>
            <li>
              <b className="text-ink">Projection</b> = daily rate × number of days.
            </li>
            <li>
              Trend factor is <b className="text-ink">{settings.useTrendFactor ? `on (capped ±${settings.trendCapPct}%)` : "off"}</b>. It multiplies by last 30 days ÷ the 30 days before.{" "}
              <Link href="/settings" className="text-coral hover:underline">Change in Settings</Link>
            </li>
          </ol>
          <div className="mt-3">
            <Note>New products (under 30 days of history) use only the days they have and are marked “New”.</Note>
          </div>
        </Card>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader className="mb-0" title="Projection by product" sub={`${measure === "units" ? "Units" : "Value at selling price"} · click a product to see the working`} />
        </div>
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <SortTh label="Product" sortKey="name" current={sort.key} dir={sort.dir} onSort={onSort} />
                <SortTh label="Sells / day" sortKey="rate" current={sort.key} dir={sort.dir} onSort={onSort} num />
                {settings.useTrendFactor ? <SortTh label="Trend" sortKey="trend" current={sort.key} dir={sort.dir} onSort={onSort} num /> : null}
                {PROJECTION_HORIZONS.map((h) => (
                  <SortTh key={h} label={`${h} days`} sortKey={`p${h}`} current={sort.key} dir={sort.dir} onSort={onSort} num />
                ))}
                <th>Stock today</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.id} className="clickable" onClick={() => openProduct(r.p.id)}>
                  <td>
                    <div className="max-w-[260px] truncate font-medium">{r.p.name}</div>
                    <div className="text-[11.5px] text-muted">
                      {r.p.sku}
                      {r.m.isNew ? " · New" : ""}
                    </div>
                  </td>
                  <td className="num">{fmtRate(r.rate)}</td>
                  {settings.useTrendFactor ? <td className="num">×{r.factor.toFixed(2)}</td> : null}
                  {PROJECTION_HORIZONS.map((h) => (
                    <td key={h} className={`num ${h === 30 ? "font-semibold" : ""}`}>
                      {measure === "units" ? fmtInt(r.proj[h]!) : fmtMoneyShort(r.value[h]!)}
                    </td>
                  ))}
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <StatusChip status={r.m.status} size="sm" />
                      <span className="text-[12px] text-muted tabular">{fmtInt(r.m.stock)}</span>
                    </span>
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
