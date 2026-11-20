"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useDataset } from "@/lib/data/hooks";
import { salesPointId } from "@/lib/data/model";
import { SEGMENTS, type ChannelId } from "@/lib/domain/types";
import { usePanel } from "@/lib/state/store";
import { DateRange } from "./DateRange";
import { MultiSelect } from "./Select";
import { ChannelDot } from "./ui";

/** One row of filters above the content. Each page shows only the filters that apply to it. */
export function FilterBar({
  date = true,
  channels = true,
  locations = "sales",
  categories = true,
  search = true,
  note,
  right,
}: {
  date?: boolean;
  channels?: boolean;
  /** "sales": filter by clinic / dispatch point · "stock": filter by Zoho location · false: none. */
  locations?: "sales" | "stock" | false;
  categories?: boolean;
  search?: boolean;
  note?: ReactNode;
  right?: ReactNode;
}) {
  const s = usePanel();
  const ds = useDataset();
  const purchase = s.role === "purchase";
  const active = s.channels.length + s.points.length + s.locations.length + s.categories.length + (purchase ? s.segments.length : 0) + (s.search ? 1 : 0) > 0;
  const categoryList = [...new Set(ds.products.map((p) => p.category))].sort();
  const pointOptions: { value: string; label: string; group: string }[] = [];
  for (const src of ds.sources) {
    const id = salesPointId(src);
    if (pointOptions.some((o) => o.value === id)) continue;
    const clinic = src.clinicId ? ds.clinics.find((c) => c.id === src.clinicId) : null;
    const loc = ds.locations.find((l) => l.id === src.locationId);
    pointOptions.push(clinic ? { value: id, label: clinic.name, group: "Clinics" } : { value: id, label: `${loc?.name ?? src.locationId} dispatch`, group: "Online dispatch" });
  }
  pointOptions.sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Clinics" ? -1 : 1));
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      {date ? <DateRange /> : null}
      {channels ? (
        <MultiSelect<ChannelId>
          label="Channel"
          values={s.channels}
          onChange={s.setChannels}
          options={ds.channels.filter((c) => c.connected).map((c) => ({ value: c.id, label: c.label, icon: <ChannelDot channel={c.id} /> }))}
        />
      ) : null}
      {locations === "sales" ? (
        <MultiSelect label="Sold at" values={s.points} onChange={s.setPoints} options={pointOptions} />
      ) : null}
      {locations === "stock" ? (
        <MultiSelect
          label="Location"
          values={s.locations}
          onChange={s.setLocations}
          options={ds.locations.map((l) => ({
            value: l.id,
            label: l.readable ? l.name : `${l.name} (can’t read)`,
            group: l.kind === "warehouse" ? "Warehouse" : l.kind === "darkstore" ? "Darkstores" : "Clinics",
          }))}
        />
      ) : null}
      {categories ? <MultiSelect label="Category" values={s.categories} onChange={s.setCategories} options={categoryList.map((c) => ({ value: c, label: c }))} /> : null}
      {categories && purchase ? (
        <MultiSelect label="Segment" values={s.segments} onChange={s.setSegments} options={[...SEGMENTS.map((g) => ({ value: g.id as string, label: g.label })), { value: "none", label: "Not set in Zoho" }]} />
      ) : null}
      {search ? (
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2">
          <Search size={14} className="text-muted" aria-hidden />
          <input value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder="Product or SKU" aria-label="Search product or SKU" className="w-36 bg-transparent text-[13px] outline-none" />
        </div>
      ) : null}
      {active ? (
        <button onClick={s.resetFilters} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-2 hover:bg-sunken">
          <RotateCcw size={13} aria-hidden /> Clear filters
        </button>
      ) : null}
      {note ? <span className="text-[12px] text-muted">{note}</span> : null}
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}
