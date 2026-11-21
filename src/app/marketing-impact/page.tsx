"use client";

// Marketing impact (Purchase and Marketing, decided 20–21 Nov 2026): campaigns and festival surges that raise demand. An event
// that is applied to planning adds its extra units to Order now on Auto indent, over the same window Order now uses
// (today to lead time + cover days). The math lives in src/lib/data/campaigns.ts; this page only shows it.

import { Megaphone, PartyPopper, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { MultiSelect, Select } from "@/components/Select";
import { toast } from "@/components/Toast";
import { Button, Card, CardHeader, ChannelDot, channelLabel, Empty, Note, PageHeader, Segmented, StatTile } from "@/components/ui";
import { eventImpact, SCENARIOS, type Campaign, type Festival, type ImpactTotals, type Scenario } from "@/lib/data/campaigns";
import { useDataset, useMetrics, useRole } from "@/lib/data/hooks";
import { computeMetrics } from "@/lib/data/engine";
import { addDays, fmtDay, fmtRange } from "@/lib/dates";
import { SEGMENTS, type ChannelId, type Segment } from "@/lib/domain/types";
import { fmtInt, fmtMoneyShort } from "@/lib/format";
import { usePanel } from "@/lib/state/store";

const SEGMENT_OPTIONS: { value: Segment | "all"; label: string }[] = [{ value: "all", label: "Every segment" }, ...SEGMENTS.map((g) => ({ value: g.id, label: g.label }))];
const segLabel = (s: Segment | "all") => SEGMENT_OPTIONS.find((o) => o.value === s)?.label ?? s;
const newId = (p: string) => `${p}-${Date.now().toString(36)}`;

function NumField({ label, value, onChange, suffix, disabled, max = 100000000 }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; disabled?: boolean; max?: number }) {
  return (
    <label className="block text-[12px] text-ink-2">
      {label}
      <span className="mt-0.5 flex h-8 items-center rounded-md border border-line-strong bg-surface px-2">
        <input
          inputMode="numeric"
          aria-label={label}
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(Math.min(max, Number(e.target.value.replace(/[^0-9]/g, "") || 0)))}
          className="w-full bg-transparent text-right text-[13px] tabular text-ink outline-none"
        />
        {suffix ? <span className="ml-1 text-[12px] text-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  return (
    <label className="block text-[12px] text-ink-2">
      {label}
      <input type="date" aria-label={label} value={value} min={min} onChange={(e) => e.target.value && onChange(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px] text-ink" />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-[12px] text-ink-2">
      {label}
      <input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none" />
    </label>
  );
}

function TotalsLine({ t, budget }: { t: ImpactTotals; budget?: number }) {
  return (
    <span className="tabular">
      +{fmtInt(t.extra)} units · adds {fmtInt(t.addedOrder)} to Order now ({fmtMoneyShort(t.addedOrderCost)} at cost)
      {budget ? ` · ${fmtMoneyShort(t.extraSales)} extra sales on ${fmtMoneyShort(budget)} spend` : ""}
    </span>
  );
}

export default function MarketingImpactPage() {
  const ds = useDataset();
  const metrics = useMetrics();
  const role = useRole();
  const settings = usePanel((s) => s.settings);
  const leadOverrides = usePanel((s) => s.leadOverrides);
  const campaigns = usePanel((s) => s.campaigns);
  const festivals = usePanel((s) => s.festivals);
  const saveCampaign = usePanel((s) => s.saveCampaign);
  const removeCampaign = usePanel((s) => s.removeCampaign);
  const saveFestival = usePanel((s) => s.saveFestival);
  const removeFestival = usePanel((s) => s.removeFestival);
  const canEdit = role.id === "purchase" || role.id === "marketing";
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [fest, setFest] = useState<Festival | null>(null);

  // Order now with every applied event (metrics) against Order now with none, product by product
  const base = useMemo(() => computeMetrics(ds, settings, leadOverrides), [ds, settings, leadOverrides]);
  const added = useMemo(() => {
    const byId = new Map(base.map((m) => [m.product.id, m]));
    let units = 0;
    let cost = 0;
    let products = 0;
    for (const m of metrics) {
      const d = m.indentQty - (byId.get(m.product.id)?.indentQty ?? 0);
      if (d > 0) {
        units += d;
        cost += d * m.product.cost;
        products++;
      }
    }
    return { units, cost, products };
  }, [metrics, base]);

  const applied = campaigns.filter((c) => c.applied).length + festivals.filter((f) => f.applied).length;
  const spend = campaigns.filter((c) => c.applied).reduce((a, c) => a + c.budget, 0);
  const connected = ds.channels.filter((c) => c.connected);

  const blankCampaign = (): Campaign => ({
    id: newId("cmp"),
    name: "",
    from: addDays(ds.today, 7),
    to: addDays(ds.today, 21),
    budget: 0,
    segment: "all",
    productIds: [],
    channels: [],
    clinicIds: [],
    uplift: { conservative: 10, expected: 20, aggressive: 30 },
    scenario: "expected",
    applied: false,
  });
  const blankFestival = (): Festival => ({ id: newId("fst"), name: "", from: addDays(ds.today, 14), to: addDays(ds.today, 20), surgePct: 20, segment: "all", applied: false });

  const preview = useMemo(() => (draft ? SCENARIOS.map((s) => ({ s, r: eventImpact(ds, settings, metrics, { campaign: draft }, s.id) })) : []), [draft, ds, settings, metrics]);
  const draftRows = preview.find((p) => p.s.id === draft?.scenario)?.r.rows ?? [];
  const festPreview = useMemo(() => (fest ? eventImpact(ds, settings, metrics, { festival: fest }) : null), [fest, ds, settings, metrics]);

  const saveDraft = (apply: boolean) => {
    if (!draft) return;
    if (!draft.name.trim()) return toast("Give the campaign a name first");
    if (draft.to < draft.from) return toast("The end date is before the start date");
    saveCampaign({ ...draft, name: draft.name.trim(), applied: apply });
    toast(apply ? `${draft.name.trim()} applied: its extra units are now in Order now` : `${draft.name.trim()} saved as a draft (not in Order now)`);
    setDraft(null);
  };
  const saveFest = (apply: boolean) => {
    if (!fest) return;
    if (!fest.name.trim()) return toast("Give the festival a name first");
    if (fest.to < fest.from) return toast("The end date is before the start date");
    saveFestival({ ...fest, name: fest.name.trim(), applied: apply });
    toast(apply ? `${fest.name.trim()} applied to planning` : `${fest.name.trim()} saved (not in Order now)`);
    setFest(null);
  };

  return (
    <div>
      <PageHeader
        title="Marketing impact"
        sub={`Campaigns and festival surges that raise demand. An event applied to planning adds its extra units to Order now on Auto indent, for the days it falls between today and lead time + ${settings.defaultCoverDays} cover days.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Applied to planning" value={applied} sub={`${campaigns.length} campaigns · ${festivals.length} festivals saved`} />
        <StatTile href="/indent" label="Added to Order now" value={`${fmtInt(added.units)} units`} sub={`${added.products} products`} />
        <StatTile label="Added order value" value={fmtMoneyShort(added.cost)} sub="at cost" />
        <StatTile label="Ad spend applied" value={fmtMoneyShort(spend)} sub="applied campaigns" />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            title="Campaigns"
            sub="Extra units = the product’s usage per day in the targeted channels × the campaign’s days × the uplift %. The uplift is your estimate; ad spend does not turn into units by a formula."
            right={
              <Button icon={<Plus size={14} />} disabled={!canEdit || !!draft} disabledReason={!canEdit ? "Only Purchase and Marketing can add campaigns" : "Finish the campaign you are editing first"} onClick={() => setDraft(blankCampaign())}>
                New campaign
              </Button>
            }
          />
        </div>
        {campaigns.length === 0 && !draft ? (
          <div className="px-4 pb-4">
            <Empty title="No campaigns yet">Add one to see how many extra units it needs and what it adds to Order now.</Empty>
          </div>
        ) : null}
        {campaigns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-y border-line bg-sunken/60 text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-2 py-2 font-medium">Dates</th>
                  <th className="px-2 py-2 font-medium">Products</th>
                  <th className="px-2 py-2 font-medium">Channels</th>
                  <th className="px-2 py-2 text-right font-medium">Budget</th>
                  <th className="px-2 py-2 font-medium">Scenario</th>
                  <th className="px-2 py-2 font-medium">Impact</th>
                  <th className="px-4 py-2 text-right font-medium">Planning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {campaigns.map((c) => {
                  const t = eventImpact(ds, settings, metrics, { campaign: c }).totals;
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fmtRange(c.from, c.to)}</td>
                      <td className="px-2 py-2">{c.productIds.length ? `${c.productIds.length} picked` : segLabel(c.segment)}</td>
                      <td className="px-2 py-2">{c.channels.length ? c.channels.map((ch) => channelLabel(ch, true)).join(", ") : "All"}{c.clinicIds.length ? ` · ${c.clinicIds.length} clinics` : ""}</td>
                      <td className="px-2 py-2 text-right tabular">{fmtMoneyShort(c.budget)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{SCENARIOS.find((s) => s.id === c.scenario)?.label} +{c.uplift[c.scenario]}%</td>
                      <td className="px-2 py-2 text-[12.5px]"><TotalsLine t={t} /></td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <span className={c.applied ? "mr-2 rounded-full bg-confirm-soft px-2 py-0.5 text-[11.5px] font-medium text-confirm" : "mr-2 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] text-muted"}>{c.applied ? "Applied" : "Draft"}</span>
                        {canEdit ? (
                          <>
                            <button className="mr-2 text-[12.5px] text-coral hover:underline" onClick={() => saveCampaign({ ...c, applied: !c.applied })}>{c.applied ? "Take out" : "Apply"}</button>
                            <button className="mr-2 text-[12.5px] text-coral hover:underline" disabled={!!draft} onClick={() => setDraft(c)}>Edit</button>
                            <button className="text-[12.5px] text-muted hover:underline" onClick={() => removeCampaign(c.id)}>Remove</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {draft ? (
          <div className="border-t border-line p-4" role="region" aria-label="Campaign form">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold"><Megaphone size={16} aria-hidden /> {campaigns.some((c) => c.id === draft.id) ? "Edit campaign" : "New campaign"}</div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2"><TextField label="Campaign name" value={draft.name} placeholder="e.g. Winter glow sale" onChange={(v) => setDraft({ ...draft, name: v })} /></div>
              <DateField label="Starts" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
              <DateField label="Ends" value={draft.to} min={draft.from} onChange={(v) => setDraft({ ...draft, to: v })} />
              <NumField label="Ad budget" suffix="₹" value={draft.budget} onChange={(n) => setDraft({ ...draft, budget: n })} />
              <div className="block text-[12px] text-ink-2">
                Segment
                <div className="mt-0.5"><Select<Segment | "all"> label="Segment" value={draft.segment} onChange={(v) => setDraft({ ...draft, segment: v })} options={SEGMENT_OPTIONS} /></div>
              </div>
              <div className="block text-[12px] text-ink-2 md:col-span-2">
                Products (optional: picks these instead of the segment)
                <div className="mt-0.5"><MultiSelect label="Products" values={draft.productIds} onChange={(v) => setDraft({ ...draft, productIds: v })} options={ds.products.map((p) => ({ value: p.id, label: p.name }))} /></div>
              </div>
              <div className="block text-[12px] text-ink-2">
                Channels (none = all)
                <div className="mt-0.5"><MultiSelect<ChannelId> label="Channels" values={draft.channels} onChange={(v) => setDraft({ ...draft, channels: v })} options={connected.map((c) => ({ value: c.id, label: c.label, icon: <ChannelDot channel={c.id} /> }))} /></div>
              </div>
              <div className="block text-[12px] text-ink-2">
                Clinics (none = all)
                <div className="mt-0.5">
                  <MultiSelect label="Clinics" values={draft.clinicIds} onChange={(v) => setDraft({ ...draft, clinicIds: v })} options={ds.clinics.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
                </div>
              </div>
              {SCENARIOS.map((s) => (
                <NumField key={s.id} label={`${s.label} uplift`} suffix="%" max={500} value={draft.uplift[s.id]} onChange={(n) => setDraft({ ...draft, uplift: { ...draft.uplift, [s.id]: n } })} />
              ))}
              <div className="block text-[12px] text-ink-2">
                Plan with
                <div className="mt-0.5"><Segmented<Scenario> label="Scenario" value={draft.scenario} onChange={(v) => setDraft({ ...draft, scenario: v })} options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))} /></div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-muted">
                    <th className="py-1.5 font-medium">Scenario</th>
                    <th className="py-1.5 text-right font-medium">Normal demand</th>
                    <th className="py-1.5 text-right font-medium">Extra units</th>
                    <th className="py-1.5 text-right font-medium">Added to Order now</th>
                    <th className="py-1.5 text-right font-medium">Added order value</th>
                    <th className="py-1.5 text-right font-medium">Extra sales</th>
                    <th className="py-1.5 text-right font-medium">Sales per ₹1 spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.map(({ s, r }) => (
                    <tr key={s.id} className={s.id === draft.scenario ? "bg-coral-soft/50 font-medium" : undefined}>
                      <td className="py-1.5">{s.label} (+{draft.uplift[s.id]}%)</td>
                      <td className="py-1.5 text-right tabular">{fmtInt(r.totals.normal)}</td>
                      <td className="py-1.5 text-right tabular">+{fmtInt(r.totals.extra)}</td>
                      <td className="py-1.5 text-right tabular">{fmtInt(r.totals.addedOrder)}</td>
                      <td className="py-1.5 text-right tabular">{fmtMoneyShort(r.totals.addedOrderCost)}</td>
                      <td className="py-1.5 text-right tabular">{fmtMoneyShort(r.totals.extraSales)}</td>
                      <td className="py-1.5 text-right tabular">{draft.budget ? `₹${(r.totals.extraSales / draft.budget).toFixed(1)}` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11.5px] text-muted">
                Normal demand and extra units cover the campaign’s own days ({fmtRange(draft.from, draft.to)}). “Added to Order now” counts only the days inside each product’s order window, and may be 0 when the stock left is still above {settings.reorderAtDays} days of sales.
              </p>
            </div>

            {draftRows.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12.5px] font-medium text-coral">Product by product ({draftRows.length})</summary>
                <table className="mt-2 w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-muted">
                      <th className="py-1 font-medium">Product</th>
                      <th className="py-1 text-right font-medium">Normal</th>
                      <th className="py-1 text-right font-medium">Extra</th>
                      <th className="py-1 text-right font-medium">New demand</th>
                      <th className="py-1 text-right font-medium">Order now: without → with</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...draftRows].sort((a, b) => b.extra - a.extra).map((r) => (
                      <tr key={r.product.id}>
                        <td className="py-1">{r.product.name}</td>
                        <td className="py-1 text-right tabular">{fmtInt(r.normal)}</td>
                        <td className="py-1 text-right tabular">+{fmtInt(r.extra)}</td>
                        <td className="py-1 text-right tabular">{fmtInt(r.normal + r.extra)}</td>
                        <td className="py-1 text-right tabular">{fmtInt(r.orderWithout)} → {fmtInt(r.orderWith)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : (
              <p className="mt-3 text-[12.5px] text-muted">No product matches this segment or pick.</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => saveDraft(true)}>Save and apply to planning</Button>
              <Button onClick={() => saveDraft(false)}>Save as draft</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            title="Festival calendar"
            sub="A festival raises the demand of every channel by its surge %, for its days. Applied festivals are added to Order now like campaigns."
            right={
              <Button icon={<Plus size={14} />} disabled={!canEdit || !!fest} disabledReason={!canEdit ? "Only Purchase and Marketing can add festivals" : "Finish the festival you are editing first"} onClick={() => setFest(blankFestival())}>
                Add festival
              </Button>
            }
          />
        </div>
        {festivals.length === 0 && !fest ? (
          <div className="px-4 pb-4">
            <Empty title="No festivals yet">Add the festivals that lift your sales (for example Lohri or Diwali) with the dates and surge you expect.</Empty>
          </div>
        ) : null}
        {festivals.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sunken/60 text-left text-[12px] text-muted">
                <th className="px-4 py-2 font-medium">Festival</th>
                <th className="px-2 py-2 font-medium">Dates</th>
                <th className="px-2 py-2 font-medium">Products</th>
                <th className="px-2 py-2 text-right font-medium">Surge</th>
                <th className="px-2 py-2 font-medium">Impact</th>
                <th className="px-4 py-2 text-right font-medium">Planning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...festivals].sort((a, b) => a.from.localeCompare(b.from)).map((f) => {
                const t = eventImpact(ds, settings, metrics, { festival: f }).totals;
                return (
                  <tr key={f.id}>
                    <td className="px-4 py-2 font-medium">{f.name}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{fmtRange(f.from, f.to)}{f.to < ds.today ? <span className="ml-1 text-[11.5px] text-muted">(over)</span> : null}</td>
                    <td className="px-2 py-2">{segLabel(f.segment)}</td>
                    <td className="px-2 py-2 text-right tabular">+{f.surgePct}%</td>
                    <td className="px-2 py-2 text-[12.5px]"><TotalsLine t={t} /></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <span className={f.applied ? "mr-2 rounded-full bg-confirm-soft px-2 py-0.5 text-[11.5px] font-medium text-confirm" : "mr-2 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] text-muted"}>{f.applied ? "Applied" : "Draft"}</span>
                      {canEdit ? (
                        <>
                          <button className="mr-2 text-[12.5px] text-coral hover:underline" onClick={() => saveFestival({ ...f, applied: !f.applied })}>{f.applied ? "Take out" : "Apply"}</button>
                          <button className="mr-2 text-[12.5px] text-coral hover:underline" disabled={!!fest} onClick={() => setFest(f)}>Edit</button>
                          <button className="text-[12.5px] text-muted hover:underline" onClick={() => removeFestival(f.id)}>Remove</button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {fest ? (
          <div className="border-t border-line p-4" role="region" aria-label="Festival form">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold"><PartyPopper size={16} aria-hidden /> {festivals.some((f) => f.id === fest.id) ? "Edit festival" : "Add festival"}</div>
            <div className="grid gap-3 md:grid-cols-5">
              <div className="md:col-span-2"><TextField label="Festival name" value={fest.name} placeholder="e.g. Lohri" onChange={(v) => setFest({ ...fest, name: v })} /></div>
              <DateField label="Starts" value={fest.from} onChange={(v) => setFest({ ...fest, from: v })} />
              <DateField label="Ends" value={fest.to} min={fest.from} onChange={(v) => setFest({ ...fest, to: v })} />
              <NumField label="Sales surge" suffix="%" max={500} value={fest.surgePct} onChange={(n) => setFest({ ...fest, surgePct: n })} />
              <div className="block text-[12px] text-ink-2">
                Segment
                <div className="mt-0.5"><Select<Segment | "all"> label="Festival segment" value={fest.segment} onChange={(v) => setFest({ ...fest, segment: v })} options={SEGMENT_OPTIONS} /></div>
              </div>
            </div>
            {festPreview ? <p className="mt-3 text-[12.5px]"><TotalsLine t={festPreview.totals} /></p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => saveFest(true)}>Save and apply to planning</Button>
              <Button onClick={() => saveFest(false)}>Save as draft</Button>
              <Button variant="ghost" onClick={() => setFest(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="mt-3">
        <Note>
          Saved in this browser for now, like the other panel settings. Order now on Auto indent shows the applied events’ units to everyone who opens it, so Management approves the same number you see here. Today is {fmtDay(ds.today)}.
        </Note>
      </div>
    </div>
  );
}
