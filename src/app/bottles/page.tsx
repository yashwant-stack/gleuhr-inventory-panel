"use client";

// Bottles and packaging (decided 20 Nov 2026): Zoho items whose Stock field is "Bottle Count", kept only at the
// Mohali warehouse. How long each lasts comes from src/lib/data/bottles.ts; this page only shows it.

import { useMemo } from "react";
import { Card, CardHeader, Note, PageHeader, StatTile } from "@/components/ui";
import { BOTTLE_HISTORY_DAYS, bottleRows } from "@/lib/data/bottles";
import { useDataset, useMetrics } from "@/lib/data/hooks";
import { fmtDay } from "@/lib/dates";
import { DEFAULT_LEAD_DAYS } from "@/lib/domain/types";
import { fmtDays, fmtInt, fmtRate } from "@/lib/format";
import { usePanel } from "@/lib/state/store";

export default function BottlesPage() {
  const ds = useDataset();
  const metrics = useMetrics();
  const openProduct = usePanel((s) => s.openProduct);
  const bottles = ds.bottles;
  const rows = useMemo(() => (bottles ? bottleRows(bottles, metrics, ds.today, DEFAULT_LEAD_DAYS) : []), [bottles, metrics, ds.today]);

  if (!bottles) {
    return (
      <div>
        <PageHeader title="Bottles" sub="Bottles and packaging at the Mohali warehouse, from Zoho." />
        <Note>Bottle counts are read from Zoho by the next sync (Zoho items whose Stock field is “Bottle Count”). They show here after it.</Note>
      </div>
    );
  }

  const total = bottles.reduce((a, b) => a + Math.max(0, b.qty ?? 0), 0);
  const atRisk = rows.filter((r) => r.atRisk);
  const unpaced = rows.filter((r) => r.perDay === null);
  const fromCounts = rows.filter((r) => r.source === "zoho_counts").length;
  const elsewhere = bottles.filter((b) => b.elsewhere > 0);

  return (
    <div>
      <PageHeader
        title="Bottles"
        sub={`Bottles, caps, pumps and lids: Zoho items whose Stock field is “Bottle Count”. They are kept only at the Mohali warehouse. How long each lasts: from Zoho’s own daily counts once there are ${BOTTLE_HISTORY_DAYS} days of them, until then from the sales of the product the bottle is for (one per unit sold).`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Bottle pieces at Mohali" value={fmtInt(total)} sub={`${bottles.length} bottle items in Zoho`} />
        <StatTile tone={atRisk.length ? "critical" : undefined} label="Run out within the lead time" value={atRisk.length} sub={`under ${DEFAULT_LEAD_DAYS} days left`} />
        <StatTile label="Paced from Zoho counts" value={fromCounts} sub={`after ${BOTTLE_HISTORY_DAYS} days of daily counts`} />
        <StatTile label="Not linked to a product" value={unpaced.length} sub="no pace yet: see the list" />
      </div>

      {elsewhere.length ? (
        <div className="mt-3">
          <Note tone="warn">
            Zoho shows bottles outside Mohali: {elsewhere.map((b) => `${b.name} (${fmtInt(b.elsewhere)})`).join(", ")}. Bottles should be only at the Mohali warehouse.
          </Note>
        </div>
      ) : null}

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader
            className="mb-0"
            title="Bottle count and how long it lasts"
            sub="Most urgent first. Value is not shown: Zoho has no real purchase price for bottles (₹10 placeholders)."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>Bottle item</th>
                <th className="num">At Mohali</th>
                <th>Used for</th>
                <th className="num">Used per day</th>
                <th className="num">Days left</th>
                <th>Runs out</th>
                <th className="num">Need 30 days</th>
                <th className="num">Need 90 days</th>
                <th className="num">Short for 90 days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bottle.id}>
                  <td>
                    <div className="font-medium">{r.bottle.name}</div>
                    <div className="text-[11.5px] text-muted">
                      {r.bottle.sku}
                      {r.bottle.unit ? ` · ${r.bottle.unit}` : ""}
                    </div>
                  </td>
                  <td className="num">{r.bottle.qty === null ? "—" : fmtInt(r.bottle.qty)}</td>
                  <td className="max-w-[300px] text-[12.5px]">
                    {r.link.products.length ? (
                      r.link.products.map((m, i) => (
                        <span key={m.product.id}>
                          {i ? ", " : ""}
                          <button className="text-coral hover:underline" onClick={() => openProduct(m.product.id)}>
                            {m.product.name}
                          </button>
                        </span>
                      ))
                    ) : r.link.problem?.kind === "ambiguous" ? (
                      <span className="text-muted">Not linked: “{r.link.problem.phrase}” fits {r.link.problem.candidates.join(" and ")}</span>
                    ) : (
                      <span className="text-muted">Not linked: the name names no product</span>
                    )}
                    {r.source === "zoho_counts" ? <div className="text-[11.5px] text-muted">pace from Zoho’s daily counts</div> : null}
                  </td>
                  <td className="num">{r.perDay === null ? "—" : fmtRate(r.perDay)}</td>
                  <td className={r.atRisk ? "num font-semibold text-st-critical" : "num"}>{r.daysLeft === null ? "—" : fmtDays(r.daysLeft)}</td>
                  <td className="whitespace-nowrap">{r.runOut ? fmtDay(r.runOut) : "—"}</td>
                  <td className="num">{r.need30 === null ? "—" : fmtInt(r.need30)}</td>
                  <td className="num">{r.need90 === null ? "—" : fmtInt(r.need90)}</td>
                  <td className={r.short90 ? "num font-semibold text-st-critical" : "num"}>{r.short90 === null ? "—" : r.short90 ? fmtInt(r.short90) : "Enough"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-[12px] text-muted">
        A bottle is linked to a product only when its Zoho name names exactly one product (packaging words such as bottle, cap, pump, dropper and sizes are ignored). A name that fits
        several products, or none, is not guessed. Those get their pace from Zoho’s daily counts once {BOTTLE_HISTORY_DAYS} days of counts exist.
      </p>
    </div>
  );
}
