"use client";

import { ArrowRight, Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { Button, Card, CardHeader, Empty, Note, PageHeader, Segmented, sortRows, SortTh, StatTile, STATUS_META, StatusChip } from "@/components/ui";
import { allTransfers, productMatches, sendToClinics, STATUS_ORDER } from "@/lib/data/engine";
import { belowZeroStock } from "@/lib/data/model";
import { useDataset, useFilters, useMetrics, useRole } from "@/lib/data/hooks";
import { downloadCsv } from "@/lib/csv";
import { IS_PREVIEW, PREVIEW_NO_DOWNLOAD } from "@/lib/platform";
import { fmtDay } from "@/lib/dates";
import type { StockStatus } from "@/lib/domain/types";
import { fmtDays, fmtInt, fmtMoneyShort, fmtRate } from "@/lib/format";
import { usePanel } from "@/lib/state/store";

function initialStatuses(q: string | null): StockStatus[] {
  if (q === "urgent") return ["critical", "low"];
  if (q && (STATUS_ORDER as string[]).includes(q)) return [q as StockStatus];
  return [];
}

function StockHealth() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const params = useSearchParams();
  const [statuses, setStatuses] = useState<StockStatus[]>(() => initialStatuses(params.get("status")));
  // Purchase's Home links a segment here (?segment=day): the Segment filter is on while this page is open, and
  // cleared when you leave it, so it never follows you back to Home (bug fixed 20 Nov 2026)
  const role = useRole();
  const setSegments = usePanel((s) => s.setSegments);
  const segParam = params.get("segment");
  useEffect(() => {
    if (role.id !== "purchase" || !segParam) return;
    setSegments([segParam]);
    return () => setSegments([]);
  }, [role.id, segParam, setSegments]);
  const [view, setView] = useState<"summary" | "locations">("summary");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "urgency", dir: "asc" });

  const visible = metrics.filter((m) => productMatches(m.product, f));
  const shown = sortRows(
    visible.filter((m) => statuses.length === 0 || statuses.includes(m.status)),
    {
      urgency: (m) => STATUS_ORDER.indexOf(m.status) * 100000 + (Number.isFinite(m.cover) ? m.cover : 99999),
      name: (m) => m.product.name,
      stock: (m) => m.stock,
      rate: (m) => m.rate,
      cover: (m) => (Number.isFinite(m.cover) ? m.cover : 99999),
      excess: (m) => m.excess,
    },
    sort.key,
    sort.dir,
  );
  const locs = ds.locations.filter((l) => f.locations.length === 0 || f.locations.includes(l.id));
  const transfers = useMemo(() => allTransfers(ds, settings, metrics), [ds, settings, metrics]);
  const sends = useMemo(() => sendToClinics(ds, settings, metrics), [ds, settings, metrics]);
  const unreadable = ds.locations.filter((l) => !l.readable);
  const belowZero = belowZeroStock(ds);
  const over = visible.filter((m) => m.status === "overstock").sort((a, b) => b.excess * b.product.cost - a.excess * a.product.cost);

  const toggle = (s: StockStatus) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const onSort = (key: string) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const locName = (id: string) => ds.locations.find((l) => l.id === id)?.name ?? id;
  const tone: Record<StockStatus, "critical" | "low" | "good" | "over" | "neutral"> = { critical: "critical", low: "low", healthy: "good", overstock: "over", no_sales: "neutral" };

  return (
    <div>
      <PageHeader
        title="Stock health"
        sub={`Current stock = Mohali warehouse + every clinic. Status uses the daily sales rate (last ${settings.rateWindowDays} days), each product’s lead time, its regimen’s reorder point (Night Regime ${settings.nightReorderAtDays} days, Day Regime and Wellness ${settings.dayReorderAtDays}, no regimen ${settings.reorderAtDays}) and a ${settings.overstockDays}-day overstock limit.`}
        right={
          <Button
            icon={<Download size={14} />}
            disabled={IS_PREVIEW}
            disabledReason={PREVIEW_NO_DOWNLOAD}
            onClick={() =>
              downloadCsv(
                `stock_${ds.today}.csv`,
                ["Product", "SKU", ...ds.locations.map((l) => l.name), "Total", "On the way", "Daily rate", "Days of cover", "Runs out", "Status", "Excess units"],
                shown.map((m) => [
                  m.product.name,
                  m.product.sku,
                  ...ds.locations.map((l) => m.stockByLocation[l.id] ?? 0),
                  m.stock,
                  m.onOrder,
                  m.rate.toFixed(2),
                  Number.isFinite(m.cover) ? m.cover.toFixed(1) : "",
                  m.stockOut ?? "",
                  STATUS_META[m.status].label,
                  m.excess,
                ]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      <FilterBar date={false} channels={false} locations="stock" note="Location changes which stock columns you see" />
      {unreadable.length ? (
        <div className="mb-3">
          <Note tone="warn">
            Stock totals leave out {unreadable.map((l) => l.name).join(", ")}: the Zoho login isn’t allowed to read {unreadable.length === 1 ? "it" : "them"} yet. See Data health.
          </Note>
        </div>
      ) : null}
      {belowZero.length ? (
        <div className="mb-3">
          <Note tone="warn">
            Zoho shows stock below zero in {belowZero.length === 1 ? "one place" : `${belowZero.length} places`}, e.g. {belowZero[0]!.product} at {belowZero[0]!.location} ({fmtInt(belowZero[0]!.qty)}). Stock went out
            before Zoho recorded it coming in (a receipt or transfer not entered yet). Totals use Zoho’s numbers as they are. See Data health.
          </Note>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUS_ORDER.map((s) => {
          const list = visible.filter((m) => m.status === s);
          const sub =
            s === "overstock"
              ? `${fmtMoneyShort(list.reduce((a, m) => a + m.excess * m.product.cost, 0))} excess at cost`
              : s === "critical" || s === "low"
                ? `order ${fmtMoneyShort(list.reduce((a, m) => a + m.indentQty * m.product.cost, 0))} at cost`
                : STATUS_META[s].help;
          return (
            <StatTile
              key={s}
              tone={statuses.includes(s) || statuses.length === 0 ? tone[s] : "neutral"}
              onClick={() => toggle(s)}
              label={
                <span className="inline-flex items-center gap-1.5">
                  {STATUS_META[s].label}
                  {statuses.includes(s) ? <span className="rounded bg-ink px-1 text-[10px] text-white">filter on</span> : null}
                </span>
              }
              value={list.length}
              sub={sub}
            />
          );
        })}
      </div>

      <Card className="mt-3" pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-3">
          <div>
            <h2 className="text-[14.5px] font-semibold">Products</h2>
            <p className="text-[12.5px] text-muted">
              {shown.length} shown{statuses.length ? ` · status: ${statuses.map((s) => STATUS_META[s].label).join(", ")}` : ""} · click a product to see its working
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statuses.length ? (
              <button onClick={() => setStatuses([])} className="text-[12.5px] text-coral hover:underline">
                Show all statuses
              </button>
            ) : null}
            <Segmented value={view} onChange={setView} label="View" options={[{ value: "summary", label: "Summary" }, { value: "locations", label: "By location" }]} />
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty title="No products match">Clear the status or filters above.</Empty>
          </div>
        ) : (
          <div className="max-h-[620px] overflow-auto scroll-thin">
            {view === "summary" ? (
              <table className="dtable">
                <thead>
                  <tr>
                    <SortTh label="Product" sortKey="name" current={sort.key} dir={sort.dir} onSort={onSort} />
                    <th className="num">Warehouse</th>
                    <th className="num">Clinics</th>
                    <SortTh label="Total" sortKey="stock" current={sort.key} dir={sort.dir} onSort={onSort} num />
                    <th className="num">On the way</th>
                    <SortTh label="Sells / day" sortKey="rate" current={sort.key} dir={sort.dir} onSort={onSort} num />
                    <SortTh label="Days of cover" sortKey="cover" current={sort.key} dir={sort.dir} onSort={onSort} num />
                    <th>Runs out</th>
                    <th className="num">Lead time</th>
                    <SortTh label="Status" sortKey="urgency" current={sort.key} dir={sort.dir} onSort={onSort} />
                    <SortTh label="Excess" sortKey="excess" current={sort.key} dir={sort.dir} onSort={onSort} num />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.product.id} className="clickable" onClick={() => openProduct(m.product.id)}>
                      <td>
                        <div className="max-w-[240px] truncate font-medium">{m.product.name}</div>
                        <div className="text-[11.5px] text-muted">{m.product.sku}</div>
                      </td>
                      <td className="num">{fmtInt(m.warehouseStock)}</td>
                      <td className="num">{fmtInt(m.clinicStock)}</td>
                      <td className="num font-semibold">{fmtInt(m.stock)}</td>
                      <td className="num">{m.onOrder ? <span title={m.nextArrivalDays !== null ? `First lands in ${m.nextArrivalDays} days` : undefined}>{fmtInt(m.onOrder)}</span> : <span className="text-muted">—</span>}</td>
                      <td className="num">{fmtRate(m.rate)}</td>
                      <td className="num font-semibold">{fmtDays(m.cover)}</td>
                      <td className="whitespace-nowrap">{m.stockOut ? fmtDay(m.stockOut) : "—"}</td>
                      <td className="num">{m.leadTime}d</td>
                      <td>
                        <StatusChip status={m.status} size="sm" />
                      </td>
                      <td className="num">{m.excess ? fmtInt(m.excess) : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Product</th>
                    {locs.map((l) => (
                      <th key={l.id} className="num" title={l.readable ? undefined : "The Zoho login can’t read this location"}>
                        {l.isPrimary ? "Warehouse" : l.name}
                        {l.readable ? null : " ?"}
                      </th>
                    ))}
                    <th className="num">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.product.id} className="clickable" onClick={() => openProduct(m.product.id)}>
                      <td className="max-w-[220px] truncate font-medium">{m.product.name}</td>
                      {locs.map((l) => {
                        const q = m.stockByLocation[l.id];
                        if (q === null || (q === undefined && !l.readable)) {
                          return (
                            <td key={l.id} className="num text-muted" title="Can’t read this location in Zoho">
                              ?
                            </td>
                          );
                        }
                        return (
                          <td key={l.id} className={`num ${(q ?? 0) <= 0 ? "text-st-critical" : ""}`}>
                            {fmtInt(q ?? 0)}
                          </td>
                        );
                      })}
                      <td className="num font-semibold">{fmtInt(m.stock)}</td>
                      <td>
                        <StatusChip status={m.status} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            className="mb-0"
            title="Send to clinics from Mohali"
            sub={`A clinic below ${settings.replenishLeadDays + settings.safetyDays} days of its own usage is topped up to ${settings.replenishLeadDays + settings.replenishCoverDays + settings.safetyDays} days, most urgent first.`}
          />
        </div>
        {sends.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty title="No clinic needs stock">Every clinic holds enough for its own usage.</Empty>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Send to</th>
                  <th className="num">Has</th>
                  <th className="num">Uses / day</th>
                  <th className="num">Days left</th>
                  <th className="num">Send</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((x, i) => (
                  <tr key={i} className="clickable" onClick={() => openProduct(x.product.id)}>
                    <td className="max-w-[240px] truncate font-medium">{x.product.name}</td>
                    <td>{x.to.name}</td>
                    <td className="num">{fmtInt(x.toStock)}</td>
                    <td className="num">{fmtRate(x.rate)}</td>
                    <td className={`num ${x.toCover < settings.replenishLeadDays ? "font-semibold text-st-critical" : ""}`}>{fmtDays(x.toCover)}</td>
                    <td className="num font-semibold">
                      {fmtInt(x.qty)}
                      {x.covered ? null : <span className="ml-1 text-[11px] font-semibold text-st-critical" title="Mohali doesn’t hold enough for this">short</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="If Mohali is short: move between clinics"
            sub={`A clinic with more than ${settings.transferHighDays} days of a product sends to one with under ${settings.transferLowDays} days, before buying more.`}
          />
          {transfers.length === 0 ? (
            <Empty title="No moves needed">Mohali can cover every clinic that needs stock.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {transfers.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 text-[13px]">
                  <button className="font-medium hover:underline" onClick={() => openProduct(t.product.id)}>
                    {t.product.name}
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-ink-2">
                    {locName(t.fromId)} <span className="text-muted">({fmtDays(t.fromCover)}d)</span>
                    <ArrowRight size={13} aria-hidden />
                    {locName(t.toId)} <span className="text-muted">({fmtDays(t.toCover)}d)</span>
                  </span>
                  <span className="w-20 text-right font-semibold tabular">{fmtInt(t.qty)} {t.qty === 1 ? "unit" : "units"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Overstock: money stuck on the shelf" sub={`Units above ${settings.overstockDays} days of cover, valued at cost`} />
          {over.length === 0 ? (
            <Empty title="No overstock">Nothing is above the limit.</Empty>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {over.map((m) => (
                  <li key={m.product.id} className="flex items-center gap-2 py-2 text-[13px]">
                    <button className="truncate font-medium hover:underline" onClick={() => openProduct(m.product.id)}>
                      {m.product.name}
                    </button>
                    <span className="ml-auto text-ink-2 tabular">{fmtDays(m.cover)} days cover</span>
                    <span className="w-24 text-right tabular">{fmtInt(m.excess)} excess</span>
                    <span className="w-20 text-right font-semibold tabular">{fmtMoneyShort(m.excess * m.product.cost)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <Note>Suggested: stop re-ordering these, move stock to clinics that sell them, and they appear in the Marketing Head’s plan form as “needs a push”.</Note>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<div className="text-[13px] text-muted">Loading…</div>}>
      <StockHealth />
    </Suspense>
  );
}
