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
import { daysUntilOrder, daysWithNoStock, indentQuantity, stockStatus } from "@/lib/domain/formulas";
import { COVER_OPTIONS, LEAD_TIME_OPTIONS } from "@/lib/domain/types";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtRate } from "@/lib/format";
import { roleById } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";

type LeadMode = "own" | (typeof LEAD_TIME_OPTIONS)[number];
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
  const [lead, setLead] = useState<LeadMode>("own");
  const [cover, setCover] = useState<number>(settings.defaultCoverDays);
  const [show, setShow] = useState<Show>("now");
  const [tab, setTab] = useState<Tab>("order");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return metrics
      .filter((m) => productMatches(m.product, f) && m.rate > 0)
      .map((m) => {
        const L = lead === "own" ? m.leadTime : lead;
        const ind = indentQuantity({ rate: m.rate, leadTime: L, coverDays: cover, safetyDays: settings.safetyDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize });
        const status = stockStatus({ stock: m.stock, onOrder: m.onOrder, nextArrivalDays: m.nextArrivalDays, rate: m.rate, leadTime: L, safetyDays: settings.safetyDays, overstockDays: settings.overstockDays });
        const inDays = daysUntilOrder(m.stock, m.onOrder, m.rate, L, settings.safetyDays) ?? 0;
        const orderBy = addDays(ds.today, inDays);
        return { m, L, ind, status, inDays, orderBy, arrives: addDays(orderBy, L), value: ind.qty * m.product.cost };
      })
      .filter((r) => (show === "now" ? r.ind.qty > 0 && (r.status === "critical" || r.status === "low") : true))
      .sort((a, b) => a.inDays - b.inDays || (a.status === "critical" ? -1 : 1) - (b.status === "critical" ? -1 : 1) || b.value - a.value);
  }, [metrics, f, lead, cover, settings, show, ds.today]);

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
    toast(`${items.length} order line${items.length > 1 ? "s" : ""} approved. Saved in this browser until the backend is connected.`);
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
        cover,
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
        sub="What to order now and how much. Order = daily rate × (lead time + cover days) + safety stock − current stock − stock on the way, rounded up to the pack size."
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
            <Segmented<LeadMode>
              value={lead}
              onChange={setLead}
              label="Lead time"
              options={[{ value: "own", label: "Each product’s own" }, ...LEAD_TIME_OPTIONS.map((d) => ({ value: d as LeadMode, label: `${d} days` }))]}
            />
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-ink-2">Order enough to last (after it arrives)</div>
            <Segmented<number> value={cover} onChange={setCover} label="Cover" options={COVER_OPTIONS.map((d) => ({ value: d, label: `${d} days` }))} />
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
        <StatTile label="Units" value={fmtInt(totalUnits)} sub={`cover ${cover} days after arrival`} />
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
              { value: "cover", label: "Stock indent 15–90 days" },
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
                disabledReason={!isAdmin ? `Only the CBO can approve the indent (viewing as ${role.person})` : "Tick the lines to approve first"}
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
                          <td className="num">{fmtInt(r.m.reorderPoint)}</td>
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

        {tab === "lead" ? <LeadMatrix rows={matrixRows} cover={cover} safetyDays={settings.safetyDays} onOpen={openProduct} /> : null}
        {tab === "cover" ? <CoverMatrix rows={matrixRows} safetyDays={settings.safetyDays} onOpen={openProduct} /> : null}
      </Card>
    </div>
  );
}

function LeadMatrix({ rows, cover, safetyDays, onOpen }: { rows: ProductMetrics[]; cover: number; safetyDays: number; onOpen: (id: string) => void }) {
  return (
    <div>
      <p className="px-4 py-3 text-[12.5px] text-ink-2">
        How much to order now if new stock takes 7, 15, 30, 60 or 90 days to arrive, ordering enough for {cover} days after it lands. Red = days the shelf would be empty before it arrives.
      </p>
      <div className="max-h-[600px] overflow-auto scroll-thin">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Stock</th>
              <th className="num">Sells / day</th>
              {LEAD_TIME_OPTIONS.map((L) => (
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
                {LEAD_TIME_OPTIONS.map((L) => {
                  const q = indentQuantity({ rate: m.rate, leadTime: L, coverDays: cover, safetyDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize }).qty;
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

function CoverMatrix({ rows, safetyDays, onOpen }: { rows: ProductMetrics[]; safetyDays: number; onOpen: (id: string) => void }) {
  return (
    <div>
      <p className="px-4 py-3 text-[12.5px] text-ink-2">Quantity needed for each cover period, side by side, using each product’s own lead time, so you can choose a short or a long order.</p>
      <div className="max-h-[600px] overflow-auto scroll-thin">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Lead time</th>
              {COVER_OPTIONS.map((c) => (
                <th key={c} className="num">
                  {c} days
                </th>
              ))}
              <th className="num">90-day value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const qs = COVER_OPTIONS.map((c) => indentQuantity({ rate: m.rate, leadTime: m.leadTime, coverDays: c, safetyDays, stock: m.stock, onOrder: m.onOrder, packSize: m.product.packSize }).qty);
              return (
                <tr key={m.product.id} className="clickable" onClick={() => onOpen(m.product.id)}>
                  <td className="max-w-[230px] truncate font-medium">{m.product.name}</td>
                  <td className="num">{m.leadTime}d</td>
                  {qs.map((q, i) => (
                    <td key={i} className="num font-semibold">
                      {q ? fmtInt(q) : "—"}
                    </td>
                  ))}
                  <td className="num">{fmtMoneyShort((qs[qs.length - 1] ?? 0) * m.product.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
