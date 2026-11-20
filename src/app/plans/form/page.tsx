"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Lock, Paperclip, RotateCcw, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { SubmissionChip } from "@/components/plan-ui";
import { Select } from "@/components/Select";
import { toast } from "@/components/Toast";
import { Button, Card, CardHeader, Delta, Note, PageHeader, StatusChip } from "@/components/ui";
import { urgency, type ProductMetrics } from "@/lib/data/engine";
import { useDataset, useMetrics, useRole, useSubmissions } from "@/lib/data/hooks";
import {
  clinicSplit,
  cycleById,
  cycleState,
  periodDays,
  planBaseline,
  planStockCheck,
  spreadPlan,
  submissionStatus,
  type PlanLine,
  type ProductPlanTotal,
  type StockCheckRow,
  type TrendRow,
} from "@/lib/data/plans";
import { fmtDay, fmtRange } from "@/lib/dates";
import { gapPct, isGapFlagged } from "@/lib/domain/formulas";
import { fmtDays, fmtInt, fmtMoney, fmtMoneyShort, fmtPct, fmtRate } from "@/lib/format";
import { CONSENT_PARTS, PLAN_PARTS, roleById, type PlanPart } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

interface Draft {
  /** Lines entered as one number (the sales plan's Online team and Website). */
  planned: Record<string, string>;
  /** Marketing plan, product by product: line key → product id → units typed. */
  products: Record<string, Record<string, string>>;
  /** Marketing plan, ad budget per product: line key → product id → ₹ typed. */
  productBudget: Record<string, Record<string, string>>;
  /** Sales plan, the Clinics line clinic by clinic: clinic key → units typed. */
  clinics: Record<string, string>;
  activity: Record<string, string>;
  note: string;
}

/** The marketing plan is planned product by product inside each channel; the channel total is their sum. */
const PRODUCT_WISE: PlanPart[] = ["marketing"];

const toNum = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};
/** A budget box: empty is ₹0. */
const toBudget = (v: string | undefined) => (v === undefined || v === "" ? 0 : toNum(v));
const digits = (v: string) => v.replace(/[^0-9]/g, "");

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
  const clinicLine = part === "sales" ? baseline.find((b) => b.key === "clinic") : undefined;
  const clinicRows = useMemo(() => (cycle && clinicLine ? clinicSplit(ds, settings, cycle, clinicLine.systemUnits) : []), [ds, settings, cycle, clinicLine]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [consentOpen, setConsentOpen] = useState(false);

  const [draft, setDraft] = useState<Draft>(() => {
    const lineOf = (k: string) => existing?.lines.find((l) => l.key === k);
    const savedClinic = lineOf("clinic");
    const clinicSaved = savedClinic?.clinics
      ? Object.fromEntries(savedClinic.clinics.map((c) => [c.key, c.plannedUnits]))
      : savedClinic
        ? spreadPlan(clinicRows.map((c) => ({ productId: c.key, systemUnits: c.systemUnits })), savedClinic.plannedUnits)
        : null;
    return {
      planned: Object.fromEntries(baseline.map((b) => [b.key, String(lineOf(b.key)?.plannedUnits ?? b.systemUnits)])),
      products: productWise
        ? Object.fromEntries(
            baseline.map((b) => {
              const line = lineOf(b.key);
              // a saved product-wise plan as saved; a plan saved as one number per channel spread over its products
              const saved = line?.products ? Object.fromEntries(line.products.map((x) => [x.productId, x.plannedUnits])) : line ? spreadPlan(b.products, line.plannedUnits) : null;
              return [b.key, Object.fromEntries(b.products.map((x) => [x.productId, String(saved ? (saved[x.productId] ?? 0) : x.systemUnits)]))];
            }),
          )
        : {},
      productBudget: productWise
        ? Object.fromEntries(
            baseline.map((b) => {
              const line = lineOf(b.key);
              // budgets saved per product as saved; a channel budget saved as one number spread like the units
              const saved = line?.products?.some((x) => x.budget !== undefined)
                ? Object.fromEntries(line.products.map((x) => [x.productId, x.budget ?? 0]))
                : line?.budget
                  ? spreadPlan(b.products, line.budget)
                  : {};
              return [b.key, Object.fromEntries(b.products.map((x) => [x.productId, saved[x.productId] ? String(saved[x.productId]) : ""]))];
            }),
          )
        : {},
      clinics: Object.fromEntries(clinicRows.map((c) => [c.key, String(clinicSaved ? (clinicSaved[c.key] ?? 0) : c.systemUnits)])),
      activity: Object.fromEntries(baseline.map((b) => [b.key, lineOf(b.key)?.activity ?? ""])),
      note: existing?.note ?? "",
    };
  });

  const productNum = (k: string, id: string) => toNum(draft.products[k]?.[id]);
  const productBudget = (k: string, id: string) => toBudget(draft.productBudget[k]?.[id]);
  const sumOrNaN = (vals: number[]) => (vals.some((v) => Number.isNaN(v)) ? NaN : vals.reduce((a, v) => a + v, 0));
  const num = (k: string): number => {
    const b = baseline.find((x) => x.key === k);
    if (!b) return NaN;
    if (productWise) return sumOrNaN(b.products.map((x) => productNum(k, x.productId)));
    if (clinicLine && k === "clinic") return sumOrNaN(clinicRows.map((c) => toNum(draft.clinics[c.key])));
    return toNum(draft.planned[k]);
  };
  const lineBudget = (k: string): number => {
    const b = baseline.find((x) => x.key === k);
    return b ? sumOrNaN(b.products.map((x) => productBudget(k, x.productId))) : NaN;
  };

  // the plan's stock check: every product, all channels of the plan together
  const totals = useMemo(() => {
    const t: Record<string, ProductPlanTotal> = {};
    if (!productWise) {
      // a plan by channel (the sales plan): each product sold in a channel moves with that channel's change
      for (const b of baseline) {
        const n = num(b.key);
        const factor = !Number.isNaN(n) && b.systemUnits > 0 ? n / b.systemUnits : 1;
        for (const x of b.products) {
          const cur = (t[x.productId] ??= { system: 0, planned: 0, budget: 0 });
          cur.system += x.systemUnits;
          cur.planned += x.systemUnits * factor;
        }
      }
      return t;
    }
    for (const b of baseline) {
      for (const x of b.products) {
        const cur = (t[x.productId] ??= { system: 0, planned: 0, budget: 0 });
        cur.system += x.systemUnits;
        const n = toNum(draft.products[b.key]?.[x.productId]);
        cur.planned += Number.isNaN(n) ? x.systemUnits : n;
        const bud = toBudget(draft.productBudget[b.key]?.[x.productId]);
        cur.budget += Number.isNaN(bud) ? 0 : bud;
      }
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- num() reads draft.planned / draft.clinics, listed below
  }, [baseline, draft.products, draft.productBudget, draft.planned, draft.clinics, productWise]);
  const check = useMemo(() => (cycle ? planStockCheck(ds, metrics, cycle, totals) : []), [ds, metrics, cycle, totals]);
  const checkById = useMemo(() => new Map(check.map((r) => [r.product.id, r])), [check]);

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
  const locked = !!existing?.locked;
  const canSubmit = isOwner && state === "open" && !locked;
  const reason = locked
    ? `Submitted and locked on ${fmtDay(existing!.submittedAt.slice(0, 10))}${existing?.consent ? ", after confirming the stock warnings and the MD’s approval" : ""}. It can’t be edited. Management can reopen it if a change is needed.`
    : !isOwner
      ? `Only ${owner.person} submits this. Switch “Viewing as” (top bar) to ${owner.person} to fill it in.`
      : state === "upcoming"
        ? `This plan opens on ${fmtDay(cycle.requestOn)}.`
        : state === "closed"
          ? `The deadline (${fmtDay(cycle.dueOn)}) has passed.`
          : "";
  const status = submissionStatus(cycle, existing, ds.today);
  const days = periodDays(cycle);
  const showBudget = part === "marketing";
  const needsConsent = CONSENT_PARTS.includes(part);

  const overstock = metrics.filter((m) => m.status === "overstock").sort((a, b) => b.excess * b.product.cost - a.excess * a.product.cost).slice(0, 6);
  const short = metrics.filter((m) => m.status === "critical" || m.status === "low").sort((a, b) => urgency(a) - urgency(b)).slice(0, 6);

  const invalid = baseline.some((b) => Number.isNaN(num(b.key))) || (showBudget && baseline.some((b) => Number.isNaN(lineBudget(b.key))));
  const byId = new Map(metrics.map((m) => [m.product.id, m]));
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const setProduct = (k: string, id: string, v: string) => setDraft((d) => ({ ...d, products: { ...d.products, [k]: { ...d.products[k], [id]: digits(v) } } }));
  const setBudget = (k: string, id: string, v: string) => setDraft((d) => ({ ...d, productBudget: { ...d.productBudget, [k]: { ...d.productBudget[k], [id]: digits(v) } } }));
  const resetLine = (b: TrendRow) => setDraft((d) => ({ ...d, products: { ...d.products, [b.key]: Object.fromEntries(b.products.map((x) => [x.productId, String(x.systemUnits)])) } }));
  const resetClinics = () => setDraft((d) => ({ ...d, clinics: Object.fromEntries(clinicRows.map((c) => [c.key, String(c.systemUnits)])) }));
  /** Takes the ad budget off the products at risk of running out (all channels). */
  const dropRiskBudgets = (ids: string[]) =>
    setDraft((d) => ({
      ...d,
      productBudget: Object.fromEntries(Object.entries(d.productBudget).map(([k, row]) => [k, Object.fromEntries(Object.entries(row).map(([id, v]) => [id, ids.includes(id) ? "" : v]))])),
    }));
  const totalSystem = baseline.reduce((a, b) => a + b.systemUnits, 0);
  const totalPlanned = baseline.reduce((a, b) => a + (Number.isNaN(num(b.key)) ? 0 : num(b.key)), 0);
  const totalBudget = showBudget ? baseline.reduce((a, b) => a + (Number.isNaN(lineBudget(b.key)) ? 0 : lineBudget(b.key)), 0) : 0;
  const atRisk = check.filter((r) => r.risk === "at_risk");
  const overNotPushed = check.filter((r) => r.risk === "overstock");

  const save = (lock: boolean) => {
    if (!canSubmit || invalid) return;
    const lines: PlanLine[] = baseline.map((b) => ({
      key: b.key,
      label: b.label,
      systemUnits: b.systemUnits,
      plannedUnits: num(b.key),
      activity: draft.activity[b.key] ?? "",
      budget: showBudget ? lineBudget(b.key) : 0,
      // only products with a projection, a plan or a budget are kept; the rest are 0
      ...(productWise
        ? {
            products: b.products
              .map((x) => ({ productId: x.productId, systemUnits: x.systemUnits, plannedUnits: productNum(b.key, x.productId), budget: productBudget(b.key, x.productId) }))
              .filter((x) => x.systemUnits > 0 || x.plannedUnits > 0 || x.budget > 0),
          }
        : {}),
      ...(clinicLine && b.key === "clinic" ? { clinics: clinicRows.map((c) => ({ key: c.key, label: c.label, systemUnits: c.systemUnits, plannedUnits: toNum(draft.clinics[c.key]) })) } : {}),
    }));
    // Sample data lives on its own calendar day; live data uses the real clock.
    const now = new Date().toISOString();
    const submittedAt = ds.origin === "sample" ? `${ds.today}${now.slice(10)}` : now;
    submitPlan({
      cycleId: cycle.id,
      part,
      by: role.id,
      submittedAt,
      lines,
      note: draft.note,
      version: (existing?.version ?? 0) + 1,
      ...(lock
        ? { locked: true, consent: { at: submittedAt, by: role.id, atRisk: atRisk.map((r) => r.product.name), overstock: overNotPushed.map((r) => r.product.name), mdApproved: true as const } }
        : {}),
    });
    toast(`${meta.label} for ${cycle.label} submitted${lock ? " and locked" : ""}. Saved in this browser only; the email to Management goes out once email is connected.`);
    router.push("/plans");
  };
  const submit = () => (needsConsent ? setConsentOpen(true) : save(false));
  const reopen = () => {
    if (!existing) return;
    const now = new Date().toISOString();
    submitPlan({ ...existing, locked: false, reopened: { at: ds.origin === "sample" ? `${ds.today}${now.slice(10)}` : now, by: role.id } });
    toast(`${meta.label} reopened. ${owner.person} can change it and submit it again, with a new consent.`);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/plans" className="no-print mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Back to Plans
      </Link>
      <PageHeader
        title={`${meta.label} · ${cycle.label}`}
        sub={`For ${fmtRange(cycle.periodFrom, cycle.periodTo)} (next ${days} days) · filled by ${owner.person} · due ${fmtDay(cycle.dueOn)}`}
        right={
          <span className="flex items-center gap-2">
            {locked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[12px] font-semibold text-ink-2">
                <Lock size={12} aria-hidden /> Locked
              </span>
            ) : null}
            <SubmissionChip status={status} />
          </span>
        }
      />

      {!canSubmit ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Note tone="warn">
              {reason} {!locked ? (existing ? "You are looking at the submitted plan." : "You are looking at a preview.") : ""}
            </Note>
          </div>
          {locked && role.access === "admin" ? (
            <Button icon={<Unlock size={14} />} onClick={reopen}>
              Reopen for changes
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader title="A · Current trend" sub="Filled in automatically from sales · read only" />
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Channel</th>
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
      </Card>

      <Card className="mt-3">
        <CardHeader
          title="B · Projected trend and plan"
          sub={`Starts from the system projection. Change a number only where you know something the data can’t show. Changes over ±${settings.gapFlagPct}% are flagged in Management’s report.${
            productWise ? " Click a channel to plan it product by product, with each product’s ad budget: the channel’s expected units and budget are the sums of its products." : ""
          }${clinicLine ? " Click Clinics to plan it clinic by clinic: its expected units are the sum of its clinics." : ""}`}
        />
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">System</th>
                <th className="num" style={{ width: 120 }}>
                  Expected units
                </th>
                <th className="num">Change</th>
                <th>Planned activity (campaign, offer, launch)</th>
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
                const breaks = productWise ? "product" : clinicLine && b.key === "clinic" ? "clinic" : null;
                const riskHere = productWise ? b.products.filter((x) => checkById.get(x.productId)?.risk === "at_risk" && (productNum(b.key, x.productId) > 0 || productBudget(b.key, x.productId) > 0)).length : 0;
                return (
                  <Fragment key={b.key}>
                    <tr>
                      <td className="font-medium whitespace-nowrap">
                        {breaks ? (
                          <button
                            type="button"
                            onClick={() => toggle(b.key)}
                            aria-expanded={isOpen}
                            aria-controls={`${breaks}s-${b.key}`}
                            className="inline-flex items-center gap-1 text-left hover:text-coral-dark"
                          >
                            {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                            {b.label}
                            <span className="ml-1 text-[11.5px] font-normal text-muted">{isOpen ? `hide ${breaks}s` : `by ${breaks}`}</span>
                          </button>
                        ) : (
                          b.label
                        )}
                        {riskHere ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-st-critical-soft px-1.5 text-[11px] font-semibold text-st-critical">
                            <AlertTriangle size={11} aria-hidden /> {riskHere} at risk
                          </span>
                        ) : null}
                      </td>
                      <td className="num text-ink-2">{fmtInt(b.systemUnits)}</td>
                      <td className="num">
                        {breaks ? (
                          <button
                            type="button"
                            onClick={() => toggle(b.key)}
                            title={`The sum of this channel's ${breaks}s. Click to edit them.`}
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
                            onChange={(e) => setDraft((d) => ({ ...d, planned: { ...d.planned, [b.key]: digits(e.target.value) } }))}
                            className={clsx("h-8 w-full rounded-md border px-2 text-right tabular", Number.isNaN(n) ? "border-st-critical" : "border-line-strong", !canSubmit && "bg-sunken text-ink-2")}
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
                          <button
                            type="button"
                            onClick={() => toggle(b.key)}
                            title="The sum of this channel's product ad budgets. Click to edit them."
                            className="h-8 w-full rounded-md border border-dashed border-line-strong px-2 text-right tabular"
                          >
                            {Number.isNaN(lineBudget(b.key)) ? "—" : fmtInt(lineBudget(b.key))}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    {breaks === "product" && isOpen ? (
                      <tr id={`products-${b.key}`}>
                        <td colSpan={showBudget ? 6 : 5} className="bg-bone px-3 py-3">
                          <ProductPlan
                            line={b}
                            days={days}
                            values={draft.products[b.key] ?? {}}
                            budgets={draft.productBudget[b.key] ?? {}}
                            byId={byId}
                            checkById={checkById}
                            canEdit={canSubmit}
                            gapFlagPct={settings.gapFlagPct}
                            onChange={(id, v) => setProduct(b.key, id, v)}
                            onBudget={(id, v) => setBudget(b.key, id, v)}
                            onReset={() => resetLine(b)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {breaks === "clinic" && isOpen ? (
                      <tr id={`clinics-${b.key}`}>
                        <td colSpan={5} className="bg-bone px-3 py-3">
                          <ClinicPlan
                            rows={clinicRows}
                            days={days}
                            values={draft.clinics}
                            canEdit={canSubmit}
                            gapFlagPct={settings.gapFlagPct}
                            onChange={(key, v) => setDraft((d) => ({ ...d, clinics: { ...d.clinics, [key]: digits(v) } }))}
                            onReset={resetClinics}
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
                <td className="border-t border-line-strong" />
                {showBudget ? <td className="num border-t border-line-strong px-2.5">{fmtInt(totalBudget)}</td> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <StockCheck rows={check} cycleLabel={fmtRange(cycle.periodFrom, cycle.periodTo)} withBudget={showBudget} />

      <Card className="mt-3">
        <label className="block text-[12.5px] font-semibold text-ink-2">
          Notes for Management
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
            {invalid ? <span className="text-[12.5px] text-st-critical">Fill every expected-units box with a number{productWise || clinicLine ? " (open each channel to check its rows)" : ""}</span> : null}
            <Button variant="primary" onClick={submit} disabled={!canSubmit || invalid} disabledReason={reason || "Fix the highlighted boxes first"}>
              {existing ? `Submit as version ${(existing.version ?? 1) + 1}` : "Submit plan"}
            </Button>
          </div>
        </div>
        {canSubmit ? (
          <p className="mt-2 text-right text-[11.5px] text-muted">
            {needsConsent
              ? `Before it is sent you confirm the stock warnings and the MD’s approval. A submitted ${meta.label.toLowerCase()} is locked: it can’t be edited.`
              : existing
                ? "A new submission is saved as a new version; the earlier one is kept."
                : ""}
          </p>
        ) : null}
      </Card>

      {consentOpen ? (
        <ConsentDialog
          withBudget={showBudget}
          atRisk={atRisk}
          overstock={overNotPushed}
          tight={check.filter((r) => r.risk === "tight" && !r.etaOnOrder && r.planned > 0)}
          onDropBudgets={() => dropRiskBudgets(atRisk.map((r) => r.product.id))}
          onCancel={() => setConsentOpen(false)}
          onConfirm={() => {
            setConsentOpen(false);
            save(true);
          }}
        />
      ) : null}
    </div>
  );
}

/** When new stock can land, in words. */
function etaText(r: StockCheckRow, leadTime: number | undefined) {
  return r.etaOnOrder ? `${fmtDay(r.eta)} · on order` : `~${fmtDay(r.eta)} if ordered today${leadTime ? ` (${leadTime}-day lead time)` : ""}`;
}
const daysLeftText = (r: StockCheckRow) => (Number.isFinite(r.daysLeft) ? `${fmtInt(Math.floor(r.daysLeft))} days` : "No run-out");

const RISK_CHIP: Record<StockCheckRow["risk"], { label: string; cls: string }> = {
  at_risk: { label: "At risk", cls: "bg-st-critical-soft text-st-critical" },
  tight: { label: "Order soon", cls: "bg-st-low-soft text-st-low" },
  overstock: { label: "Overstock · not pushed", cls: "bg-st-over-soft text-st-over" },
  ok: { label: "OK", cls: "bg-st-healthy-soft text-st-healthy" },
};

/** C · days of stock left at the plan's pace and when new stock lands, for every product the plan touches. */
function StockCheck({ rows, cycleLabel, withBudget }: { rows: StockCheckRow[]; cycleLabel: string; withBudget: boolean }) {
  const metrics = useMetrics();
  const lead = new Map(metrics.map((m) => [m.product.id, m.leadTime]));
  const [showAll, setShowAll] = useState(false);
  const flagged = rows.filter((r) => r.risk !== "ok");
  const shown = showAll ? rows : flagged;
  return (
    <Card className="mt-3">
      <CardHeader
        title="C · Stock check for this plan"
        sub={`How many days the stock lasts at your plan’s pace (today’s pace until ${cycleLabel} starts), and when new stock can arrive. “At risk” = it runs out during the plan before new stock can land: ${withBudget ? "an ad on it may sell stock you don’t have" : "the plan counts on stock you don’t have"}.${withBudget ? "" : " Each product moves with its channel’s change in your plan."}`}
      />
      {shown.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-2">Every product in the plan has enough stock for the plan period.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-line scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Stock now</th>
                <th className="num">Expected units</th>
                <th className="num">Days of stock left</th>
                <th>Runs out</th>
                <th>New stock arrives</th>
                {withBudget ? <th className="num">Ad budget (₹)</th> : null}
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.product.id} className={clsx(r.risk === "at_risk" && "bg-st-critical-soft/40")}>
                  <td className="max-w-[240px] truncate font-medium">{r.product.name}</td>
                  <td className="num">{fmtInt(r.stock)}</td>
                  <td className="num">{fmtInt(Math.round(r.planned))}</td>
                  <td className="num font-semibold">{daysLeftText(r)}</td>
                  <td className="whitespace-nowrap">{r.runOut ? fmtDay(r.runOut) : "—"}</td>
                  <td className="whitespace-nowrap text-ink-2">{etaText(r, lead.get(r.product.id))}</td>
                  {withBudget ? <td className="num">{r.budget ? fmtInt(r.budget) : "—"}</td> : null}
                  <td>
                    {r.risk === "tight" && r.etaOnOrder ? (
                      <span className="rounded-full bg-st-healthy-soft px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-st-healthy">Covered by an order</span>
                    ) : (
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", RISK_CHIP[r.risk].cls)}>{RISK_CHIP[r.risk].label}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > flagged.length ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] text-ink-2 hover:text-ink hover:underline">
          {showAll ? "Show only the products to check" : `Show ${rows.length - flagged.length} more products that are fine`}
        </button>
      ) : null}
    </Card>
  );
}

/** The popup before a plan is sent: stock warnings, the MD's approval, then the plan is locked. */
function ConsentDialog({
  withBudget,
  atRisk,
  overstock,
  tight,
  onDropBudgets,
  onCancel,
  onConfirm,
}: {
  withBudget: boolean;
  atRisk: StockCheckRow[];
  overstock: StockCheckRow[];
  tight: StockCheckRow[];
  onDropBudgets: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const metrics = useMetrics();
  const lead = new Map(metrics.map((m) => [m.product.id, m.leadTime]));
  const [risksOk, setRisksOk] = useState(false);
  const [mdOk, setMdOk] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const hasWarnings = atRisk.length + overstock.length > 0;
  const riskBudget = atRisk.reduce((a, r) => a + r.budget, 0);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const ok = mdOk && (risksOk || !hasWarnings);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:items-center" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="w-full max-w-3xl rounded-2xl bg-surface p-5 shadow-2xl">
        <h2 id="consent-title" className="text-[18px] font-bold">
          Check the stock before you submit
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {withBudget ? "Ads should not sell stock we don’t have" : "Targets should not count on stock we don’t have"}, and overstock should not be left unpushed. Check these, then confirm.
        </p>

        <div className="mt-3 max-h-[52vh] space-y-3 overflow-y-auto pr-1 scroll-thin">
          {atRisk.length ? (
            <section className="rounded-xl bg-st-critical-soft p-3">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle size={16} className="text-st-critical" aria-hidden />
                <h3 className="text-[14px] font-semibold text-st-critical">Stock at risk: {atRisk.length} product{atRisk.length === 1 ? "" : "s"} may run out during the plan</h3>
                {withBudget && riskBudget > 0 ? (
                  <button type="button" onClick={onDropBudgets} className="ml-auto rounded-md border border-st-critical/40 bg-surface px-2 py-1 text-[12px] font-medium text-st-critical hover:bg-st-critical-soft">
                    Take the ad budget off these ({fmtMoney(riskBudget)})
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[12.5px] text-ink-2">
                {withBudget ? "Would you still like to continue with the budget allotted to these products?" : "Would you still like to continue with these targets?"} New stock lands after they run out.
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {atRisk.map((r) => (
                  <li key={r.product.id} className="rounded-lg bg-surface px-3 py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <b>{r.product.name}</b>
                      {withBudget ? <span className="tabular">{r.budget ? `ad budget ${fmtMoney(r.budget)}` : "no ad budget"}</span> : <span className="tabular">plan {fmtInt(Math.round(r.planned))} units</span>}
                    </div>
                    <div className="text-[12.5px] text-ink-2">
                      {fmtInt(r.stock)} in stock · lasts {daysLeftText(r)} at your plan (runs out {r.runOut ? fmtDay(r.runOut) : "—"}) · new stock {etaText(r, lead.get(r.product.id))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tight.length ? (
            <section className="rounded-xl bg-st-low-soft p-3">
              <h3 className="text-[14px] font-semibold text-st-low">Order soon: {tight.length} product{tight.length === 1 ? " runs" : "s run"} out during the plan unless new stock is ordered in time</h3>
              <ul className="mt-1 text-[12.5px] text-ink-2">
                {tight.slice(0, 8).map((r) => (
                  <li key={r.product.id}>
                    <b className="text-ink">{r.product.name}</b>: runs out {r.runOut ? fmtDay(r.runOut) : "—"} · new stock {etaText(r, lead.get(r.product.id))}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {overstock.length ? (
            <section className="rounded-xl bg-st-over-soft p-3">
              <h3 className="text-[14px] font-semibold text-st-over">Overstock not pushed: {overstock.length} product{overstock.length === 1 ? "" : "s"}</h3>
              <p className="mt-0.5 text-[12.5px] text-ink-2">These have more stock than the overstock limit and the plan does not raise their sales.</p>
              <ul className="mt-1 text-[12.5px] text-ink-2">
                {overstock.slice(0, 10).map((r) => (
                  <li key={r.product.id}>
                    <b className="text-ink">{r.product.name}</b>: {fmtInt(r.stock)} in stock · lasts {daysLeftText(r)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!hasWarnings && !tight.length ? <p className="rounded-xl bg-st-healthy-soft p-3 text-[13px] text-st-healthy">No stock warnings: every product in the plan has enough stock for the plan period.</p> : null}
        </div>

        <div className="mt-4 space-y-2 border-t border-line pt-3 text-[13px]">
          {hasWarnings ? (
            <label className="flex items-start gap-2">
              <input ref={first} type="checkbox" checked={risksOk} onChange={(e) => setRisksOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-coral)]" />
              <span>I have checked the stock warnings above and want to continue with this plan{withBudget ? " and its ad budgets" : ""}.</span>
            </label>
          ) : null}
          <label className="flex items-start gap-2">
            <input ref={hasWarnings ? undefined : first} type="checkbox" checked={mdOk} onChange={(e) => setMdOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-coral)]" />
            <span>This plan was discussed with and approved by the MD.</span>
          </label>
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Lock size={12} aria-hidden /> After you submit, the plan is locked and can’t be edited. Only Management can reopen it.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>Go back and change</Button>
          <Button variant="primary" icon={<Lock size={14} />} onClick={onConfirm} disabled={!ok} disabledReason={hasWarnings ? "Tick both boxes to confirm" : "Confirm the MD’s approval first"}>
            Submit and lock
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One channel's products: stock now, last 30 days, the system's expectation, the planner's own number and ad budget. */
/** The % steps Marketing can choose for a product's expected units, against System (decided 20 Nov 2026). */
const PCT_STEPS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 75, 100, 150, 200];
const pctLabel = (p: number) => (p === 0 ? "0% (System)" : `${p > 0 ? "+" : ""}${p}%`);

/** The step the current number sits on; a number saved before the dropdown keeps its own % (shown as such). */
function pctValue(n: number, system: number): string {
  if (Number.isNaN(n) || system <= 0) return "0";
  return String(Math.round((n / system - 1) * 100));
}

function pctOptions(n: number, system: number): { value: string; label: string }[] {
  const opts = PCT_STEPS.map((p) => ({ value: String(p), label: pctLabel(p) }));
  const cur = Number(pctValue(n, system));
  if (!PCT_STEPS.includes(cur)) opts.push({ value: String(cur), label: pctLabel(cur) });
  return opts.sort((a, b) => Number(a.value) - Number(b.value));
}

function ProductPlan({
  line,
  days,
  values,
  budgets,
  byId,
  checkById,
  canEdit,
  gapFlagPct,
  onChange,
  onBudget,
  onReset,
}: {
  line: TrendRow;
  days: number;
  values: Record<string, string>;
  budgets: Record<string, string>;
  byId: Map<string, ProductMetrics>;
  checkById: Map<string, StockCheckRow>;
  canEdit: boolean;
  gapFlagPct: number;
  onChange: (productId: string, value: string) => void;
  onBudget: (productId: string, value: string) => void;
  onReset: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = line.products
    .map((x) => ({ ...x, m: byId.get(x.productId), n: toNum(values[x.productId]), bud: toBudget(budgets[x.productId]), chk: checkById.get(x.productId) }))
    .filter((r) => r.m)
    .sort((a, b) => b.systemUnits - a.systemUnits || b.last30 - a.last30 || a.m!.product.name.localeCompare(b.m!.product.name));
  const active = (r: (typeof rows)[number]) => r.systemUnits > 0 || r.last30 > 0 || (r.n > 0 && !Number.isNaN(r.n)) || r.bud > 0;
  const shown = showAll ? rows : rows.filter(active);
  const hidden = rows.length - shown.length;
  const total = rows.reduce((a, r) => a + (Number.isNaN(r.n) ? 0 : r.n), 0);
  const budget = rows.reduce((a, r) => a + (Number.isNaN(r.bud) ? 0 : r.bud), 0);
  const changed = rows.some((r) => r.n !== r.systemUnits);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="font-semibold text-ink">{line.label}: product by product</span>
        <span className="text-ink-2">
          {rows.filter(active).length} products sold here · system {fmtInt(line.systemUnits)} · expected {fmtInt(total)} in {days} days · ad budget ₹{fmtInt(budget)}
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
              <th className="num" style={{ width: 190 }}>
                Expected units
              </th>
              <th className="num">Change</th>
              <th className="num" style={{ width: 120 }}>
                Ad budget (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const m = r.m!;
              const g = Number.isNaN(r.n) || r.systemUnits <= 0 ? null : gapPct(r.n, r.systemUnits);
              const flagged = !Number.isNaN(r.n) && r.systemUnits > 0 && isGapFlagged(r.n, r.systemUnits, gapFlagPct);
              const risky = r.chk?.risk === "at_risk" && ((r.n > 0 && !Number.isNaN(r.n)) || r.bud > 0);
              return (
                <tr key={r.productId} className={clsx(risky && "bg-st-critical-soft/40")}>
                  <td>
                    <div className="max-w-[280px] truncate font-medium">{m.product.name}</div>
                    <div className="text-[11px] text-muted">{m.product.sku}</div>
                    {risky && r.chk ? (
                      <div className="mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-st-critical">
                        <AlertTriangle size={11} aria-hidden /> Stock at risk: runs out {r.chk.runOut ? fmtDay(r.chk.runOut) : "—"}, new stock {r.chk.etaOnOrder ? fmtDay(r.chk.eta) : `~${fmtDay(r.chk.eta)}`}
                        {r.bud > 0 ? ` · ad budget ₹${fmtInt(r.bud)}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="num whitespace-nowrap">
                    <span className="tabular">{fmtInt(m.stock)}</span>{" "}
                    {m.status === "critical" || m.status === "low" || m.status === "overstock" ? <StatusChip status={m.status} size="sm" /> : null}
                  </td>
                  <td className="num text-ink-2">{fmtInt(r.last30)}</td>
                  <td className="num text-ink-2">{fmtInt(r.systemUnits)}</td>
                  <td className="num">
                    {/* Marketing changes the expected units only as a % of System (decided 20 Nov 2026) */}
                    {r.systemUnits > 0 ? (
                      <div className="flex items-center justify-end gap-2">
                        <Select<string>
                          ariaLabel={`Change for ${m.product.name} (${line.label})`}
                          width={96}
                          value={pctValue(r.n, r.systemUnits)}
                          options={pctOptions(r.n, r.systemUnits)}
                          disabled={!canEdit}
                          disabledReason="This plan is locked."
                          onChange={(v) => onChange(r.productId, String(Math.round((r.systemUnits * (100 + Number(v))) / 100)))}
                        />
                        <span className="w-14 text-right tabular font-semibold" aria-label={`Expected units for ${m.product.name} (${line.label})`}>
                          {Number.isNaN(r.n) ? "—" : fmtInt(r.n)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[12px] text-muted" title="No sales here in the last 60 days: there is nothing to scale by %.">
                        {Number.isNaN(r.n) || r.n === 0 ? "—" : fmtInt(r.n)}
                      </span>
                    )}
                  </td>
                  <td className={clsx("num whitespace-nowrap", flagged && "font-semibold text-st-low")}>
                    {r.systemUnits <= 0 ? (!Number.isNaN(r.n) && r.n > 0 ? "new" : "—") : g === null ? "—" : `${fmtPct(g, true)}${flagged ? " ⚑" : ""}`}
                  </td>
                  <td className="num">
                    <input
                      inputMode="numeric"
                      aria-label={`Ad budget for ${m.product.name} (${line.label})`}
                      value={budgets[r.productId] ?? ""}
                      disabled={!canEdit}
                      placeholder={canEdit ? "0" : ""}
                      onChange={(e) => onBudget(r.productId, e.target.value)}
                      className={clsx("h-8 w-full rounded-md border px-2 text-right tabular", risky && r.bud > 0 ? "border-st-critical" : "border-line-strong", !canEdit && "bg-sunken text-ink-2")}
                    />
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

/** The sales plan's Clinics line, clinic by clinic (the former clinic plan). */
function ClinicPlan({
  rows,
  days,
  values,
  canEdit,
  gapFlagPct,
  onChange,
  onReset,
}: {
  rows: { key: string; label: string; last30: number; systemUnits: number }[];
  days: number;
  values: Record<string, string>;
  canEdit: boolean;
  gapFlagPct: number;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
}) {
  const total = rows.reduce((a, r) => a + (Number.isNaN(toNum(values[r.key])) ? 0 : toNum(values[r.key])), 0);
  const system = rows.reduce((a, r) => a + r.systemUnits, 0);
  const changed = rows.some((r) => toNum(values[r.key]) !== r.systemUnits);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="font-semibold text-ink">Clinics: clinic by clinic</span>
        <span className="text-ink-2">
          {rows.length} clinics · system {fmtInt(system)} · expected {fmtInt(total)} in {days} days
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
              <th>Clinic</th>
              <th className="num">Last 30 days (units)</th>
              <th className="num">System</th>
              <th className="num" style={{ width: 120 }}>
                Expected units
              </th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = toNum(values[r.key]);
              const g = Number.isNaN(n) || r.systemUnits <= 0 ? null : gapPct(n, r.systemUnits);
              const flagged = !Number.isNaN(n) && r.systemUnits > 0 && isGapFlagged(n, r.systemUnits, gapFlagPct);
              return (
                <tr key={r.key}>
                  <td className="font-medium">{r.label}</td>
                  <td className="num text-ink-2">{fmtInt(r.last30)}</td>
                  <td className="num text-ink-2">{fmtInt(r.systemUnits)}</td>
                  <td className="num">
                    <input
                      inputMode="numeric"
                      aria-label={`Expected units for ${r.label} (Clinics)`}
                      value={values[r.key] ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => onChange(r.key, e.target.value)}
                      className={clsx("h-8 w-full rounded-md border px-2 text-right tabular", Number.isNaN(n) ? "border-st-critical" : "border-line-strong", !canEdit && "bg-sunken text-ink-2")}
                    />
                  </td>
                  <td className={clsx("num whitespace-nowrap", flagged && "font-semibold text-st-low")}>
                    {r.systemUnits <= 0 ? (!Number.isNaN(n) && n > 0 ? "new" : "—") : g === null ? "—" : `${fmtPct(g, true)}${flagged ? " ⚑" : ""}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Reads the link's cycle and part; a different link (or a new version) starts a fresh draft. */
function PlanFormRoute() {
  const params = useSearchParams();
  const all = useSubmissions();
  const cycleId = params.get("cycle") ?? "";
  const part = (params.get("part") ?? "") as PlanPart;
  const sub = all[`${cycleId}:${part}`];
  const version = sub?.version ?? 0;
  return <PlanForm key={`${cycleId}:${part}:${version}:${sub?.locked ? "l" : "o"}`} cycleId={cycleId} part={part} />;
}

export default function PlanFormPage() {
  return (
    <Suspense fallback={<div className="text-[13px] text-muted">Loading…</div>}>
      <PlanFormRoute />
    </Suspense>
  );
}
