"use client";

import clsx from "clsx";
import { RotateCcw, Save } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Select } from "@/components/Select";
import { toast } from "@/components/Toast";
import { Button, Card, CardHeader, Note, PageHeader, Segmented } from "@/components/ui";
import { useDataset, useRole } from "@/lib/data/hooks";
import { COVER_OPTIONS, type FormulaSettings } from "@/lib/domain/types";
import { usePanel, type Recipients, type Schedule } from "@/lib/state/store";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A labelled setting. `group` = the control is a set of buttons (a <label> would rename every button inside it). */
function Field({ label, help, children, group }: { label: string; help?: string; children: ReactNode; group?: boolean }) {
  const body = (
    <>
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      <div className="mt-1">{children}</div>
      {help ? <span className="mt-0.5 block text-[11.5px] text-muted">{help}</span> : null}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="block">
      {body}
    </div>
  ) : (
    <label className="block">{body}</label>
  );
}

/** Number box: free typing; a value outside min–max is corrected only when you leave the box. */
function NumInput({ value, onChange, disabled, suffix, min = 0, max = 999 }: { value: number; onChange: (n: number) => void; disabled?: boolean; suffix?: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const outOfRange = draft !== null && draft !== "" && (Number(draft) < min || Number(draft) > max);
  return (
    <div className={clsx("flex h-8 w-full max-w-[140px] items-center rounded-md border px-2", outOfRange ? "border-st-critical" : "border-line-strong", disabled && "bg-sunken")}>
      <input
        inputMode="numeric"
        value={draft ?? String(value)}
        disabled={disabled}
        title={`${min}–${max}`}
        onChange={(e) => {
          const d = e.target.value.replace(/[^0-9]/g, "");
          setDraft(d);
          if (d !== "" && Number(d) >= min && Number(d) <= max) onChange(Number(d));
        }}
        onBlur={() => {
          if (draft === null) return;
          onChange(draft === "" ? min : Math.max(min, Math.min(max, Number(draft))));
          setDraft(null);
        }}
        className="w-full bg-transparent text-right tabular outline-none"
      />
      {suffix ? <span className="ml-1 text-[12px] text-muted">{suffix}</span> : null}
    </div>
  );
}

function TextInput({ value, onChange, disabled, type = "text" }: { value: string; onChange: (s: string) => void; disabled?: boolean; type?: string }) {
  return <input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={clsx("h-8 w-full rounded-md border border-line-strong px-2", disabled && "bg-sunken text-ink-2")} />;
}

export default function SettingsPage() {
  const ds = useDataset();
  const role = useRole();
  const store = usePanel();
  const [f, setF] = useState<FormulaSettings>(store.settings);
  const [r, setR] = useState<Recipients>(store.recipients);
  const [s, setS] = useState<Schedule>(store.schedule);
  const ro = role.access !== "admin";
  const windowOk = f.rateWindowDays >= 7 && f.rateWindowDays <= 180;
  const dirty = JSON.stringify(f) !== JSON.stringify(store.settings) || JSON.stringify(r) !== JSON.stringify(store.recipients) || JSON.stringify(s) !== JSON.stringify(store.schedule);

  const save = () => {
    if (!windowOk) return;
    store.saveSettings(f);
    store.saveRecipients(r);
    store.saveSchedule(s);
    toast("Settings saved in this browser only, and every page here now uses them. Saving them for everyone comes with personal logins.");
  };
  const reset = () => {
    store.resetSettings();
    setF(usePanel.getState().settings);
    setR(usePanel.getState().recipients);
    setS(usePanel.getState().schedule);
    toast("Settings reset to the decided defaults.");
  };

  const set = <K extends keyof FormulaSettings>(k: K, v: FormulaSettings[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        sub="Every threshold is a setting, never fixed in code. Defaults are the decided values from “Rules & Formulas”."
        right={
          <>
            <Button icon={<RotateCcw size={14} />} onClick={reset} disabled={ro} disabledReason="Only Management can change settings">
              Reset to defaults
            </Button>
            <Button variant="primary" icon={<Save size={14} />} onClick={save} disabled={ro || !windowOk || !dirty} disabledReason={ro ? "Only Management can change settings" : !windowOk ? "Choose a sales window between 7 and 180 days" : "Nothing changed yet"}>
              Save changes
            </Button>
          </>
        }
      />
      {ro ? (
        <div className="mb-3">
          <Note tone="warn">Read only: {role.person} can see the settings; only Management can change them.</Note>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Daily sales rate" sub="Per day = sales of the last N days added up ÷ N. The window rolls forward every day; days with no sales count too." />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Sales window">
            <NumInput value={f.rateWindowDays} onChange={(n) => set("rateWindowDays", n)} disabled={ro} suffix="days" max={180} />
          </Field>
          <div className={clsx("self-end rounded-lg px-3 py-2 text-[12.5px] font-semibold sm:col-span-3", windowOk ? "bg-st-healthy-soft text-st-healthy" : "bg-st-critical-soft text-st-critical")}>
            {windowOk ? `Per day = last ${f.rateWindowDays} days' sales ÷ ${f.rateWindowDays} ✓` : "Choose between 7 and 180 days"}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field group label="Trend factor" help="Multiplies projections by last 30 days ÷ the 30 days before">
            <Segmented value={f.useTrendFactor ? "on" : "off"} onChange={(v) => set("useTrendFactor", v === "on")} disabled={ro} disabledReason="Only Management can change settings" label="Trend factor" options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
          </Field>
          <Field label="Trend factor cap" help="Largest change it may apply, up or down">
            <NumInput value={f.trendCapPct} onChange={(n) => set("trendCapPct", n)} disabled={ro || !f.useTrendFactor} suffix="±%" max={100} />
          </Field>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHeader title="Stock status and ordering" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Order when stock falls to" help="Reorder point: days of sales left (or the lead time, when longer)">
            <NumInput value={f.reorderAtDays} onChange={(n) => set("reorderAtDays", n)} disabled={ro} suffix="days" min={1} max={180} />
          </Field>
          <Field label="Clinic top-up safety days" help="Extra days of a clinic’s own usage kept when Mohali tops it up">
            <NumInput value={f.safetyDays} onChange={(n) => set("safetyDays", n)} disabled={ro} suffix="days" max={90} />
          </Field>
          <Field label="Overstock limit" help="More days of cover than this = Overstock">
            <NumInput value={f.overstockDays} onChange={(n) => set("overstockDays", n)} disabled={ro} suffix="days" min={15} max={365} />
          </Field>
          <Field group label="Default cover for auto indent" help="How long an order should last after it arrives">
            <Segmented<number> value={f.defaultCoverDays} onChange={(v) => set("defaultCoverDays", v)} disabled={ro} disabledReason="Only Management can change settings" label="Default cover" options={COVER_OPTIONS.map((c) => ({ value: c, label: `${c}d` }))} />
          </Field>
          <Field label="Plan gap flag" help="Team plan vs system projection difference that gets flagged">
            <NumInput value={f.gapFlagPct} onChange={(n) => set("gapFlagPct", n)} disabled={ro} suffix="±%" max={100} />
          </Field>
          <Field label="Clinic transfer: sender has more than" help="Days of cover at the clinic that can give">
            <NumInput value={f.transferHighDays} onChange={(n) => set("transferHighDays", n)} disabled={ro} suffix="days" max={365} />
          </Field>
          <Field label="Clinic transfer: receiver has less than" help="Days of cover at the clinic that needs stock">
            <NumInput value={f.transferLowDays} onChange={(n) => set("transferLowDays", n)} disabled={ro} suffix="days" max={60} />
          </Field>
          <Field label="Send to clinics: days to arrive" help="Mohali → clinic delivery time">
            <NumInput value={f.replenishLeadDays} onChange={(n) => set("replenishLeadDays", n)} disabled={ro} suffix="days" min={1} max={30} />
          </Field>
          <Field label="Send to clinics: days each send covers" help="Of the clinic’s own usage">
            <NumInput value={f.replenishCoverDays} onChange={(n) => set("replenishCoverDays", n)} disabled={ro} suffix="days" min={1} max={90} />
          </Field>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHeader title="Lead time by vendor" sub="Days from placing an order to stock arriving. A product can override its vendor’s lead time from its detail panel. Saves straight away." />
        <div className="divide-y divide-line">
          {ds.vendors.map((v) => {
            const cur = store.leadOverrides[`vendor:${v.id}`];
            return (
              <div key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                <span className="min-w-[240px] flex-1 font-medium">{v.name}</span>
                <span className="text-[12px] text-muted">Zoho default {v.leadTimeDays} days</span>
                <Select<string>
                  value={String(cur ?? "default")}
                  width={190}
                  disabled={ro}
                  disabledReason="Only Management can change lead times"
                  onChange={(val) => {
                    store.setLeadOverride(`vendor:${v.id}`, val === "default" ? null : Number(val));
                    toast(`Lead time for ${v.name.split(" · ")[0]} saved in this browser.`);
                  }}
                  options={[{ value: "default", label: `Use default (${v.leadTimeDays} days)` }, ...[7, 10, 15, 21, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `${d} days` }))]}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-3">
        <CardHeader title="Who receives what" sub="All automatic emails go to, or copy, Management. Stock alerts also copy Purchase and the Supply chain head." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Management email">
            <TextInput type="email" value={r.management} onChange={(v) => setR({ ...r, management: v })} disabled={ro} />
          </Field>
          <Field label="Management WhatsApp number" help="Stock alerts and critical alerts">
            <TextInput value={r.managementWhatsapp} onChange={(v) => setR({ ...r, managementWhatsapp: v })} disabled={ro} />
          </Field>
          <Field label="Marketing email">
            <TextInput type="email" value={r.marketing} onChange={(v) => setR({ ...r, marketing: v })} disabled={ro} />
          </Field>
          <Field label="Sales head email">
            <TextInput type="email" value={r.sales} onChange={(v) => setR({ ...r, sales: v })} disabled={ro} />
          </Field>
          <Field label="Purchase email">
            <TextInput type="email" value={r.purchase} onChange={(v) => setR({ ...r, purchase: v })} disabled={ro} />
          </Field>
          <Field label="Supply chain head email">
            <TextInput type="email" value={r.supply} onChange={(v) => setR({ ...r, supply: v })} disabled={ro} />
          </Field>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">Placeholder addresses. Put the real ones in before go-live.</p>
      </Card>

      <Card className="mt-3">
        <CardHeader title="Schedule" />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Daily stock alert at">
            <TextInput type="time" value={s.dailyAlertTime} onChange={(v) => setS({ ...s, dailyAlertTime: v })} disabled={ro} />
          </Field>
          <Field label="Plan requests at">
            <TextInput type="time" value={s.requestTime} onChange={(v) => setS({ ...s, requestTime: v })} disabled={ro} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Monthly request (day of month)">
            <NumInput value={s.monthlyRequestDay} onChange={(n) => setS({ ...s, monthlyRequestDay: n })} disabled={ro} min={1} max={28} />
          </Field>
          <Field label="Monthly deadline">
            <NumInput value={s.monthlyDueDay} onChange={(n) => setS({ ...s, monthlyDueDay: n })} disabled={ro} min={1} max={28} />
          </Field>
          <Field label="Monthly consolidated report">
            <NumInput value={s.monthlyReportDay} onChange={(n) => setS({ ...s, monthlyReportDay: n })} disabled={ro} min={1} max={28} />
          </Field>
          {(["weeklyRequestDay", "weeklyDueDay", "weeklyReportDay"] as const).map((k) => (
            <Field group key={k} label={k === "weeklyRequestDay" ? "Weekly request" : k === "weeklyDueDay" ? "Weekly deadline" : "Weekly consolidated report"}>
              <Select<string> value={s[k]} onChange={(v) => setS({ ...s, [k]: v })} disabled={ro} disabledReason="Only Management can change the schedule" width={180} options={WEEKDAYS.map((d) => ({ value: d, label: d }))} />
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}
