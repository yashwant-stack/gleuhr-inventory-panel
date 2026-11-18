"use client";

import clsx from "clsx";
import { ArrowLeft, ChevronDown, ChevronRight, Paperclip, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useMemo, useState } from "react";
import { SubmissionChip } from "@/components/plan-ui";
import { toast } from "@/components/Toast";
import { Button, Card, CardHeader, Delta, Note, PageHeader, StatusChip } from "@/components/ui";
import { urgency, type ProductMetrics } from "@/lib/data/engine";
import { useDataset, useMetrics, useRole, useSubmissions } from "@/lib/data/hooks";
import { cycleById, cycleState, periodDays, planBaseline, spreadPlan, submissionStatus, type PlanLine, type TrendRow } from "@/lib/data/plans";
import { fmtDay, fmtRange } from "@/lib/dates";
import { gapPct, isGapFlagged } from "@/lib/domain/formulas";
import { fmtDays, fmtInt, fmtMoneyShort, fmtPct, fmtRate } from "@/lib/format";
import { PLAN_PARTS, roleById, type PlanPart } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

interface Draft {
  planned: Record<string, string>;
  /** Product by product, per line (the marketing plan): line key → product id → units typed. */
  products: Record<string, Record<string, string>>;
  activity: Record<string, string>;
  budget: Record<string, string>;
  note: string;
}

/** The marketing plan is planned product by product inside each channel; the channel total is their sum. */
const PRODUCT_WISE: PlanPart[] = ["marketing"];

const toNum = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

function PlanForm({ cycleId, part }: { cycleId: string; part: PlanPart }) {
  const router = useRouter();
  const ds = useDataset();
  const metrics = useMetrics();
  const role = useRole();
  const settings = usePanel((s) => s.settings);
  const submitPlan = usePanel((s) => s.submitPlan);
  const all = useSubmissions();

  const cycle = cycleById(cycleId);
  const meta = PLAN_PARTS.find((p) => p.id === part);

  const baseline = useMemo(() => (cycle && meta ? planBaseline(ds, settings, part, cycle) : []), [ds, settings, part, cycle, meta]);
  const existing = cycle ? all[`${cycle.id}:${part}`] : undefined;
  const productWise = PRODUCT_WISE.includes(part);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState<Draft>(() => ({
    planned: Object.fromEntries(baseline.map((b) => [b.key, String(existing?.lines.find((l) => l.key === b.key)?.plannedUnits ?? b.systemUnits)])),
    products: productWise
      ? Object.fromEntries(
          baseline.map((b) => {
            const line = existing?.lines.find((l) => l.key === b.key);
            // a saved product-wise plan as saved; a plan saved as one number per channel spread over its products
            const saved = line?.products ? Object.fromEntries(line.products.map((x) => [x.productId, x.plannedUnits])) : line ? spreadPlan(b.products, line.plannedUnits) : null;
            return [b.key, Object.fromEntries(b.products.map((x) => [x.productId, String(saved ? (saved[x.productId] ?? 0) : x.systemUnits)]))];
          }),
        )
      : {},
    activity: Object.fromEntries(baseline.map((b) => [b.key, existing?.lines.find((l) => l.key === b.key)?.activity ?? ""])),
    budget: Object.fromEntries(baseline.map((b) => [b.key, String(existing?.lines.find((l) => l.key === b.key)?.budget || "")])),
    note: existing?.note ?? "",
  }));

  if (!cycle || !meta) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <div className="text-[15px] font-semibold">This plan link is not valid</div>
        <Link href="/plans" className="mt-2 inline-block text-coral hover:underline">
          Back to Plans
        </Link>
      </div>
    );
  }

  const state = cycleState(cycle, ds.today);
  const owner = roleById(meta.owner);
  const isOwner = role.planPart === part;
  const canSubmit = isOwner && state === "open";
  const reason = !isOwner
    ? `Only ${owner.person} submits this. Switch “Viewing as” (top bar) to ${owner.person} to fill it in.`
    : state === "upcoming"
      ? `This plan opens on ${fmtDay(cycle.requestOn)}.`
      : state === "closed"
        ? `The deadline (${fmtDay(cycle.dueOn)}) has passed.`
        : "";
  const status = submissionStatus(cycle, existing, ds.today);
  const days = periodDays(cycle);
  const showBudget = part === "marketing";
  const showChannelsHint = part === "marketing" || part === "sales";

  const overstock = metrics.filter((m) => m.status === "overstock").sort((a, b) => b.excess * b.product.cost - a.excess * a.product.cost).slice(0, 6);
  const short = metrics.filter((m) => m.status === "critical" || m.status === "low").sort((a, b) => urgency(a) - urgency(b)).slice(0, 6);

  const productNum = (k: string, id: string) => toNum(draft.products[k]?.[id]);
  const num = (k: string) => {
    if (productWise) {
      const b = baseline.find((x) => x.key === k);
      if (!b) return NaN;
      let sum = 0;
      for (const x of b.products) {
        const n = productNum(k, x.productId);
        if (Number.isNaN(n)) return NaN;
        sum += n;
      }
      return sum;
    }
    return toNum(draft.planned[k]);
  };
  const invalid = baseline.some((b) => Number.isNaN(num(b.key)));
  const byId = new Map(metrics.map((m) => [m.product.id, m]));
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const setProduct = (k: string, id: string, v: string) => setDraft((d) => ({ ...d, products: { ...d.products, [k]: { ...d.products[k], [id]: v.replace(/[^0-9]/g, "") } } }));
  const resetLine = (b: TrendRow) => setDraft((d) => ({ ...d, products: { ...d.products, [b.key]: Object.fromEntries(b.products.map((x) => [x.productId, String(x.systemUnits)])) } }));
  const totalSystem = baseline.reduce((a, b) => a + b.systemUnits, 0);
  const totalPlanned = baseline.reduce((a, b) => a + (Number.isNaN(num(b.key)) ? 0 : num(b.key)), 0);

  const submit = () => {
    if (!canSubmit || invalid) return;
    const lines: PlanLine[] = baseline.map((b) => ({
      key: b.key,
      label: b.label,
      systemUnits: b.systemUnits,
      plannedUnits: num(b.key),
      activity: draft.activity[b.key] ?? "",
      budget: Number(draft.budget[b.key]) || 0,
      // only products with a projection or a plan are kept; the rest are 0
      ...(productWise
        ? {
            products: b.products
              .map((x) => ({ productId: x.productId, systemUnits: x.systemUnits, plannedUnits: productNum(b.key, x.productId) }))
              .filter((x) => x.systemUnits > 0 || x.plannedUnits > 0),
          }
        : {}),
    }));
    // Sample data lives on its own calendar day; live data uses the real clock.
    const now = new Date().toISOString();
    const submittedAt = ds.origin === "sample" ? `${ds.today}${now.slice(10)}` : now;
    submitPlan({ cycleId: cycle.id, part, by: role.id, submittedAt, lines, note: draft.note, version: (existing?.version ?? 0) + 1 });
    toast(`${meta.label} for ${cycle.label} submitted. Saved in this browser only; the email to CBO${cycle.kind === "monthly" ? ", MD and Herman" : ""} goes out once email is connected.`);
    router.push("/plans");
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/plans" className="no-print mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Back to Plans
      </Link>
      <PageHeader
        title={`${meta.label} · ${cycle.label}`}
        sub={`For ${fmtRange(cycle.periodFrom, cycle.periodTo)} (next ${days} days) · filled by ${owner.person} · due ${fmtDay(cycle.dueOn)}`}
        right={<SubmissionChip status={status} />}
      />

      {!canSubmit ? (
        <div className="mb-3">
          <Note tone="warn">{reason} {existing ? "You are looking at the submitted plan." : "You are looking at a preview."}</Note>
        </div>
      ) : null}

      <Card>
        <CardHeader title="A · Current trend" sub="Filled in automatically from Zoho sales · read only" />
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>{part === "clinic" ? "Clinic" : "Channel"}</th>
                <th className="num">Last 30 days (units)</th>
                <th className="num">Value</th>
                <th className="num">Per day</th>
                <th className="num">vs previous 30 days</th>
                <th className="num">System projection ({days} days)</th>
              </tr>
            </thead>
            <tbody>
              {baseline.map((b) => (
                <tr key={b.key}>
                  <td className="font-medium">{b.label}</td>
                  <td className="num">{fmtInt(b.last30)}</td>
                  <td className="num">{fmtMoneyShort(b.last30Value)}</td>
                  <td className="num">{fmtRate(b.perDay)}</td>
                  <td className="num">
                    <Delta pct={b.growthPct} />
                  </td>
                  <td className="num font-semibold">{fmtInt(b.systemUnits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showChannelsHint ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-st-over-soft p-3">
              <div className="mb-1 text-[12.5px] font-semibold text-st-over">Overstock: needs a push</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {overstock.map((m) => (
                  <li key={m.product.id} className="flex justify-between gap-2">
                    <span className="truncate">{m.product.name}</span>
                    <span className="text-ink-2 tabular">{fmtInt(m.excess)} excess</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-st-critical-soft p-3">
              <div className="mb-1 text-[12.5px] font-semibold text-st-critical">Short on stock: don’t promote yet</div>
              <ul className="space-y-0.5 text-[12.5px]">
                {short.map((m) => (
                  <li key={m.product.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.product.name}</span>
                    <span className="flex items-center gap-1.5 text-ink-2 tabular">
                      {fmtDays(m.cover)}d left <StatusChip status={m.status} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="mt-3">
        <CardHeader
          title="B · Projected trend and plan"
          sub={`Starts from the system projection. Change a number only where you know something the data can’t show. Changes over ±${settings.gapFlagPct}% are flagged in the CBO’s report.${productWise ? " Click a channel to plan it product by product: its expected units are the sum of its products." : ""}`}
        />
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>{part === "clinic" ? "Clinic" : "Channel"}</th>
                <th className="num">System</th>
                <th className="num" style={{ width: 120 }}>
                  Expected units
                </th>
                <th className="num">Change</th>
                <th>{part === "d2c" || part === "clinic" ? "Reason / note" : "Planned activity (campaign, offer, launch)"}</th>
                {showBudget ? (
                  <th className="num" style={{ width: 120 }}>
                    Budget (₹)
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {baseline.map((b) => {
                const n = num(b.key);
                const g = Number.isNaN(n) ? null : gapPct(n, b.systemUnits);
                const flagged = !Number.isNaN(n) && isGapFlagged(n, b.systemUnits, settings.gapFlagPct);
                const isOpen = open.has(b.key);
                return (
                  <Fragment key={b.key}>
                  <tr>
                    <td className="font-medium whitespace-nowrap">
                      {productWise ? (
                        <button
                          type="button"
                          onClick={() => toggle(b.key)}
                          aria-expanded={isOpen}
                          aria-controls={`products-${b.key}`}
                          className="inline-flex items-center gap-1 text-left hover:text-coral-dark"
                        >
                          {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                          {b.label}
                          <span className="ml-1 text-[11.5px] font-normal text-muted">{isOpen ? "hide products" : "by product"}</span>
                        </button>
                      ) : (
                        b.label
                      )}
                    </td>
                    <td className="num text-ink-2">{fmtInt(b.systemUnits)}</td>
                    <td className="num">
                      {productWise ? (
                        <button
                          type="button"
                          onClick={() => toggle(b.key)}
                          title="The sum of this channel's products. Click to edit them."
                          className={clsx("h-8 w-full rounded-md border border-dashed px-2 text-right font-semibold tabular", Number.isNaN(n) ? "border-st-critical" : "border-line-strong")}
                        >
                          {Number.isNaN(n) ? "—" : fmtInt(n)}
                        </button>
                      ) : (
                      <input
                        inputMode="numeric"
                        aria-label={`Expected units for ${b.label}`}
                        value={draft.planned[b.key] ?? ""}
                        disabled={!canSubmit}
                        onChange={(e) => setDraft((d) => ({ ...d, planned: { ...d.planned, [b.key]: e.target.value.replace(/[^0-9]/g, "") } }))}
                        className={clsx(
                          "h-8 w-full rounded-md border px-2 text-right tabular",
                          Number.isNaN(n) ? "border-st-critical" : "border-line-strong",
                          !canSubmit && "bg-sunken text-ink-2",
                        )}
                      />
                      )}
                    </td>
                    <td className={clsx("num whitespace-nowrap", flagged && "font-semibold text-st-low")}>{g === null ? "—" : `${fmtPct(g, true)}${flagged ? " ⚑" : ""}`}</td>
                    <td>
                      <input
                        aria-label={`Activity for ${b.label}`}
                        value={draft.activity[b.key] ?? ""}
                        disabled={!canSubmit}
                        placeholder={canSubmit ? "Optional" : ""}
                        onChange={(e) => setDraft((d) => ({ ...d, activity: { ...d.activity, [b.key]: e.target.value } }))}
                        className={clsx("h-8 w-full min-w-[220px] rounded-md border border-line-strong px-2", !canSubmit && "bg-sunken text-ink-2")}
                      />
                    </td>
                    {showBudget ? (
                      <td className="num">
                        <input
                          inputMode="numeric"
                          aria-label={`Budget for ${b.label}`}
                          value={draft.budget[b.key] ?? ""}
                          disabled={!canSubmit}
                          onChange={(e) => setDraft((d) => ({ ...d, budget: { ...d.budget, [b.key]: e.target.value.replace(/[^0-9]/g, "") } }))}
                          className={clsx("h-8 w-full rounded-md border border-line-strong px-2 text-right tabular", !canSubmit && "bg-sunken text-ink-2")}
                        />
                      </td>
                    ) : null}
                  </tr>
                  {productWise && isOpen ? (
                    <tr id={`products-${b.key}`}>
                      <td colSpan={showBudget ? 6 : 5} className="bg-bone px-3 py-3">
                        <ProductPlan
                          line={b}
                          days={days}
                          values={draft.products[b.key] ?? {}}
                          byId={byId}
                          canEdit={canSubmit}
                          gapFlagPct={settings.gapFlagPct}
                          onChange={(id, v) => setProduct(b.key, id, v)}
                          onReset={() => resetLine(b)}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border-t border-line-strong px-2.5 py-2">Total</td>
                <td className="num border-t border-line-strong px-2.5">{fmtInt(totalSystem)}</td>
                <td className="num border-t border-line-strong px-2.5">{fmtInt(totalPlanned)}</td>
                <td className="num border-t border-line-strong px-2.5">{fmtPct(gapPct(totalPlanned, totalSystem), true)}</td>
                <td className="border-t border-line-strong" colSpan={showBudget ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>

        <label className="mt-4 block text-[12.5px] font-semibold text-ink-2">
          Notes for the CBO
          <textarea
            value={draft.note}
            disabled={!canSubmit}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            rows={3}
            className={clsx("mt-1 w-full rounded-lg border border-line-strong p-2 text-[13px] font-normal text-ink", !canSubmit && "bg-sunken")}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button icon={<Paperclip size={14} />} disabled disabledReason="Attaching a file (PDF / Excel / PPT) comes in the next stage, with file storage.">
            Attach plan file (optional)
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {invalid ? <span className="text-[12.5px] text-st-critical">Fill every expected-units box with a number{productWise ? " (open each channel to check its products)" : ""}</span> : null}
            <Button variant="primary" onClick={submit} disabled={!canSubmit || invalid} disabledReason={reason || "Fix the highlighted boxes first"}>
              {existing ? `Submit as version ${(existing.version ?? 1) + 1}` : "Submit plan"}
            </Button>
          </div>
        </div>
        {existing && canSubmit ? <p className="mt-2 text-right text-[11.5px] text-muted">A new submission is saved as a new version; the earlier one is kept.</p> : null}
      </Card>
    </div>
  );
}

/** One channel's products: stock now, last 30 days, the system's expectation and the planner's own number. */
function ProductPlan({
  line,
  days,
  values,
  byId,
  canEdit,
  gapFlagPct,
  onChange,
  onReset,
}: {
  line: TrendRow;
  days: number;
  values: Record<string, string>;
  byId: Map<string, ProductMetrics>;
  canEdit: boolean;
  gapFlagPct: number;
  onChange: (productId: string, value: string) => void;
  onReset: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = line.products
    .map((x) => ({ ...x, m: byId.get(x.productId), n: toNum(values[x.productId]) }))
    .filter((r) => r.m)
    .sort((a, b) => b.systemUnits - a.systemUnits || b.last30 - a.last30 || a.m!.product.name.localeCompare(b.m!.product.name));
  const active = (r: (typeof rows)[number]) => r.systemUnits > 0 || r.last30 > 0 || (r.n > 0 && !Number.isNaN(r.n));
  const shown = showAll ? rows : rows.filter(active);
  const hidden = rows.length - shown.length;
  const total = rows.reduce((a, r) => a + (Number.isNaN(r.n) ? 0 : r.n), 0);
  const changed = rows.some((r) => r.n !== r.systemUnits);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="font-semibold text-ink">{line.label}: product by product</span>
        <span className="text-ink-2">
          {rows.filter(active).length} products sold here · system {fmtInt(line.systemUnits)} · expected {fmtInt(total)} in {days} days
        </span>
        {canEdit && changed ? (
          <button type="button" onClick={onReset} className="ml-auto inline-flex items-center gap-1 text-ink-2 hover:text-ink">
            <RotateCcw size={12} aria-hidden /> Reset to system
          </button>
        ) : null}
      </div>
      <div className="max-h-[440px] overflow-auto rounded-lg border border-line bg-surface scroll-thin">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Stock now</th>
              <th className="num">Last 30 days (units)</th>
              <th className="num">System</th>
              <th className="num" style={{ width: 120 }}>
                Expected units
              </th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const m = r.m!;
              const g = Number.isNaN(r.n) || r.systemUnits <= 0 ? null : gapPct(r.n, r.systemUnits);
              const flagged = !Number.isNaN(r.n) && r.systemUnits > 0 && isGapFlagged(r.n, r.systemUnits, gapFlagPct);
              return (
                <tr key={r.productId}>
                  <td>
                    <div className="max-w-[260px] truncate font-medium">{m.product.name}</div>
                    <div className="text-[11px] text-muted">{m.product.sku}</div>
                  </td>
                  <td className="num whitespace-nowrap">
                    <span className="tabular">{fmtInt(m.stock)}</span>{" "}
                    {m.status === "critical" || m.status === "low" || m.status === "overstock" ? <StatusChip status={m.status} size="sm" /> : null}
                  </td>
                  <td className="num text-ink-2">{fmtInt(r.last30)}</td>
                  <td className="num text-ink-2">{fmtInt(r.systemUnits)}</td>
                  <td className="num">
                    <input
                      inputMode="numeric"
                      aria-label={`Expected units for ${m.product.name} (${line.label})`}
                      value={values[r.productId] ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => onChange(r.productId, e.target.value)}
                      className={clsx(
                        "h-8 w-full rounded-md border px-2 text-right tabular",
                        Number.isNaN(r.n) ? "border-st-critical" : "border-line-strong",
                        !canEdit && "bg-sunken text-ink-2",
                      )}
                    />
                  </td>
                  <td className={clsx("num whitespace-nowrap", flagged && "font-semibold text-st-low")}>
                    {r.systemUnits <= 0 ? (!Number.isNaN(r.n) && r.n > 0 ? "new" : "—") : g === null ? "—" : `${fmtPct(g, true)}${flagged ? " ⚑" : ""}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 || showAll ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] text-ink-2 hover:text-ink hover:underline">
          {showAll ? "Hide products with no sales here" : `Show ${hidden} more product${hidden === 1 ? "" : "s"} with no sales here in the last 60 days`}
        </button>
      ) : null}
    </div>
  );
}

/** Reads the link's cycle and part; a different link (or a new version) starts a fresh draft. */
function PlanFormRoute() {
  const params = useSearchParams();
  const all = useSubmissions();
  const cycleId = params.get("cycle") ?? "";
  const part = (params.get("part") ?? "") as PlanPart;
  const version = all[`${cycleId}:${part}`]?.version ?? 0;
  return <PlanForm key={`${cycleId}:${part}:${version}`} cycleId={cycleId} part={part} />;
}

export default function PlanFormPage() {
  return (
    <Suspense fallback={<div className="text-[13px] text-muted">Loading…</div>}>
      <PlanFormRoute />
    </Suspense>
  );
}
