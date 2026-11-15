"use client";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { SalesTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Button, Card, CardHeader, ChannelSplitBar, Delta, Empty, PageHeader, Segmented, sortRows, SortTh, Sparkline, StatTile, StatusChip } from "@/components/ui";
import { CHANNEL_IDS, dailyTotals, previousRange, salesByProduct } from "@/lib/data/engine";
import { connectedChannels } from "@/lib/data/model";
import { useDataset, useFilters, useMetrics } from "@/lib/data/hooks";
import { downloadCsv } from "@/lib/csv";
import { IS_PREVIEW, PREVIEW_NO_DOWNLOAD } from "@/lib/platform";
import { diffDays, fmtRange } from "@/lib/dates";
import type { ChannelId } from "@/lib/domain/types";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtPct, fmtRate, pctChange } from "@/lib/format";
import { usePanel } from "@/lib/state/store";
import { channelLabel } from "@/components/ui";

export default function SalesPage() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const openProduct = usePanel((s) => s.openProduct);
  const [measure, setMeasure] = useState<"value" | "units">("value");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "value", dir: "desc" });
  const [showZero, setShowZero] = useState(false);

  const channels = (f.channels.length ? f.channels : connectedChannels(ds));
  const sales = useMemo(() => salesByProduct(ds, f), [ds, f]);
  const prev = useMemo(() => salesByProduct(ds, f, previousRange(f.from, f.to)), [ds, f]);
  const points = useMemo(() => dailyTotals(ds, f), [ds, f]);
  const days = diffDays(f.to, f.from) + 1;
  const metricsById = useMemo(() => new Map(metrics.map((m) => [m.product.id, m])), [metrics]);
  const prevById = useMemo(() => new Map(prev.map((p) => [p.product.id, p])), [prev]);

  const total = sales.reduce((a, s) => a + s.value, 0);
  const units = sales.reduce((a, s) => a + s.qty, 0);
  const prevTotal = prev.reduce((a, s) => a + s.value, 0);
  const sold = sales.filter((s) => s.qty > 0).length;

  const rows = useMemo(() => {
    const base = showZero ? sales : sales.filter((s) => s.qty > 0 || (prevById.get(s.product.id)?.qty ?? 0) > 0);
    return sortRows(
      base,
      {
        name: (r) => r.product.name,
        category: (r) => r.product.category,
        units: (r) => r.qty,
        value: (r) => r.value,
        change: (r) => pctChange(r.value, prevById.get(r.product.id)?.value ?? 0) ?? -9999,
        perday: (r) => r.qty / days,
      },
      sort.key,
      sort.dir,
    );
  }, [sales, showZero, prevById, sort, days]);

  const onSort = (key: string) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const exportCsv = () =>
    downloadCsv(
      `sales_${f.from}_to_${f.to}.csv`,
      ["Product", "SKU", "Category", "Units", "Value (₹)", "Previous period value (₹)", ...channels.map((c) => `${channelLabel(c)} units`), "Units per day"],
      rows.map((r) => [
        r.product.name,
        r.product.sku,
        r.product.category,
        r.qty,
        Math.round(r.value),
        Math.round(prevById.get(r.product.id)?.value ?? 0),
        ...channels.map((c) => r.byChannel[c].qty),
        (r.qty / days).toFixed(2),
      ]),
    );

  return (
    <div>
      <PageHeader title="Sales" sub="Product-wise sales for any date range, split by clinic, online team, Amazon, Flipkart and website. Click a product for its full detail." />
      <FilterBar right={<Button icon={<Download size={14} />} onClick={exportCsv} disabled={IS_PREVIEW} disabledReason={PREVIEW_NO_DOWNLOAD}>Export CSV</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sales value" value={fmtMoneyShort(total)} sub={<><Delta pct={pctChange(total, prevTotal)} /> vs previous {days} days</>} />
        <StatTile label="Units sold" value={fmtInt(units)} sub={`${fmtInt(units / days)} a day`} />
        <StatTile label="Products sold" value={`${sold} of ${sales.length}`} sub="with at least one sale" />
        <StatTile label="Average order line" value={units ? fmtMoney(total / units) : "—"} sub="value per unit sold" />
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Sales over time"
          sub={fmtRange(f.from, f.to)}
          right={<Segmented value={measure} onChange={setMeasure} label="Measure" options={[{ value: "value", label: "₹ Value" }, { value: "units", label: "Units" }]} />}
        />
        <SalesTrendChart points={points} measure={measure} channels={channels} height={210} />
      </Card>

      <Card className="mt-3" pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-3">
          <div>
            <h2 className="text-[14.5px] font-semibold">Product-wise sales</h2>
            <p className="text-[12.5px] text-muted">
              {fmtRange(f.from, f.to)} · change is against the {days} days before · status is today’s stock status
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} className="accent-coral" />
            Show products with no sales
          </label>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty title="No sales match these filters">Try a longer date range or clear the filters.</Empty>
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <SortTh label="Product" sortKey="name" current={sort.key} dir={sort.dir} onSort={onSort} />
                  <SortTh label="Category" sortKey="category" current={sort.key} dir={sort.dir} onSort={onSort} />
                  <SortTh label="Units" sortKey="units" current={sort.key} dir={sort.dir} onSort={onSort} num />
                  <SortTh label="Value" sortKey="value" current={sort.key} dir={sort.dir} onSort={onSort} num />
                  <th className="num">Share</th>
                  <SortTh label="Change" sortKey="change" current={sort.key} dir={sort.dir} onSort={onSort} num title="Value vs the previous period of the same length" />
                  <th style={{ minWidth: 130 }}>Channel split</th>
                  <SortTh label="Per day" sortKey="perday" current={sort.key} dir={sort.dir} onSort={onSort} num />
                  <th>Last 30 days</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = metricsById.get(r.product.id);
                  return (
                    <tr key={r.product.id} className="clickable" onClick={() => openProduct(r.product.id)}>
                      <td>
                        <div className="max-w-[260px] truncate font-medium">{r.product.name}</div>
                        <div className="text-[11.5px] text-muted">{r.product.sku}</div>
                      </td>
                      <td className="whitespace-nowrap text-ink-2">{r.product.category}</td>
                      <td className="num">{fmtInt(r.qty)}</td>
                      <td className="num font-medium">{fmtMoneyShort(r.value)}</td>
                      <td className="num text-ink-2">{total ? fmtPct((r.value / total) * 100) : "—"}</td>
                      <td className="num">
                        <Delta pct={pctChange(r.value, prevById.get(r.product.id)?.value ?? 0)} />
                      </td>
                      <td>
                        <ChannelSplitBar parts={channels.map((c) => ({ channel: c, value: r.byChannel[c].qty }))} />
                      </td>
                      <td className="num">{fmtRate(r.qty / days)}</td>
                      <td>{m ? <Sparkline values={m.last30} /> : null}</td>
                      <td>{m ? <StatusChip status={m.status} size="sm" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="border-t border-line-strong px-2.5 py-2">Total · {rows.length} products</td>
                  <td className="border-t border-line-strong" />
                  <td className="num border-t border-line-strong px-2.5">{fmtInt(units)}</td>
                  <td className="num border-t border-line-strong px-2.5">{fmtMoneyShort(total)}</td>
                  <td className="border-t border-line-strong" colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
