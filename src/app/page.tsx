"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SalesTrendChart } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import { Card, CardHeader, ChannelDot, channelLabel, Delta, PageHeader, Segmented, StatTile, StatusChip, Tabs, CHANNEL_COLOR } from "@/components/ui";
import { CHANNEL_IDS, comparer, dailyTotals, inventoryValue, previousRange, productMatches, projectionValueByChannel, salesByProduct, urgency, type InventoryValue, type ProductMetrics } from "@/lib/data/engine";
import { indentQuantity } from "@/lib/domain/formulas";
import { connectedChannels } from "@/lib/data/model";
import { useDataset, useFilters, useMetrics, useRole, useSubmissions } from "@/lib/data/hooks";
import { cycleState, submissionStatus } from "@/lib/data/plans";
import { diffDays, fmtDay, fmtRange } from "@/lib/dates";
import { purchaseRule, SEGMENTS, type ChannelId, type FormulaSettings } from "@/lib/domain/types";
import { fmtDays, fmtInt, fmtMoneyShort, fmtRate, pctChange } from "@/lib/format";
import { CYCLES } from "@/lib/mock/plans";
import { PLAN_PARTS, roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

type ActionTab = "all" | "critical" | "low" | "overstock";
const COVER_DAYS = [7, 15, 30, 45, 60, 90, 150, 180];

export default function HomePage() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const role = useRole();
  const subs = useSubmissions();
  const [measure, setMeasure] = useState<"value" | "units">("value");
  const [tab, setTab] = useState<ActionTab>("all");
  // starts on each product's own rule (its regimen's target), as Auto indent does; a fixed number of days is a what-if
  const [cover, setCover] = useState<number | "own">("own");

  const channels = (f.channels.length ? f.channels : connectedChannels(ds));
  const sales = useMemo(() => salesByProduct(ds, f), [ds, f]);
  const prev = useMemo(() => salesByProduct(ds, f, previousRange(f.from, f.to)), [ds, f]);
  const cmp = useMemo(() => comparer(ds, f), [ds, f]);
  const purchase = role.id === "purchase";
  // Purchase's Home (decided 20 Nov 2026): the stock's value replaces the sales-over-time chart
  const points = useMemo(() => (purchase ? [] : dailyTotals(ds, f)), [ds, f, purchase]);
  const inv = useMemo(
    // every segment, always: the card IS the split by segment, so the Segment filter does not narrow it
    () => (purchase ? inventoryValue(ds, ds.products.filter((p) => productMatches(p, { ...f, segments: [] })), settings.unusedBottleValue ?? 0) : null),
    [ds, f, purchase, settings.unusedBottleValue],
  );
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
  // "Products that need action": a tab per status, and the order sized to cover 7 / 15 / 30 / 90 days
  const byUrgency = (a: ProductMetrics, b: ProductMetrics) => urgency(a) - urgency(b);
  const lists: Record<ActionTab, ProductMetrics[]> = {
    all: [...critical, ...low, ...over].sort(byUrgency),
    critical: [...critical].sort(byUrgency),
    low: [...low].sort(byUrgency),
    overstock: [...over].sort((a, b) => b.excess * b.product.cost - a.excess * a.product.cost),
  };
  const rows = lists[tab];
  const orderFor = (m: ProductMetrics) =>
    cover === "own"
      ? m.indentQty
      : indentQuantity({ rate: m.rate, leadTime: m.leadTime, coverDays: cover, safetyDays: m.rule.safetyDays, reorderAtDays: m.rule.reorderAtDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize, extraUnits: m.extraFor(m.leadTime + cover) }).qty;

  const weekly = CYCLES.find((c) => c.kind === "weekly" && cycleState(c, ds.today) === "open");
  const nextMonthly = CYCLES.filter((c) => c.kind === "monthly" && cycleState(c, ds.today) === "upcoming").sort((a, b) => a.requestOn.localeCompare(b.requestOn))[0];

  return (
    <div>
      <PageHeader title="Home" sub={`Where sales and stock stand today, ${fmtDay(ds.today)}. Click any product to see how its numbers are worked out.`} />
      <FilterBar search={false} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label={`Sales · ${fmtRange(f.from, f.to)}`} value={fmtMoneyShort(total)} sub={cmp() ? <><Delta pct={pctChange(total, prevTotal)} /> vs previous {days} days</> : <Delta pct={null} incomplete />} />
        <StatTile label="Units sold" value={fmtInt(units)} sub={<>{fmtRate(units / days)} a day · <Delta pct={pctChange(units, prevUnits)} incomplete={!cmp()} /></>} />
        <StatTile href="/stock?status=urgent" tone="critical" label="Critical + Low products" value={critical.length + low.length} sub={`${critical.length} critical · ${low.length} low`} />
        <StatTile href="/stock?status=overstock" tone="over" label="Overstock products" value={over.length} sub={`${fmtMoneyShort(stuck)} stuck at cost`} />
        <StatTile href={role.access === "planner" ? undefined : "/indent"} label="Suggested order now" value={fmtMoneyShort(toOrder)} sub={`at cost, ${critical.length + low.length} products`} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        {inv ? <InventoryValueCard inv={inv} filtered={f.categories.length + (f.search ? 1 : 0) > 0} segmentFilter={(f.segments?.length ?? 0) > 0} settings={settings} /> : <Card className="xl:col-span-2">
          <CardHeader
            title="Sales over time"
            sub={`${fmtRange(f.from, f.to)} · by channel`}
            right={<Segmented value={measure} onChange={setMeasure} label="Measure" options={[{ value: "value", label: "₹ Value" }, { value: "units", label: "Units" }]} />}
          />
          <SalesTrendChart points={points} measure={measure} channels={channels} />
        </Card>}
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
                    <Delta pct={pctChange(v, pv)} incomplete={!cmp({ channels: [c] })} short />
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {ds.channels.some((c) => !c.connected) ? (
            <p className="mt-3 border-t border-line pt-2 text-[12px] text-muted">
              {ds.channels.filter((c) => !c.connected).map((c) => c.label).join(" and ")}: not connected yet. <Link href="/health" className="text-coral hover:underline">Why?</Link>
            </p>
          ) : null}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2" pad={false}>
          <div className="p-4 pb-0">
            <CardHeader
              className="mb-2"
              title="Products that need action"
              sub="As of today, every channel and location · most urgent first"
              right={<Link href="/stock" className="text-[12.5px] font-medium text-coral hover:underline">All stock →</Link>}
            />
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: "all", label: "All", count: lists.all.length },
                  { value: "critical", label: "Critical", count: lists.critical.length },
                  { value: "low", label: "Low", count: lists.low.length },
                  { value: "overstock", label: "Overstock", count: lists.overstock.length },
                ]}
              />
              {tab !== "overstock" ? (
                <div className="mb-1.5 flex items-center gap-2 text-[12px] text-ink-2">
                  Order to cover
                  <Segmented
                    label="Order to cover"
                    value={cover}
                    onChange={setCover}
                    options={[{ value: "own" as const, label: "Each product’s rule" }, ...COVER_DAYS.map((d) => ({ value: d, label: `${d} days` }))]}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="max-h-[440px] overflow-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Stock</th>
                  <th className="num">Sells / day</th>
                  <th className="num">Days left</th>
                  <th>Runs out</th>
                  <th>Status</th>
                  <th className="num">{tab === "overstock" ? "Excess units" : cover === "own" ? "Order now" : `Order for ${cover} days`}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-ink-2">
                      No {tab === "all" ? "products need action" : `${tab} products`} today.
                    </td>
                  </tr>
                ) : null}
                {rows.map((m) => (
                  <tr key={m.product.id} className="clickable" onClick={() => openProduct(m.product.id)}>
                    <td className="max-w-[240px] truncate font-medium">{m.product.name}</td>
                    <td className="num">{fmtInt(m.stock)}</td>
                    <td className="num">{fmtRate(m.rate)}</td>
                    <td className="num">{fmtDays(m.cover)}</td>
                    <td>{m.stockOut ? fmtDay(m.stockOut) : "—"}</td>
                    <td>
                      <StatusChip status={m.status} size="sm" />
                    </td>
                    <td className="num font-semibold">
                      {tab === "overstock" ? fmtInt(m.excess) : orderFor(m) ? fmtInt(orderFor(m)) : "—"}
                    </td>
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

const SEGMENT_COLOR: Record<string, string> = { day: "var(--color-seg-day)", night: "var(--color-seg-night)", wellness: "var(--color-seg-wellness)", none: "var(--color-line-strong)" };
const segmentLabel = (k: string) => SEGMENTS.find((g) => g.id === k)?.label ?? "Not set in Zoho";

/** Purchase's Home: the working capital in stock, where it sits and which segment it is in. */
function InventoryValueCard({ inv, filtered, segmentFilter, settings }: { inv: InventoryValue; filtered: boolean; segmentFilter: boolean; settings: FormulaSettings }) {
  const stockValue = inv.total - inv.bottles;
  const share = (v: number) => (inv.total ? `${Math.round((v / inv.total) * 100)}%` : "–");
  const rows: { label: string; value: number | null; note?: string }[] = [
    { label: "Mohali warehouse", value: inv.byKind.warehouse },
    { label: `Clinics (${inv.counted.clinic})`, value: inv.byKind.clinic },
    ...(inv.counted.darkstore || inv.byKind.darkstore ? [{ label: `Darkstores (${inv.counted.darkstore})`, value: inv.byKind.darkstore }] : []),
    { label: "Unused bottles", value: inv.bottles || null, note: inv.bottles ? "entered in Settings" : "Not entered yet. Management enters it in Settings" },
  ];
  const maxSeg = Math.max(1, ...inv.bySegment.map((x) => x.value));
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Total inventory value" sub={`Working capital sitting in stock today, at purchase cost${filtered ? " · filtered products only" : ""}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[28px] font-semibold tabular leading-tight">{fmtMoneyShort(inv.total)}</div>
          <div className="mb-3 text-[12.5px] text-muted">{fmtInt(inv.units)} units in stock</div>
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-1.5">
                    {r.label}
                    {r.note && r.value === null ? <div className="text-[11.5px] text-muted">{r.note}</div> : null}
                  </td>
                  <td className="py-1.5 text-right tabular font-medium">{r.value === null ? <span className="text-muted">–</span> : fmtMoneyShort(r.value)}</td>
                  <td className="w-12 py-1.5 text-right tabular text-[12px] text-muted">{r.value === null ? "" : share(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 space-y-1 text-[11.5px] text-muted">
            {inv.unreadable.length ? <p>Leaves out {inv.unreadable.join(", ")}: the Zoho login can’t read {inv.unreadable.length === 1 ? "it" : "them"} yet.</p> : null}
            {inv.estimated > 0 ? (
              <p>
                {inv.estimated * 2 > stockValue ? "Mostly an estimate" : "Partly an estimate"}:{" "}
                {inv.estimatedProducts === inv.products
                  ? `none of the ${inv.products} products has a real purchase price in Zoho`
                  : `${inv.estimatedProducts} of the ${inv.products} products ${inv.estimatedProducts === 1 ? "has" : "have"} no real purchase price in Zoho`}
                , so {inv.estimatedProducts === 1 ? "it is" : "they are"} valued at a share of the selling price ({fmtMoneyShort(inv.estimated)} of the {fmtMoneyShort(stockValue)}). Enter purchase
                prices in Zoho to make this exact.
              </p>
            ) : null}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12.5px] font-medium text-ink-2">By segment</div>
          <ul className="space-y-2.5">
            {inv.bySegment.map((g) => (
              <li key={g.segment}>
                <Link href={`/stock?segment=${g.segment}`} className="block rounded-md px-1 py-0.5 hover:bg-sunken" title={`Open Stock health for ${segmentLabel(g.segment)}`}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: SEGMENT_COLOR[g.segment] }} aria-hidden /> {segmentLabel(g.segment)}
                    </span>
                    <span className="tabular">
                      <span className="font-semibold">{fmtMoneyShort(g.value)}</span> <span className="text-[12px] text-muted">{stockValue ? Math.round((g.value / stockValue) * 100) : 0}%</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-sunken">
                    <div className="h-2 rounded-full" style={{ width: `${(g.value / maxSeg) * 100}%`, background: SEGMENT_COLOR[g.segment] }} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {g.products} product{g.products === 1 ? "" : "s"} · {fmtInt(g.units)} units
                    {g.segment === "none" ? "" : ` · ${purchaseRule(g.segment, settings).label.replace(/^[^:]+: /, "")}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {segmentFilter ? <p className="mt-2 text-[11.5px] text-muted">The Segment filter narrows the product lists; this card always shows every segment.</p> : null}
          {inv.bySegment.some((g) => g.segment === "none") ? (
            <p className="mt-2 text-[11.5px] text-muted">“Not set in Zoho”: the item’s Type Regimen field in Zoho is empty. Fill it in Zoho (Day Regime, Night Regime or Wellness) and the next sync moves it.</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
