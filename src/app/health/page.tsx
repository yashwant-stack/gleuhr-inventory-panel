"use client";

import clsx from "clsx";
import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { Card, CardHeader, ChannelDot, Note, PageHeader, StatTile } from "@/components/ui";
import { useDataset } from "@/lib/data/hooks";
import { fmtDay } from "@/lib/dates";
import { fmtInt } from "@/lib/format";

const IST = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Ok({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 size={15} className="shrink-0 text-st-healthy" aria-label="OK" />;
  return warn ? <CircleAlert size={15} className="shrink-0 text-st-low" aria-label="Needs attention" /> : <CircleX size={15} className="shrink-0 text-st-critical" aria-label="Not working" />;
}

export default function HealthPage() {
  const ds = useDataset();
  const h = ds.health;
  const connected = ds.channels.filter((c) => c.connected).length;
  const readable = ds.locations.filter((l) => l.readable).length;
  const refused = h.failedPushes.reduce((a, f) => a + f.failed, 0);
  const takenFrom = (locId: string) => [...new Set(ds.sources.filter((s) => s.locationId === locId).map((s) => s.channel))];
  const locName = (id: string) => ds.locations.find((l) => l.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Data health"
        sub="Can you trust the numbers? What reaches the panel, what doesn’t, and why. Sales come from the clinic and online CRMs; stock comes from Zoho, per location."
      />
      {ds.origin === "sample" ? (
        <div className="mb-3">
          <Note tone="warn">Sample mode: these are the findings of the read-only check on {fmtDay(h.checkedAt.slice(0, 10))}. With live data this page updates on every sync.</Note>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sales channels connected" value={`${connected} of ${ds.channels.length}`} sub={ds.channels.filter((c) => !c.connected).map((c) => c.label).join(", ") + " not connected"} tone={connected === ds.channels.length ? "good" : "low"} />
        <StatTile label="Zoho locations readable" value={`${readable} of ${ds.locations.length}`} sub={readable === ds.locations.length ? "all readable" : "stock unknown for the rest"} tone={readable === ds.locations.length ? "good" : "low"} />
        <StatTile label="Stock changes Zoho refused" value={fmtInt(refused)} sub="last 30 days · Zoho’s count is off by these" tone={refused ? "critical" : "good"} />
        <StatTile label="Clinics not linked to Zoho" value={h.unmappedClinics.length} sub={h.unmappedClinics.length ? "their sales come off Mohali" : "all linked"} tone={h.unmappedClinics.length ? "critical" : "good"} />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader className="mb-0" title="1 · How each channel reaches the panel" sub="Zoho counts stock per location, not per channel. Each channel’s sales come from the CRM database." />
        </div>
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Sales from</th>
                <th>Data from</th>
                <th>Stock taken from (Zoho location)</th>
              </tr>
            </thead>
            <tbody>
              {ds.channels.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Ok ok={c.connected} warn />
                      <ChannelDot channel={c.id} /> {c.label}
                    </span>
                  </td>
                  <td className="text-ink-2">
                    {c.id === "clinic" ? "Clinic CRM sales" : c.id === "online_team" ? "Online CRM orders" : c.id === "website" ? "Shopify orders in the online CRM" : <span className="text-st-low">{c.note}</span>}
                  </td>
                  <td className="whitespace-nowrap">{c.dataFrom ? fmtDay(c.dataFrom) : "—"}</td>
                  <td className="text-ink-2">{[...new Set(ds.sources.filter((s) => s.channel === c.id).map((s) => locName(s.locationId)))].join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card pad={false}>
          <div className="p-4 pb-2">
            <CardHeader className="mb-0" title="2 · Zoho locations" sub="Where stock sits, and which channels take from it" />
          </div>
          <div className="max-h-[460px] overflow-auto scroll-thin">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Readable</th>
                  <th>Taken by</th>
                </tr>
              </thead>
              <tbody>
                {ds.locations.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium whitespace-nowrap">
                      {l.name}
                      {l.isPrimary ? <span className="ml-1.5 rounded bg-sunken px-1.5 text-[11px] text-ink-2">primary</span> : null}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <Ok ok={l.readable} />
                        {l.readable ? "Yes" : "No permission"}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex flex-wrap gap-2">
                        {takenFrom(l.id).map((c) => (
                          <span key={c} className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                            <ChannelDot channel={c} /> {ds.channels.find((x) => x.id === c)?.short}
                          </span>
                        ))}
                        {takenFrom(l.id).length === 0 ? <span className="text-[12px] text-muted">nothing from the CRMs</span> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader title="3 · Clinics not linked to a Zoho location" sub="Zoho books their stock changes on the primary location instead" />
            {h.unmappedClinics.length === 0 ? (
              <p className="text-[13px] text-ink-2">Every active clinic is linked.</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {h.unmappedClinics.map((c) => (
                  <li key={c.clinicId} className="flex items-center gap-2">
                    <Ok ok={false} />
                    <b>{c.name}</b> <span className="text-ink-2">→ its sales come off {c.landsOn}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-muted">Fix: link the clinic to its Zoho location in the clinic CRM (Pune already has one in Zoho).</p>
          </Card>
          <Card>
            <CardHeader title="4 · What the Zoho login may read" />
            <ul className="space-y-1.5 text-[13px]">
              {h.zohoAccess.map((a) => (
                <li key={a.area} className="flex items-start gap-2">
                  <Ok ok={a.ok} warn={a.note.startsWith("Not checked")} />
                  <span>
                    <b>{a.area}</b> <span className="text-ink-2">· {a.note}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-muted">Fix: in Zoho, give the integration user read access to every location, sales orders, invoices, transfer orders and purchase orders.</p>
          </Card>
        </div>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHeader className="mb-0" title="5 · Stock changes Zoho refused (last 30 days)" sub="Sales the CRMs recorded but Zoho never received, so Zoho’s stock at these locations is too high" />
        </div>
        <div className="overflow-x-auto scroll-thin">
          <table className="dtable">
            <thead>
              <tr>
                <th>Location</th>
                <th className="num">Refused</th>
                <th>Since</th>
                <th>Latest</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {h.failedPushes.map((f) => (
                <tr key={f.locationName}>
                  <td className="font-medium">{f.locationName}</td>
                  <td className={clsx("num font-semibold", f.failed > 100 && "text-st-critical")}>{fmtInt(f.failed)}</td>
                  <td className="whitespace-nowrap">{f.firstFailed ? fmtDay(f.firstFailed) : "—"}</td>
                  <td className="whitespace-nowrap">{f.lastFailed ? fmtDay(f.lastFailed) : "—"}</td>
                  <td className="text-ink-2">{f.topError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHeader title="6 · Last syncs" />
        <ul className="space-y-1.5 text-[13px]">
          {h.lastSync.map((s) => (
            <li key={s.job} className="flex items-center gap-2">
              <Ok ok={s.ok} />
              <b>{s.job}</b>
              <span className="text-ink-2">· {s.at ? IST.format(new Date(s.at)) : "never"} · {s.note}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
