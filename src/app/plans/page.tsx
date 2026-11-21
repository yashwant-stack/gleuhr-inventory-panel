"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SubmissionChip } from "@/components/plan-ui";
import { Card, CardHeader, Delta, Note, PageHeader } from "@/components/ui";
import { cycleSubmissions, useDataset, useRole, useSubmissions } from "@/lib/data/hooks";
import { actualsForPeriod, canStillSubmit, cycleState, periodDays, submissionStatus } from "@/lib/data/plans";
import { fmtDay, fmtRange } from "@/lib/dates";
import { gapPct } from "@/lib/domain/formulas";
import { fmtInt, fmtPct, ordinal } from "@/lib/format";
import { CYCLES } from "@/lib/mock/plans";
import { PLAN_PARTS, roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

const IST_TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default function PlansPage() {
  const ds = useDataset();
  const role = useRole();
  const all = useSubmissions();
  const schedule = usePanel((s) => s.schedule);
  const gapFlag = usePanel((s) => s.settings.gapFlagPct);
  const ordered = useMemo(() => [...CYCLES].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom)), []);
  const defaultCycle = CYCLES.find((c) => cycleState(c, ds.today) === "open") ?? ordered[0]!;
  const [cycleId, setCycleId] = useState(defaultCycle.id);
  const cycle = CYCLES.find((c) => c.id === cycleId)!;
  const subs = cycleSubmissions(all, cycle.id);
  const state = cycleState(cycle, ds.today);

  const myOpen = role.planPart ? CYCLES.filter((c) => cycleState(c, ds.today) !== "closed" || canStillSubmit(c, ds.today)) : [];

  return (
    <div>
      <PageHeader
        title="Plans"
        sub={`Monthly: request on the ${ordinal(schedule.monthlyRequestDay)}, due the ${ordinal(schedule.monthlyDueDay)}, consolidated report on the ${ordinal(schedule.monthlyReportDay)}. Weekly: request ${schedule.weeklyRequestDay}, due ${schedule.weeklyDueDay}, report ${schedule.weeklyReportDay}. Every email copies Management.`}
      />

      {role.planPart ? (
        <Card className="mb-3 border-coral/40 bg-coral-soft/40">
          <CardHeader title={`Your plans, ${role.person}`} sub={PLAN_PARTS.find((p) => p.id === role.planPart)?.description} />
          <div className="flex flex-wrap gap-2">
            {myOpen.map((c) => {
              const st = submissionStatus(c, all[`${c.id}:${role.planPart}`], ds.today);
              return (
                <Link key={c.id} href={`/plans/form?cycle=${c.id}&part=${role.planPart}`} className="rounded-lg border border-line bg-surface px-3 py-2 hover:shadow-sm">
                  <div className="text-[13px] font-semibold">{c.label}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-2">
                    due {fmtDay(c.dueOn)} <SubmissionChip status={st} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ordered.map((c) => {
          const st = cycleState(c, ds.today);
          const cs = cycleSubmissions(all, c.id);
          const done = PLAN_PARTS.filter((p) => cs[p.id]).length;
          return (
            <button
              key={c.id}
              onClick={() => setCycleId(c.id)}
              aria-pressed={c.id === cycleId}
              className={clsx("rounded-xl border bg-surface p-3.5 text-left transition", c.id === cycleId ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line hover:shadow-sm")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{c.kind}</span>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                    st === "open" ? "bg-st-low-soft text-st-low" : st === "upcoming" ? "bg-sunken text-ink-2" : "bg-st-healthy-soft text-st-healthy",
                  )}
                >
                  {st === "open" ? (c.dueOn === ds.today ? "Open · due today" : `Open · due ${fmtDay(c.dueOn)}`) : st === "upcoming" ? `Opens ${fmtDay(c.requestOn)}` : "Closed"}
                </span>
              </div>
              <div className="mt-1 text-[15px] font-bold">{c.label}</div>
              <div className="text-[12px] text-ink-2">Plan for {fmtRange(c.periodFrom, c.periodTo)} · {periodDays(c)} days</div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex gap-1">
                  {PLAN_PARTS.map((p) => (
                    <span key={p.id} title={p.label} className={clsx("h-1.5 w-6 rounded-full", cs[p.id] ? "bg-confirm" : "bg-line-strong")} />
                  ))}
                </div>
                <span className="text-[12px] text-ink-2">
                  {done} of {PLAN_PARTS.length} in
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            className="mb-0"
            title={`${cycle.label} · who has submitted`}
            sub={`Request ${fmtDay(cycle.requestOn)} · deadline ${fmtDay(cycle.dueOn)} · consolidated report to Management ${fmtDay(cycle.reportOn)}`}
          />
        </div>
        {state === "upcoming" ? (
          <div className="px-4 pb-3">
            <Note>
              The request email with each person’s upload link goes out on {fmtDay(cycle.requestOn)} at {schedule.requestTime}. You can preview the form now; submitting opens on that day.
            </Note>
          </div>
        ) : null}
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Plan part</th>
                <th>Filled by</th>
                <th>Status</th>
                <th>Submitted</th>
                <th className="num">Planned units</th>
                <th className="num">System projection</th>
                <th className="num">Gap</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {PLAN_PARTS.map((p) => {
                const s = subs[p.id];
                const st = submissionStatus(cycle, s, ds.today);
                const planned = s?.lines.reduce((a, l) => a + l.plannedUnits, 0) ?? null;
                const system = s?.lines.reduce((a, l) => a + l.systemUnits, 0) ?? null;
                const g = planned !== null && system ? gapPct(planned, system) : null;
                const mine = role.planPart === p.id;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-[11.5px] text-muted">{p.description}</div>
                    </td>
                    <td className="whitespace-nowrap">{roleById(p.owner).person}</td>
                    <td>
                      <SubmissionChip status={st} />
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{s ? `${IST_TIME.format(new Date(s.submittedAt))}${s.version > 1 ? ` · v${s.version}` : ""}${s.locked ? " · locked" : ""}` : "—"}</td>
                    <td className="num">{planned !== null ? fmtInt(planned) : "—"}</td>
                    <td className="num">{system !== null ? fmtInt(system) : "—"}</td>
                    <td className="num">{g !== null ? <span className={Math.abs(g) > gapFlag ? "font-semibold text-st-low" : ""}>{fmtPct(g, true)}</span> : "—"}</td>
                    <td className="text-right">
                      <Link href={`/plans/form?cycle=${cycle.id}&part=${p.id}`} className={clsx("rounded-lg px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap", mine && canStillSubmit(cycle, ds.today) ? "bg-coral text-white" : "border border-line-strong hover:bg-sunken")}>
                        {mine && canStillSubmit(cycle, ds.today) ? (s ? (s.locked ? "View (locked)" : "Edit my plan") : "Fill my plan") : s ? "View" : "Preview form"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PlanVsActual cycleId={cycle.id} />
    </div>
  );
}

function PlanVsActual({ cycleId }: { cycleId: string }) {
  const ds = useDataset();
  const all = useSubmissions();
  const cycle = CYCLES.find((c) => c.id === cycleId)!;
  const sales = all[`${cycle.id}:sales`];
  const { byKey, elapsedDays } = useMemo(() => actualsForPeriod(ds, "sales", cycle), [ds, cycle]);
  if (elapsedDays === 0 || !sales) return null;
  const total = periodDays(cycle);
  const share = elapsedDays / total;
  return (
    <Card className="mt-3" pad={false}>
      <div className="p-4 pb-2">
        <CardHeader
          className="mb-0"
          title="Plan vs actual"
          sub={`${elapsedDays} of ${total} days done · the sales plan and the system projection are pro-rated to the days done`}
        />
      </div>
      <div className="overflow-x-auto scroll-thin">
      <table className="dtable">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Sales plan (so far)</th>
            <th className="num">System said (so far)</th>
            <th className="num">Actual</th>
            <th className="num">vs plan</th>
            <th style={{ minWidth: 160 }}>Achieved</th>
          </tr>
        </thead>
        <tbody>
          {sales.lines.map((l) => {
            const plan = l.plannedUnits * share;
            const sys = l.systemUnits * share;
            const act = byKey[l.key] ?? 0;
            const pct = plan > 0 ? (act / plan) * 100 : 0;
            return (
              <tr key={l.key}>
                <td className="font-medium">{l.label}</td>
                <td className="num">{fmtInt(plan)}</td>
                <td className="num">{fmtInt(sys)}</td>
                <td className="num font-semibold">{fmtInt(act)}</td>
                <td className="num">
                  <Delta pct={plan > 0 ? pct - 100 : null} />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-sunken">
                      <div className={clsx("h-2 rounded-full", pct >= 100 ? "bg-confirm" : pct >= 85 ? "bg-st-low" : "bg-st-critical")} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="w-10 text-right text-[12px] tabular">{Math.round(pct)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </Card>
  );
}
