"use client";

import clsx from "clsx";
import { Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, Note, PageHeader, Segmented, StatusChip } from "@/components/ui";
import { urgency } from "@/lib/data/engine";
import { useDataset, useMetrics } from "@/lib/data/hooks";
import { addDays, fmtDay, fmtDayLong, fmtWeekday, parseDay } from "@/lib/dates";
import { fmtDays, fmtInt, fmtMoneyShort, ordinal } from "@/lib/format";
import { usePanel, type Recipients, type Schedule } from "@/lib/state/store";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function nextWeekday(today: string, name: string, includeToday = true): string {
  const target = WEEKDAYS.indexOf(name);
  const cur = parseDay(today).getUTCDay();
  let diff = (target - cur + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(today, diff);
}

function nextMonthDay(today: string, day: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  if (d <= day) return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface Planned {
  name: string;
  when: string;
  next: string;
  to: string;
  cc: string;
  channel: string;
  content: string;
}

function schedulePlan(today: string, s: Schedule, r: Recipients): Planned[] {
  const none = "—";
  const stockCc = "Purchase, Supply chain head";
  return [
    { name: "Stock alert", when: `Daily ${s.dailyAlertTime}`, next: today, to: `Management (${r.management})`, cc: stockCc, channel: "Email + WhatsApp", content: "Critical / low / overstock with order quantities" },
    { name: "Critical alert", when: "Instantly after a data sync (max once per product per day)", next: "when it happens", to: "Management", cc: stockCc, channel: "Email + WhatsApp", content: "A product will run out before new stock can arrive" },
    { name: "Auto-indent plan", when: `Daily with the stock alert; full plan every Monday`, next: nextWeekday(today, "Monday"), to: "Management", cc: "Purchase", channel: "Email", content: "What to order, quantities, vendors, value, approve link" },
    { name: "Sales summary", when: "Every Monday", next: nextWeekday(today, "Monday"), to: "Management", cc: none, channel: "Email", content: "Overall sales 7/15/30 days: website / online / clinic" },
    { name: "Monthly plan request", when: `${ordinal(s.monthlyRequestDay)}, ${s.requestTime}`, next: nextMonthDay(today, s.monthlyRequestDay), to: "Marketing, Sales head", cc: "Management", channel: "Email", content: "Personal upload link, next 30 days, trend pre-filled" },
    { name: "Monthly deadline", when: `${ordinal(s.monthlyDueDay)}`, next: nextMonthDay(today, s.monthlyDueDay), to: "Marketing, Sales head", cc: "Management", channel: "Email", content: "Submitted plans auto-emailed; anyone pending gets a final reminder" },
    { name: "Monthly consolidated report", when: `${ordinal(s.monthlyReportDay)}`, next: nextMonthDay(today, s.monthlyReportDay), to: "Management", cc: none, channel: "Email + PDF", content: "System projection + current trend + team plans" },
    { name: "Weekly plan request", when: `Every ${s.weeklyRequestDay}, ${s.requestTime}`, next: nextWeekday(today, s.weeklyRequestDay, false), to: "Marketing, Sales head", cc: "Management", channel: "Email", content: `Upload link, next 7 days; due ${s.weeklyDueDay}` },
    { name: "Weekly reminder", when: `${s.weeklyDueDay} ${s.requestTime}, only if pending`, next: nextWeekday(today, s.weeklyDueDay), to: "Whoever is pending", cc: "Management", channel: "Email", content: "“Your weekly plan is due today”" },
    { name: "Weekly consolidated report", when: `Every ${s.weeklyReportDay}, ${s.dailyAlertTime}`, next: nextWeekday(today, s.weeklyReportDay, false), to: "Management", cc: none, channel: "Email + PDF", content: "Weekly plans + projection + current trend" },
  ];
}

interface LogRow {
  day: string;
  time: string;
  type: string;
  channel: "Email" | "WhatsApp";
  to: string;
  status: "Delivered" | "Read" | "Opened" | "Sent" | "Failed";
  summary: string;
}

function sampleLog(today: string, critical: number, low: number, over: number): LogRow[] {
  const rows: LogRow[] = [];
  for (let i = 0; i < 14; i++) {
    const day = addDays(today, -i);
    const c = Math.max(1, critical - (i % 3 === 0 ? 1 : 0));
    const l = low + (i % 4 === 1 ? 1 : 0);
    rows.push({ day, time: "09:00", type: "Stock alert", channel: "WhatsApp", to: "Management", status: i === 0 ? "Delivered" : "Read", summary: `${c} critical · ${l} low · ${over} overstock` });
    rows.push({ day, time: "09:00", type: "Stock alert", channel: "Email", to: "Management", status: i === 0 ? "Delivered" : "Opened", summary: `Full list + Excel attached` });
    if (i === 2 || i === 6) rows.push({ day, time: i === 2 ? "13:04" : "16:41", type: "Critical alert", channel: "WhatsApp", to: "Management", status: "Read", summary: i === 2 ? "UV Armour Sunscreen runs out in 6 days (lead time 15)" : "Collagen Cream runs out in 15 days (lead time 15)" });
    const wd = fmtWeekday(day);
    if (wd === "Thu") rows.push({ day, time: "10:00", type: "Weekly plan request", channel: "Email", to: "Marketing, Sales head", status: "Delivered", summary: "Week of 16 Nov · due Sat 14 Nov · cc Management" });
    if (wd === "Sat" && i === 0) rows.push({ day, time: "10:00", type: "Weekly reminder", channel: "Email", to: "Sales head", status: "Delivered", summary: "Weekly plan due today · cc Management" });
    if (wd === "Mon") {
      rows.push({ day, time: "09:00", type: "Weekly consolidated report", channel: "Email", to: "Management", status: "Opened", summary: "Week of 9 Nov · PDF attached" });
      rows.push({ day, time: "09:00", type: "Auto-indent plan", channel: "Email", to: "Management", status: "Opened", summary: "Full weekly indent" });
    }
  }
  return rows.sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
}

export default function AlertsPage() {
  const ds = useDataset();
  const metrics = useMetrics();
  const recipients = usePanel((s) => s.recipients);
  const schedule = usePanel((s) => s.schedule);
  const settings = usePanel((s) => s.settings);
  const [preview, setPreview] = useState<"email" | "whatsapp">("whatsapp");

  const critical = metrics.filter((m) => m.status === "critical").sort((a, b) => urgency(a) - urgency(b));
  const low = metrics.filter((m) => m.status === "low").sort((a, b) => urgency(a) - urgency(b));
  const over = metrics.filter((m) => m.status === "overstock");
  const orderValue = [...critical, ...low].reduce((a, m) => a + m.indentQty * m.product.cost, 0);
  const overValue = over.reduce((a, m) => a + m.excess * m.product.cost, 0);
  const first = critical[0];
  const plan = schedulePlan(ds.today, schedule, recipients);
  const live = ds.health.alerts ?? null;
  const log: LogRow[] = live
    ? live.log.map((r) => ({
        day: r.at.slice(0, 10),
        time: new Date(r.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }),
        type: "Reorder alert",
        channel: r.channel === "email" ? "Email" : "WhatsApp",
        to: r.recipients.join(", "),
        status: r.status === "sent" ? "Sent" : "Failed",
        summary: r.error ? `${r.summary} · ${r.error}` : r.summary,
      }))
    : sampleLog(ds.today, critical.length, low.length, over.length);
  // the reorder alert: what has reached its regimen's reorder point and how much to order (as the server sends it)
  const due = [...critical, ...low].filter((m) => m.indentDue && m.indentQty > 0).sort((a, b) => a.cover - b.cover);

  return (
    <div>
      <PageHeader
        title="Alerts"
        sub="Every automatic email and WhatsApp message: what goes out, when, and to whom. All of them go to, or copy, Management."
        right={
          <Button icon={<Send size={14} />} disabled disabledReason="Sending a test works once email and WhatsApp are connected (backend stage).">
            Send a test to me
          </Button>
        }
      />

      <Card className="mb-3">
        <CardHeader
          title="Reorder alert · email and WhatsApp"
          sub={`Sent every morning after the 9:00 AM sync when a product reaches its reorder point: Night Regime at ${settings.nightReorderAtDays} days of stock left (order back to ${settings.nightTargetDays} days), Day Regime and Wellness at ${settings.dayReorderAtDays} days (back to ${settings.dayTargetDays}). A product is repeated after ${live?.repeatDays ?? 7} days if it is still due.`}
        />
        <div className="mb-3 flex flex-wrap gap-2 text-[12.5px]">
          {(["email", "whatsapp"] as const).map((ch) => {
            const ready = live ? live[ch] : false;
            const missing = live ? live.missing[ch] : [];
            return (
              <span key={ch} className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1", ready ? "bg-st-healthy-soft text-st-healthy" : "bg-sunken text-ink-2")}>
                {ch === "email" ? <Mail size={13} aria-hidden /> : <MessageCircle size={13} aria-hidden />}
                {ch === "email" ? "Email" : "WhatsApp"}:{" "}
                {!live ? "sample data, nothing is sent" : ready ? "set up" : `not set up yet (missing ${missing.join(", ")})`}
              </span>
            );
          })}
        </div>
        {due.length ? (
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Regimen rule</th>
                  <th className="num">Stock</th>
                  <th className="num">Days left</th>
                  <th className="num">Order</th>
                  <th className="num">Value at cost</th>
                </tr>
              </thead>
              <tbody>
                {due.map((m) => (
                  <tr key={m.product.id}>
                    <td className="font-medium">{m.product.name}</td>
                    <td className="text-[12.5px] text-ink-2">{m.rule.label}</td>
                    <td className="num">{fmtInt(m.stock)}</td>
                    <td className="num">{fmtDays(m.cover)}</td>
                    <td className="num font-semibold">{fmtInt(m.indentQty)}</td>
                    <td className="num">{fmtMoneyShort(m.indentQty * m.product.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">Nothing has reached its reorder point today.</p>
        )}
      </Card>

      <div className="grid gap-3 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader
            title={`Today’s stock alert · ${fmtDay(ds.today)}, ${schedule.dailyAlertTime}`}
            sub="Built from today’s numbers. This is exactly what Management receives."
            right={<Segmented value={preview} onChange={setPreview} label="Preview" options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} />}
          />
          {preview === "whatsapp" ? (
            <div className="rounded-xl bg-[#e7ddd3] p-4">
              <div className="ml-auto max-w-[340px] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-[#111b21] shadow-sm">
                <div className="font-semibold">Stock alert · {fmtDay(ds.today)}, 9:00 AM</div>
                <div>🔴 Critical: {critical.length} products{first ? ` (${first.product.name} runs out in ${fmtDays(first.cover)} days)` : ""}</div>
                <div>🟠 Low: {low.length} products</div>
                <div>🔵 Overstock: {over.length} products · {fmtMoneyShort(overValue)} excess</div>
                <div>
                  🛒 Order now: {fmtMoneyShort(orderValue)} at cost ({critical.length + low.length} products)
                </div>
                <div className="mt-1 text-[#027eb5] underline">View full list and approve indent</div>
                <div className="mt-1 text-right text-[11px] text-[#667781]">09:00 ✓✓</div>
              </div>
              <p className="mt-3 text-[11.5px] text-[#4a4038]">WhatsApp business messages use a template approved by Meta: the wording is fixed, only the numbers change.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-line text-[13px]">
              <div className="space-y-0.5 border-b border-line bg-sunken px-3 py-2 text-[12.5px]">
                <div>
                  <span className="text-muted">To:</span> {recipients.management}
                </div>
                <div>
                  <span className="text-muted">Subject:</span> <b>Stock alert {fmtDay(ds.today)}: {critical.length} critical, {low.length} low, {over.length} overstock</b>
                </div>
                <div>
                  <span className="text-muted">Attached:</span> stock_alert_{ds.today}.xlsx
                </div>
              </div>
              <div className="space-y-2 p-3">
                <p>Good morning. Here is today’s stock position, read from Zoho at 9:00 AM.</p>
                <div>
                  <div className="mb-1 font-semibold">Order now</div>
                  <table className="dtable text-[12px]">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Days left</th>
                        <th className="num">Order</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...critical, ...low].map((m) => (
                        <tr key={m.product.id}>
                          <td>{m.product.name}</td>
                          <td className="num">{fmtDays(m.cover)}</td>
                          <td className="num font-semibold">{fmtInt(m.indentQty)}</td>
                          <td>
                            <StatusChip status={m.status} size="sm" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Overstock: {over.length} products, {fmtMoneyShort(overValue)} above {settings.overstockDays} days of cover.
                </p>
                <span className="inline-block rounded-lg bg-coral px-3 py-1.5 text-[12.5px] font-medium text-white">Open the panel and approve</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-3" pad={false}>
          <div className="p-4 pb-2">
            <CardHeader className="mb-0" title="Schedule" sub="Times, days and recipients can be changed in Settings" />
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Message</th>
                  <th>When · next</th>
                  <th>To · CC</th>
                  <th>Via</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.name}>
                    <td style={{ minWidth: 190 }}>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11.5px] text-muted">{p.content}</div>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div className="text-ink-2">{p.when}</div>
                      <div className="text-[12px] font-medium">
                        Next: {p.next.length === 10 ? (p.next === ds.today ? "today" : `${fmtWeekday(p.next)} ${fmtDay(p.next)}`) : p.next}
                      </div>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div>{p.to}</div>
                      {p.cc !== "—" ? <div className="text-[12px] text-ink-2">CC: {p.cc}</div> : null}
                    </td>
                    <td className="whitespace-nowrap">{p.channel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader className="mb-0" title="Sent log · last 14 days" sub="Every email and WhatsApp the panel sends is recorded here with its delivery status" />
          <div className="mt-2">
            {live ? (
              log.length ? null : <Note>No reorder alert has been sent yet.</Note>
            ) : (
              <Note tone="warn">Sample log. Real entries appear on live data once email and WhatsApp are set up.</Note>
            )}
          </div>
        </div>
        <div className="max-h-[480px] overflow-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>When</th>
                <th>Message</th>
                <th>Via</th>
                <th>To</th>
                <th>Status</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">
                    {fmtDayLong(r.day)}, {r.time}
                  </td>
                  <td className="font-medium whitespace-nowrap">{r.type}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {r.channel === "Email" ? <Mail size={13} aria-hidden /> : <MessageCircle size={13} aria-hidden />}
                      {r.channel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{r.to}</td>
                  <td>
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", r.status === "Failed" ? "bg-st-critical-soft text-st-critical" : r.status === "Delivered" ? "bg-sunken text-ink-2" : "bg-st-healthy-soft text-st-healthy")}>{r.status}</span>
                  </td>
                  <td className="text-ink-2">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
