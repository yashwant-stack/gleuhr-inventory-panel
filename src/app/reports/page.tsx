"use client";

import clsx from "clsx";
import { ChevronDown, Mail, Printer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SubmissionChip } from "@/components/plan-ui";
import { Select } from "@/components/Select";
import { Button, Card, CardHeader, ChannelTag, Empty, Note, PageHeader, StatTile, StatusChip, Tabs } from "@/components/ui";
import { CHANNEL_IDS, projectionValueByChannel, salesByProduct, type Filters } from "@/lib/data/engine";
import { cycleSubmissions, useDataset, useMetrics, useSubmissions } from "@/lib/data/hooks";
import { consolidate, cycleById, cycleState, periodDays, submissionStatus } from "@/lib/data/plans";
import { addDays, diffDays, fmtDay, fmtRange } from "@/lib/dates";
import { daysUntilOrder, indentQuantity } from "@/lib/domain/formulas";
import { COVER_OPTIONS, type ChannelId } from "@/lib/domain/types";
import { fmtInt, fmtMoneyShort, fmtPct } from "@/lib/format";
import { WAREHOUSE_ID } from "@/lib/mock/catalog";
import { CYCLES } from "@/lib/mock/plans";
import { IS_PREVIEW, PREVIEW_NO_PRINT } from "@/lib/platform";
import { PLAN_PARTS, roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

type Tab = "consolidated" | "chain";

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("consolidated");
  return (
    <div>
      <PageHeader
        title="Reports"
        sub="The consolidated projection report that goes to the CBO, and the report chain from overall sales down to current stock."
        right={
          <>
            <Button icon={<Printer size={14} />} onClick={() => window.print()} disabled={IS_PREVIEW} disabledReason={PREVIEW_NO_PRINT}>
              Download PDF
            </Button>
            <Button icon={<Mail size={14} />} disabled disabledReason="Emailing the report works once email is connected (backend stage).">
              Email to CBO now
            </Button>
          </>
        }
      />
      <div className="no-print mb-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "consolidated", label: "Consolidated projection report" },
            { value: "chain", label: "Report chain" },
          ]}
        />
      </div>
      {tab === "consolidated" ? <ConsolidatedReport /> : <ReportChain />}
    </div>
  );
}

// ── Consolidated projection report ─────────────────────────────────────────────

function ConsolidatedReport() {
  const ds = useDataset();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const all = useSubmissions();
  const ordered = useMemo(() => [...CYCLES].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom)), []);
  const [cycleId, setCycleId] = useState(CYCLES.find((c) => cycleState(c, ds.today) === "open")?.id ?? ordered[0]!.id);
  const cycle = cycleById(cycleId)!;
  const subs = cycleSubmissions(all, cycle.id);
  const report = useMemo(() => consolidate(ds, settings, metrics, cycle, subs), [ds, settings, metrics, cycle, subs]);
  const flagged = report.rows.filter((r) => r.flagged);
  const prevCycle = ordered.find((c) => c.kind === cycle.kind && c.periodTo < cycle.periodFrom);
  const state = cycleState(cycle, ds.today);

  return (
    <div className="print-full">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Select
          label="Plan cycle"
          value={cycleId}
          onChange={setCycleId}
          width={300}
          options={ordered.map((c) => ({ value: c.id, label: c.label, hint: `${c.kind} · report ${fmtDay(c.reportOn)}` }))}
        />
        <span className="text-[12.5px] text-muted">
          {cycle.reportOn > ds.today ? "Goes to the CBO on" : "Sent to the CBO on"} {fmtDay(cycle.reportOn)}
          {state === "upcoming" ? " · plans not requested yet, shows the system projection only" : ""}
        </span>
      </div>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
          <div>
            <div className="text-[12px] font-semibold tracking-wide text-coral uppercase">Consolidated projection report</div>
            <h2 className="text-[18px] font-bold">
              {cycle.label} · {fmtRange(cycle.periodFrom, cycle.periodTo)} ({periodDays(cycle)} days)
            </h2>
          </div>
          <div className="text-[12px] text-muted">System projection + current trend + team plans · to CBO</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="System projection" value={fmtInt(report.totals.system)} sub={`units · ${fmtMoneyShort(report.totals.systemValue)}`} />
          <StatTile label="Team plan" value={fmtInt(report.totals.plan)} sub={`${fmtPct(report.totals.system ? ((report.totals.plan - report.totals.system) / report.totals.system) * 100 : null, true)} vs system`} />
          <StatTile label={`Gaps over ±${settings.gapFlagPct}%`} value={flagged.length} sub={flagged.length ? flagged.map((r) => r.label).join(", ") : "none"} tone={flagged.length ? "low" : "good"} />
          <StatTile label="Stock shortfalls" value={report.readiness.length} sub={report.readiness.length ? "products need more stock for the plan" : "stock covers the plan"} tone={report.readiness.length ? "critical" : "good"} />
        </div>

        <h3 className="mt-5 mb-2 text-[14px] font-semibold">1 · By channel</h3>
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">System projection</th>
                <th className="num">Sales plan</th>
                <th className="num">Marketing expects</th>
                <th className="num">D2C / clinic team</th>
                <th className="num">Gap vs system</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.channel}>
                  <td className="font-medium">
                    <ChannelTag channel={r.channel} />
                  </td>
                  <td className="num">{fmtInt(r.system)}</td>
                  <td className="num">{r.salesPlan !== null ? fmtInt(r.salesPlan) : <span className="text-muted">not in</span>}</td>
                  <td className="num">{r.marketing !== null ? fmtInt(r.marketing) : <span className="text-muted">not in</span>}</td>
                  <td className="num">{r.team !== null ? fmtInt(r.team) : <span className="text-muted">not in</span>}</td>
                  <td className={clsx("num", r.flagged && "font-semibold text-st-low")}>{r.gap !== null ? `${fmtPct(r.gap, true)}${r.flagged ? " ⚑" : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11.5px] text-muted">Gap compares the sales plan (or, if it is not in, the D2C / clinic team, then marketing) with the system projection.</p>

        <h3 className="mt-5 mb-2 text-[14px] font-semibold">2 · Clinic-wise (Manisha)</h3>
        <div className="grid gap-x-6 md:grid-cols-2">
          {report.clinics.map((c) => (
            <div key={c.key} className="flex items-center justify-between border-b border-line py-1.5 text-[13px]">
              <span className="font-medium">{c.label}</span>
              <span className="tabular">
                {fmtInt(c.system)} → {c.team !== null ? <b>{fmtInt(c.team)}</b> : <span className="text-muted">not in</span>}{" "}
                <span className={clsx("ml-1 inline-block w-14 text-right", c.flagged ? "font-semibold text-st-low" : "text-muted")}>{c.gap !== null ? fmtPct(c.gap, true) : ""}</span>
              </span>
            </div>
          ))}
        </div>

        <h3 className="mt-5 mb-2 text-[14px] font-semibold">3 · Stock readiness: is there enough stock for the plan?</h3>
        {report.readiness.length === 0 ? (
          <Empty title="Stock covers the plan">Current stock plus orders on the way meet the planned demand.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Planned demand</th>
                  <th className="num">Stock at period start</th>
                  <th className="num">Short by</th>
                  <th>Today</th>
                </tr>
              </thead>
              <tbody>
                {report.readiness.slice(0, 12).map((r) => {
                  const m = metrics.find((x) => x.product.id === r.product.id)!;
                  return (
                    <tr key={r.product.id} className="clickable" onClick={() => openProduct(r.product.id)}>
                      <td className="font-medium">{r.product.name}</td>
                      <td className="num">{fmtInt(r.demand)}</td>
                      <td className="num">{fmtInt(r.availableAtStart)}</td>
                      <td className="num font-semibold text-st-critical">{fmtInt(r.shortfall)}</td>
                      <td>
                        <StatusChip status={m.status} size="sm" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-[11.5px] text-muted">
              Shortfalls feed the indent. <Link href="/indent" className="text-coral hover:underline">Open Auto indent →</Link>
            </p>
          </div>
        )}

        <h3 className="mt-5 mb-2 text-[14px] font-semibold">4 · Submission status</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {PLAN_PARTS.map((p) => {
            const s = subs[p.id];
            return (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]">
                <span>
                  <b>{p.label}</b> <span className="text-muted">· {roleById(p.owner).person}</span>
                  {s?.note ? <span className="block text-[12px] text-ink-2">“{s.note}”</span> : null}
                </span>
                <SubmissionChip status={submissionStatus(cycle, s, ds.today)} />
              </div>
            );
          })}
        </div>

        {prevCycle ? <LastPeriod cycleId={prevCycle.id} /> : null}
      </Card>
    </div>
  );
}

function LastPeriod({ cycleId }: { cycleId: string }) {
  const ds = useDataset();
  const all = useSubmissions();
  const cycle = cycleById(cycleId)!;
  const sales = all[`${cycle.id}:sales`];
  const from = cycle.periodFrom;
  const to = cycle.periodTo < ds.today ? cycle.periodTo : ds.today;
  const range: Filters = { from, to, channels: [], locations: [], categories: [], search: "" };
  const actual = salesByProduct(ds, range);
  if (!sales) return null;
  const elapsed = Math.max(1, diffDays(to, from) + 1);
  const share = elapsed / periodDays(cycle);
  return (
    <>
      <h3 className="mt-5 mb-2 text-[14px] font-semibold">
        5 · Last period: {cycle.label} {share < 1 ? `(${Math.round(share * 100)}% of the period done)` : ""}
      </h3>
      <div className="overflow-x-auto scroll-thin">
      <table className="dtable">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Sales plan</th>
            <th className="num">System said</th>
            <th className="num">Actual</th>
            <th>Closer forecast</th>
          </tr>
        </thead>
        <tbody>
          {sales.lines.map((l) => {
            const act = actual.reduce((a, s) => a + s.byChannel[l.key as ChannelId].qty, 0);
            const plan = l.plannedUnits * share;
            const sys = l.systemUnits * share;
            const closer = Math.abs(plan - act) < Math.abs(sys - act) ? "Team plan" : "System";
            return (
              <tr key={l.key}>
                <td className="font-medium">{l.label}</td>
                <td className="num">{fmtInt(plan)}</td>
                <td className="num">{fmtInt(sys)}</td>
                <td className="num font-semibold">{fmtInt(act)}</td>
                <td>{closer}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

// ── Report chain ───────────────────────────────────────────────────────────────

function ChainStep({ n, title, sub, href, children, open, onToggle }: { n: number; title: string; sub: string; href: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <Card pad={false}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold">{title}</span>
          <span className="block text-[12.5px] text-muted">{sub}</span>
        </span>
        <Link href={href} onClick={(e) => e.stopPropagation()} className="no-print text-[12.5px] font-medium text-coral hover:underline">
          Open page →
        </Link>
        <ChevronDown size={16} className={clsx("text-muted transition", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div className="border-t border-line p-4">{children}</div> : null}
    </Card>
  );
}

function ReportChain() {
  const ds = useDataset();
  const metrics = useMetrics();
  const settings = usePanel((s) => s.settings);
  const openProduct = usePanel((s) => s.openProduct);
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true, 5: true });
  const toggle = (n: number) => setOpen((o) => ({ ...o, [n]: !o[n] }));

  const past = useMemo(
    () => [7, 15, 30].map((d) => ({ d, rows: salesByProduct(ds, { from: addDays(ds.today, -(d - 1)), to: ds.today, channels: [], locations: [], categories: [], search: "" }) })),
    [ds],
  );
  const proj = useMemo(() => [7, 15, 30].map((d) => ({ d, v: projectionValueByChannel(ds, settings, d) })), [ds, settings]);
  const groups: { label: string; chs: ChannelId[] }[] = [
    { label: "Website (Shopify)", chs: ["website"] },
    { label: "Online products (Amazon, Flipkart, online team)", chs: ["amazon", "flipkart", "online_team"] },
    { label: "Clinic sales", chs: ["clinic"] },
  ];

  const willBeLow = (h: number) => metrics.filter((m) => m.rate > 0 && m.stock + m.onOrder - m.rate * h < m.reorderPoint);
  const stillOver = (h: number) => metrics.filter((m) => m.rate > 0 && m.stock - m.rate * h > m.rate * settings.overstockDays);
  const orderWithin = (h: number) =>
    metrics
      .map((m) => ({ m, inDays: daysUntilOrder(m.stock, m.onOrder, m.rate, m.leadTime, settings.safetyDays) }))
      .filter((x) => x.inDays !== null && x.inDays <= h && x.m.indentQty > 0);
  const coverTotals = COVER_OPTIONS.map((c) => {
    let units = 0;
    let value = 0;
    for (const m of metrics) {
      if (m.rate <= 0) continue;
      const q = indentQuantity({ rate: m.rate, leadTime: m.leadTime, coverDays: c, safetyDays: settings.safetyDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize }).qty;
      units += q;
      value += q * m.product.cost;
    }
    return { c, units, value };
  });
  const whUnits = metrics.reduce((a, m) => a + m.warehouseStock, 0);
  const clUnits = metrics.reduce((a, m) => a + m.clinicStock, 0);
  const onWay = metrics.reduce((a, m) => a + m.onOrder, 0);
  const stockValue = metrics.reduce((a, m) => a + m.stock * m.product.cost, 0);

  return (
    <div className="space-y-3">
      <Note>Leadership reads this from the top (big picture) down. The system builds it from the bottom (stock facts) up. Each step opens its full page.</Note>

      <ChainStep n={1} title="Overall product sales · 7 / 15 / 30 days" sub="Website · online products · clinic sales, with the projection plan" href="/channels" open={!!open[1]} onToggle={() => toggle(1)}>
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th />
                {past.map((p) => (
                  <th key={p.d} className="num">
                    Last {p.d} days
                  </th>
                ))}
                {proj.map((p) => (
                  <th key={p.d} className="num">
                    Next {p.d} days
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...groups, { label: "Total", chs: CHANNEL_IDS as ChannelId[] }].map((g) => (
                <tr key={g.label} className={g.label === "Total" ? "font-semibold" : ""}>
                  <td className="whitespace-nowrap">{g.label}</td>
                  {past.map((p) => (
                    <td key={p.d} className="num">
                      {fmtMoneyShort(p.rows.reduce((a, s) => a + g.chs.reduce((b, c) => b + s.byChannel[c].value, 0), 0))}
                    </td>
                  ))}
                  {proj.map((p) => (
                    <td key={p.d} className="num text-ink-2">
                      {fmtMoneyShort(g.chs.reduce((a, c) => a + p.v[c], 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChainStep>

      <ChainStep n={2} title="Low stock & overstock report" sub="As per the 7 / 15 / 30-day projection" href="/stock" open={!!open[2]} onToggle={() => toggle(2)}>
        <div className="grid gap-3 md:grid-cols-3">
          {[7, 15, 30].map((h) => {
            const low = willBeLow(h);
            const over = stillOver(h);
            return (
              <div key={h} className="rounded-lg border border-line p-3">
                <div className="text-[13px] font-semibold">Within {h} days</div>
                <div className="mt-1 text-[12.5px] text-ink-2">
                  <b className="text-st-low">{low.length}</b> drop below their reorder point · <b className="text-st-over">{over.length}</b> still overstocked
                </div>
                <ul className="mt-2 space-y-0.5 text-[12.5px]">
                  {low.slice(0, 5).map((m) => (
                    <li key={m.product.id}>
                      <button className="truncate hover:underline" onClick={() => openProduct(m.product.id)}>
                        {m.product.name}
                      </button>
                    </li>
                  ))}
                  {low.length > 5 ? <li className="text-muted">+ {low.length - 5} more</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </ChainStep>

      <ChainStep n={3} title="Indent order projection report" sub="What to order, how much and by when" href="/indent" open={!!open[3]} onToggle={() => toggle(3)}>
        <div className="grid gap-3 md:grid-cols-3">
          {[7, 15, 30].map((h) => {
            const list = orderWithin(h);
            return (
              <div key={h} className="rounded-lg border border-line p-3">
                <div className="text-[13px] font-semibold">Order in the next {h} days</div>
                <div className="mt-1 text-[20px] font-bold tabular">{fmtMoneyShort(list.reduce((a, x) => a + x.m.indentQty * x.m.product.cost, 0))}</div>
                <div className="text-[12px] text-ink-2">
                  {list.length} products · {fmtInt(list.reduce((a, x) => a + x.m.indentQty, 0))} units
                </div>
              </div>
            );
          })}
        </div>
      </ChainStep>

      <ChainStep n={4} title="Stock indent · 15 / 30 / 60 / 90 days" sub="Quantity needed for each cover period (each product’s own lead time)" href="/indent" open={!!open[4]} onToggle={() => toggle(4)}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {coverTotals.map((c) => (
            <StatTile key={c.c} label={`Cover ${c.c} days`} value={fmtInt(c.units)} sub={`units · ${fmtMoneyShort(c.value)} at cost`} />
          ))}
        </div>
      </ChainStep>

      <ChainStep n={5} title="Current stock" sub="Mohali warehouse + all clinics, plus stock on the way" href="/stock" open={!!open[5]} onToggle={() => toggle(5)}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Warehouse" value={fmtInt(whUnits)} sub="units" />
          <StatTile label="All clinics" value={fmtInt(clUnits)} sub="units" />
          <StatTile label="On the way" value={fmtInt(onWay)} sub={`${ds.purchaseOrders.length} open POs`} />
          <StatTile label="Stock value" value={fmtMoneyShort(stockValue)} sub="at cost" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 text-[13px] md:grid-cols-5">
          {ds.locations.map((l) => (
            <div key={l.id} className="flex justify-between border-b border-line py-1">
              <span className="text-ink-2">{l.id === WAREHOUSE_ID ? "Warehouse" : l.name}</span>
              <span className="font-medium tabular">{fmtInt(metrics.reduce((a, m) => a + (m.stockByLocation[l.id] ?? 0), 0))}</span>
            </div>
          ))}
        </div>
      </ChainStep>
    </div>
  );
}
