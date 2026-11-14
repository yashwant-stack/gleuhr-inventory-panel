"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { ChannelId } from "@/lib/domain/types";
import { CATALOG, CHANNELS, LOCATIONS } from "@/lib/mock/catalog";
import { usePanel } from "@/lib/state/store";
import { DateRange } from "./DateRange";
import { MultiSelect } from "./Select";
import { ChannelDot } from "./ui";

const CATEGORIES = [...new Set(CATALOG.map((c) => c.category))];

/** One row of filters above the content. Each page shows only the filters that apply to it. */
export function FilterBar({
  date = true,
  channels = true,
  locations = true,
  categories = true,
  search = true,
  note,
  right,
}: {
  date?: boolean;
  channels?: boolean;
  locations?: boolean;
  categories?: boolean;
  search?: boolean;
  note?: ReactNode;
  right?: ReactNode;
}) {
  const s = usePanel();
  const active = s.channels.length + s.locations.length + s.categories.length + (s.search ? 1 : 0) > 0;
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      {date ? <DateRange /> : null}
      {channels ? (
        <MultiSelect<ChannelId>
          label="Channel"
          values={s.channels}
          onChange={s.setChannels}
          options={CHANNELS.map((c) => ({ value: c.id, label: c.label, icon: <ChannelDot channel={c.id} /> }))}
        />
      ) : null}
      {locations ? (
        <MultiSelect
          label="Location"
          values={s.locations}
          onChange={s.setLocations}
          options={LOCATIONS.map((l) => ({ value: l.id, label: l.name, group: l.kind === "warehouse" ? "Warehouse (online orders ship from here)" : "Clinics" }))}
        />
      ) : null}
      {categories ? <MultiSelect label="Category" values={s.categories} onChange={s.setCategories} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /> : null}
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
