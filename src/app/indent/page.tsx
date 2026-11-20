"use client";

import clsx from "clsx";
import { Check, Download, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { toast } from "@/components/Toast";
import { Button, Card, Empty, Note, PageHeader, Segmented, StatTile, StatusChip, Tabs } from "@/components/ui";
import { productMatches, type ProductMetrics } from "@/lib/data/engine";
import { useDataset, useFilters, useMetrics, useRole } from "@/lib/data/hooks";
import { downloadCsv } from "@/lib/csv";
import { IS_PREVIEW, PREVIEW_NO_DOWNLOAD } from "@/lib/platform";
import { addDays, fmtDay } from "@/lib/dates";
import { daysUntilOrder, daysWithNoStock, indentQuantity, reorderPoint, stockStatus } from "@/lib/domain/formulas";
import { COVER_OPTIONS, LEAD_TIME_OPTIONS } from "@/lib/domain/types";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtRate } from "@/lib/format";
import { roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

type LeadMode = "own" | number;
/** A fixed choice (7/15/30/60/90 days), or "custom": any number of days typed in. */
type DaysChoice = number | "custom";

const MAX_DAYS = 365;
const validDays = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : null;
};

/** The fixed day buttons plus "Custom", which opens a box for any number of days (1–365). */
function DaysPicker<T extends string>({
  label,
  options,
  extra,
  value,
  onChange,
  custom,
  onCustom,
}: {
  label: string;
  options: readonly number[];
  /** Choices shown before the day buttons (e.g. "Each product’s own"). */
  extra?: { value: T; label: string }[];
  value: T | DaysChoice;
  onChange: (v: T | DaysChoice) => void;
  custom: string;
  onCustom: (v: string) => void;
}) {
  const bad = value === "custom" && validDays(custom) === null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<T | DaysChoice>
        value={value}
        onChange={onChange}
        label={label}
        options={[...(extra ?? []), ...options.map((d) => ({ value: d as T | DaysChoice, label: `${d} days` })), { value: "custom" as T | DaysChoice, label: "Custom" }]}
      />
      {value === "custom" ? (
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input
            inputMode="numeric"
            autoFocus
            aria-label={`${label}: custom number of days`}
            value={custom}
            onChange={(e) => onCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            className={clsx("h-8 w-16 rounded-md border px-2 text-right tabular text-ink", bad ? "border-st-critical" : "border-line-strong")}
          />
          days
          {bad ? <span className="text-st-critical">1 to {MAX_DAYS}</span> : null}
        </label>
      ) : null}
    </div>
  );
}
type Show = "now" | "all";
type Tab = "order" | "vendor" | "lead" | "cover";

export default function IndentPage() {
  const ds = useDataset();
  const f = useFilters();
  const metrics = useMetrics();
  const role = useRole();
  const settings = usePanel((s) => s.settings);
  const approvals = usePanel((s) => s.approvals);
  const approve = usePanel((s) => s.approve);
  const clearApproval = usePanel((s) => s.clearApproval);
  const openProduct = usePanel((s) => s.openProduct);
  const [leadChoice, setLeadChoice] = useState<"own" | DaysChoice>("own");
  const [leadCustom, setLeadCustom] = useState("45");
  // "own" = each product's purchase rule (Night 180, Day / Wellness 150, no regimen: the general cover)
  const [coverChoice, setCoverChoice] = useState<"own" | DaysChoice>("own");
  const [coverCustom, setCoverCustom] = useState(String(settings.defaultCoverDays));
  // a custom box that is empty or out of range keeps the last good number, and says so beside the box
  const [lastLead, setLastLead] = useState(45);
  const [lastCover, setLastCover] = useState(settings.defaultCoverDays);
  const customLead = validDays(leadCustom) ?? lastLead;
  const customCover = validDays(coverCustom) ?? lastCover;
  const lead: LeadMode = leadChoice === "custom" ? customLead : leadChoice;
  const coverMode: number | "own" = coverChoice === "custom" ? customCover : coverChoice;
  const [show, setShow] = useState<Show>("now");
  const [tab, setTab] = useState<Tab>("order");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return metrics
      .filter((m) => productMatches(m.product, f) && m.rate > 0)
      .map((m) => {
        const L = lead === "own" ? m.leadTime : lead;
        const C = coverMode === "own" ? m.rule.coverDays : coverMode;
        const at = m.rule.reorderAtDays;
        const extra = m.extraFor(L + C);
        const ind = indentQuantity({ rate: m.rate, leadTime: L, coverDays: C, safetyDays: m.rule.safetyDays, reorderAtDays: at, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize, extraUnits: extra });
        const status = stockStatus({ stock: m.stock, onOrder: m.onOrder, nextArrivalDays: m.nextArrivalDays, rate: m.rate, leadTime: L, reorderAtDays: at, overstockDays: settings.overstockDays, extraUnits: extra });
        const inDays = daysUntilOrder(m.stock, m.onOrder, m.rate, at, L, extra) ?? 0;
        const orderBy = addDays(ds.today, inDays);
        const rp = reorderPoint(m.rate, at, L);
        return { m, L, C, ind, status, inDays, orderBy, rp, arrives: addDays(orderBy, L), value: ind.qty * m.product.cost };
      })
      .filter((r) => (show === "now" ? r.ind.qty > 0 && (r.status === "critical" || r.status === "low") : true))
      .sort((a, b) => a.inDays - b.inDays || (a.status === "critical" ? -1 : 1) - (b.status === "critical" ? -1 : 1) || b.value - a.value);
  }, [metrics, f, lead, coverMode, settings, show, ds.today]);

  const withQty = rows.filter((r) => r.ind.qty > 0);
  const totalValue = withQty.reduce((a, r) => a + r.value, 0);
  const totalUnits = withQty.reduce((a, r) => a + r.ind.qty, 0);
  const urgentCount = rows.filter((r) => r.status === "critical").length;
  const approvedHere = withQty.filter((r) => approvals[r.m.product.id]);
  const isAdmin = role.access === "admin";
  const allIds = withQty.map((r) => r.m.product.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const doApprove = () => {
    const items = withQty.filter((r) => selected.has(r.m.product.id)).map((r) => ({ productId: r.m.product.id, qty: r.ind.qty }));
    if (!items.length) return;
    approve(items, role.id);
    setSelected(new Set());
    toast(`${items.length} order line${items.length > 1 ? "s" : ""} approved. Saved in this browser only, until personal logins are added.`);
  };

  const exportList = () =>
    downloadCsv(
      `purchase_list_${ds.today}.csv`,
      ["Vendor", "Product", "SKU", "Order qty", "Pack size", "Order by", "Arrives", "Lead time (days)", "Cover (days)", "Unit cost (₹)", "Value at cost (₹)", "Approved"],
      withQty.map((r) => [
        r.m.vendorName,
        r.m.product.name,
        r.m.product.sku,
        r.ind.qty,
        r.m.product.packSize,
        r.orderBy,
        r.arrives,
        r.L,
        r.C,
        r.m.product.cost,
        Math.round(r.value),
        approvals[r.m.product.id] ? "yes" : "no",
      ]),
    );

  const vendorMap = new Map<string, typeof withQty>();
  for (const r of withQty) vendorMap.set(r.m.vendorName, [...(vendorMap.get(r.m.vendorName) ?? []), r]);
  const byVendor = [...vendorMap.entries()].sort((a, b) => b[1].reduce((x, r) => x + r.value, 0) - a[1].reduce((x, r) => x + r.value, 0));

  const matrixRows = metrics.filter((m) => productMatches(m.product, f) && m.rate > 0 && (show === "all" || m.status === "critical" || m.status === "low"));

  return (
    <div>
      <PageHeader
        title="Auto indent"
        sub={`What to order now and how much, by each product’s Type Regimen in Zoho. Night Regime: order when ${settings.nightReorderAtDays} days of stock are left, enough to be back at ${settings.nightTargetDays} days when it lands. Day Regime and Wellness: at ${settings.dayReorderAtDays} days, back to ${settings.dayTargetDays}. Order = daily rate × (lead time + target days) − current stock − stock on the way (+ campaign and festival units), rounded up to the pack size. No regimen yet: at ${settings.reorderAtDays} days, ${settings.defaultCoverDays} days cover + ${settings.purchaseSafetyDays} days safety stock.`}
        right={
          <>
            <Button icon={<Download size={14} />} onClick={exportList} disabled={IS_PREVIEW} disabledReason={PREVIEW_NO_DOWNLOAD}>
              Export purchase list
            </Button>
            <Button disabled disabledReason="Creating purchase orders in Zoho comes in a later version; for now, export the list.">
              Create POs in Zoho
            </Button>
          </>
        }
      />
      <FilterBar date={false} channels={false} locations={false} search />
      {ds.locations.some((l) => !l.readable) || !ds.purchaseOrdersAvailable ? (
        <div className="mb-3">
          <Note tone="warn">
            {ds.locations.some((l) => !l.readable) ? `Stock at ${ds.locations.filter((l) => !l.readable).map((l) => l.name).join(", ")} can’t be read from Zoho yet, so it isn’t counted. ` : ""}
            {!ds.purchaseOrdersAvailable ? "Purchase orders can’t be read yet, so stock on the way counts as 0. " : ""}
            Quantities may be higher than needed until that is fixed (see Data health).
          </Note>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div>
            <div className="mb-1 text-[12px] font-semibold text-ink-2">New stock arrives in</div>
            <DaysPicker<"own">
              label="Lead time"
              extra={[{ value: "own", label: "Each product’s own" }]}
              options={LEAD_TIME_OPTIONS}
              value={leadChoice}
              onChange={setLeadChoice}
              custom={leadCustom}
              onCustom={(v) => {
                setLeadCustom(v);
                const n = validDays(v);
                if (n !== null) setLastLead(n);
              }}
            />
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-ink-2">Order enough to last (after it arrives)</div>
            <DaysPicker<"own">
              label="Cover"
              extra={[{ value: "own", label: "Each product’s rule" }]}
              options={COVER_OPTIONS}
              value={coverChoice}
              onChange={setCoverChoice}
              custom={coverCustom}
              onCustom={(v) => {
                setCoverCustom(v);
                const n = validDays(v);
                if (n !== null) setLastCover(n);
              }}
            />
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-ink-2">Show</div>
            <Segmented<Show> value={show} onChange={setShow} label="Show" options={[{ value: "now", label: "Needs ordering now" }, { value: "all", label: "All products" }]} />
          </div>
        </div>
        {lead !== "own" ? (
          <div className="mt-3">
            <Note tone="warn">“What if” view: every product is treated as arriving in {lead} days. Approvals still use the quantity shown here.</Note>
          </div>
        ) : null}
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Products to order" value={withQty.length} sub={`${urgentCount} critical`} tone={urgentCount ? "critical" : "neutral"} />
        <StatTile label="Units" value={fmtInt(totalUnits)} sub={coverMode === "own" ? "each product’s target after arrival" : `cover ${coverMode} days after arrival`} />
        <StatTile label="Order value at cost" value={fmtMoneyShort(totalValue)} sub={fmtMoney(totalValue)} />
        <StatTile label="Approved" value={`${approvedHere.length} of ${withQty.length}`} sub={approvedHere.length ? "saved in this browser" : "none yet"} tone={approvedHere.length ? "good" : "neutral"} />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="px-4 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "order", label: "Order now", count: withQty.length },
              { value: "vendor", label: "By vendor" },
              { value: "lead", label: "If stock takes 7–90 days" },
              { value: "cover", label: "Stock indent 7–180 days" },
            ]}
          />
        </div>

        {tab === "order" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Button
                variant="confirm"
                icon={<Check size={14} />}
                onClick={doApprove}
                disabled={!isAdmin || selected.size === 0}
                disabledReason={!isAdmin ? `Only Management can approve the indent (viewing as ${role.person})` : "Tick the lines to approve first"}
              >
                Approve selected ({selected.size})
              </Button>
              <span className="text-[12px] text-muted">Approving marks the lines as agreed. It does not place an order with the vendor.</span>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 pb-4">
                <Empty title="Nothing needs ordering now">Every product is above its reorder point. Switch “Show” to All products to see every quantity.</Empty>
              </div>
            ) : (
              <div className="max-h-[620px] overflow-auto scroll-thin">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          className="accent-confirm"
                          checked={allSelected}
                          disabled={!isAdmin}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
                        />
                      </th>
                      <th>Product</th>
                      <th>Vendor</th>
                      <th className="num">Stock</th>
                      <th className="num">On the way</th>
                      <th className="num">Sells / day</th>
                      <th className="num">Reorder point</th>
                      <th className="num">Order qty</th>
                      <th>Order by</th>
                      <th>Arrives</th>
                      <th className="num">Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const id = r.m.product.id;
                      const ap = approvals[id];
                      return (
                        <tr key={id} className={clsx(ap && "bg-confirm-soft/40")}>
                          <td>
                            {r.ind.qty > 0 ? (
                              <input type="checkbox" aria-label={`Select ${r.m.product.name}`} className="accent-confirm" checked={selected.has(id)} disabled={!isAdmin} onChange={() => toggle(id)} />
                            ) : null}
                          </td>
                          <td>
                            <button className="max-w-[230px] truncate text-left font-medium hover:underline" onClick={() => openProduct(id)}>
                              {r.m.product.name}
                            </button>
                            {ap ? (
                              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-confirm">
                                <Check size={12} /> Approved {fmtInt(ap.qty)} · {fmtDay(ap.at.slice(0, 10))} by {roleById(ap.by).person}
                                {isAdmin ? (
                                  <button onClick={() => clearApproval(id)} className="ml-1 inline-flex items-center gap-0.5 font-normal text-ink-2 hover:underline">
                                    <Undo2 size={11} /> undo
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="text-[11.5px] text-muted">
                                {r.m.product.sku} · pack {r.m.product.packSize}
                              </div>
                            )}
                          </td>
                          <td className="max-w-[170px] truncate text-ink-2">
                            {r.m.vendorName.split(" · ")[0]} <span className="text-muted">· {r.L}d</span>
                          </td>
                          <td className="num">{fmtInt(r.m.stock)}</td>
                          <td className="num">{r.m.onOrder ? fmtInt(r.m.onOrder) : "—"}</td>
                          <td className="num">{fmtRate(r.m.rate)}</td>
                          <td className="num">{fmtInt(r.rp)}</td>
                          <td className="num text-[14px] font-bold" title={`Before rounding: ${fmtRate(r.ind.raw)}`}>
                            {r.ind.qty ? fmtInt(r.ind.qty) : "—"}
                          </td>
                          <td className={clsx("whitespace-nowrap", r.inDays === 0 && "font-semibold text-st-critical")}>{r.inDays === 0 ? "Today" : fmtDay(r.orderBy)}</td>
                          <td className="whitespace-nowrap">{fmtDay(r.arrives)}</td>
                          <td className="num">{r.ind.qty ? fmtMoneyShort(r.value) : "—"}</td>
                          <td>
                            <StatusChip status={r.status} size="sm" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {tab === "vendor" ? (
          <div className="space-y-4 p-4">
            {byVendor.length === 0 ? <Empty title="Nothing to order" /> : null}
            {byVendor.map(([vendor, list]) => (
              <div key={vendor}>
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-[13.5px] font-semibold">{vendor}</h3>
                  <span className="text-[13px] tabular">
                    {list.length} lines · <b>{fmtMoneyShort(list.reduce((a, r) => a + r.value, 0))}</b>
                  </span>
                </div>
                <table className="dtable">
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.m.product.id}>
                        <td className="font-medium">{r.m.product.name}</td>
                        <td className="num">{fmtInt(r.ind.qty)} units</td>
                        <td className="num">order by {r.inDays === 0 ? "today" : fmtDay(r.orderBy)}</td>
                        <td className="num">{fmtMoneyShort(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "lead" ? <LeadMatrix rows={matrixRows} cover={coverMode} extraLead={leadChoice === "custom" ? customLead : null} onOpen={openProduct} /> : null}
        {tab === "cover" ? <CoverMatrix rows={matrixRows} extraCover={coverChoice === "custom" ? customCover : null} onOpen={openProduct} /> : null}
      </Card>
    </div>
  );
}

/** The fixed day columns, plus the custom number when one is chosen (in order, no repeats). */
const withExtra = (fixed: readonly number[], extra: number | null) => (extra === null || fixed.includes(extra) ? [...fixed] : [...fixed, extra].sort((a, b) => a - b));

function LeadMatrix({ rows, cover, extraLead, onOpen }: { rows: ProductMetrics[]; cover: number | "own"; extraLead: number | null; onOpen: (id: string) => void }) {
  const leads = withExtra(LEAD_TIME_OPTIONS, extraLead);
  return (
    <div>
      <p className="px-4 py-3 text-[12.5px] text-ink-2">
        How much to order now if new stock takes {leads.join(", ")} days to arrive, ordering enough for {cover === "own" ? "each product’s target" : `${cover} days`} after it lands. An order is due once the stock left falls to the product’s own trigger (see the rules above, or the lead time when that is longer); “—” = not due yet. Red = days the shelf would be empty before it arrives.
      </p>
      <div className="max-h-[600px] overflow-auto scroll-thin">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Stock</th>
              <th className="num">Sells / day</th>
              {leads.map((L) => (
                <th key={L} className="num">
                  {L} days
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.product.id} className="clickable" onClick={() => onOpen(m.product.id)}>
                <td className="max-w-[230px] truncate font-medium">{m.product.name}</td>
                <td className="num">{fmtInt(m.stock)}</td>
                <td className="num">{fmtRate(m.rate)}</td>
                {leads.map((L) => {
                  const C = cover === "own" ? m.rule.coverDays : cover;
                  const q = indentQuantity({ rate: m.rate, leadTime: L, coverDays: C, safetyDays: m.rule.safetyDays, reorderAtDays: m.rule.reorderAtDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize, extraUnits: m.extraFor(L + C) }).qty;
                  const gap = daysWithNoStock(m.stock + m.onOrder, m.rate, L);
                  return (
                    <td key={L} className="num">
                      <div className="font-semibold">{q ? fmtInt(q) : "—"}</div>
                      {gap > 0 ? <div className="text-[11px] font-semibold text-st-critical">{gap}d empty</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoverMatrix({ rows, extraCover, onOpen }: { rows: ProductMetrics[]; extraCover: number | null; onOpen: (id: string) => void }) {
  const covers = withExtra(COVER_OPTIONS, extraCover);
  const i90 = covers.indexOf(90);
  return (
    <div>
      <p className="px-4 py-3 text-[12.5px] text-ink-2">Quantity needed for each cover period, side by side, using each product’s own lead time, so you can choose a short or a long order. “—” = not due yet: the stock left is above the product’s own trigger (see the rules above).</p>
      <div className="max-h-[600px] overflow-auto scroll-thin">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Lead time</th>
              {covers.map((c) => (
                <th key={c} className="num">
                  {c} days
                </th>
              ))}
              <th className="num">90-day value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const qs = covers.map((c) => indentQuantity({ rate: m.rate, leadTime: m.leadTime, coverDays: c, safetyDays: m.rule.safetyDays, reorderAtDays: m.rule.reorderAtDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize, extraUnits: m.extraFor(m.leadTime + c) }).qty);
              return (
                <tr key={m.product.id} className="clickable" onClick={() => onOpen(m.product.id)}>
                  <td className="max-w-[230px] truncate font-medium">{m.product.name}</td>
                  <td className="num">{m.leadTime}d</td>
                  {qs.map((q, i) => (
                    <td key={i} className="num font-semibold">
                      {q ? fmtInt(q) : "—"}
                    </td>
                  ))}
                  <td className="num">{fmtMoneyShort((qs[i90] ?? 0) * m.product.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
