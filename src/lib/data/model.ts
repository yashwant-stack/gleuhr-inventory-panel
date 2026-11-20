// The panel's data model, shared by the sample data and the real backend.
//
// Two facts from the 14 Nov check (docs/ZOHO_STOCK_FINDINGS.md) shape it:
//  1. SALES are split by channel. That split exists only in the CRM database (clinic sale,
//     online-team order, Shopify website order); Zoho cannot tell channels apart.
//  2. STOCK exists per Zoho location only. Every channel takes stock out of the location it
//     ships from, so a location's usage = the sum of the channels that ship from it.
//
// A "source" joins the two: one channel selling out of one location (and, for clinic sales
// and online clinic pickups, one CRM clinic). Every daily figure is kept per product × source.

import type { ChannelId, Location, Product, PurchaseOrder, Vendor } from "../domain/types";

/** A clinic as the CRMs know it. Its stock changes are posted to Zoho at its Zoho location. */
export interface CrmClinic {
  id: string;
  name: string;
  active: boolean;
  /** null = not linked to a Zoho location: Zoho then books its stock changes on the primary location. */
  zohoLocationId: string | null;
}

export interface Source {
  id: string;
  channel: ChannelId;
  /** The Zoho location the stock comes out of. */
  locationId: string;
  /** The CRM clinic behind clinic sales and online clinic pickups / Rapido; null for warehouse dispatch. */
  clinicId: string | null;
  label: string;
  /** The day this sales point began recording sales (live data: clinics joined the CRM on different days). Absent = its channel's first day. */
  dataFrom?: string | null;
}

export interface ChannelInfo {
  id: ChannelId;
  label: string;
  short: string;
  /** false = no data reaches the panel for this channel yet. */
  connected: boolean;
  /** First day with data, or null when not connected. */
  dataFrom: string | null;
  /** Plain-words reason when not connected. */
  note?: string;
}

export interface PushHealth {
  locationName: string;
  failed: number;
  firstFailed: string | null;
  lastFailed: string | null;
  topError: string;
}

export interface DataHealth {
  /** When these checks were last made. */
  checkedAt: string;
  unmappedClinics: { clinicId: string; name: string; landsOn: string }[];
  unreadableLocations: { locationId: string; name: string }[];
  /** CRM stock changes Zoho refused (last 30 days). */
  failedPushes: PushHealth[];
  /** What the Zoho login may read. */
  zohoAccess: { area: string; ok: boolean; note: string }[];
  /** CRM products whose sales are left out of every page, and why (active ones, or any sold in the last 90 days). */
  leftOutProducts: LeftOutProduct[];
  /** Active Zoho items that no CRM sells: not planned here. null = not counted (sample mode). */
  zohoOnlyItems: number | null;
  lastSync: { job: string; at: string | null; ok: boolean; note: string }[];
  /** Reorder alerts by email / WhatsApp (live only): which channels are set up, and what was sent. */
  alerts?: AlertsHealth | null;
}

export interface AlertsHealth {
  email: boolean;
  whatsapp: boolean;
  /** Setting names still missing per channel (Vercel → Settings → Environment Variables). */
  missing: { email: string[]; whatsapp: string[] };
  repeatDays: number;
  log: { at: string; channel: "email" | "whatsapp"; recipients: string[]; status: string; summary: string; error: string | null }[];
}

export interface LeftOutProduct {
  name: string;
  reason: string;
  /** Units sold in the last 90 days (sales only, before returns). */
  unitsSold90d: number;
  lastSale: string | null;
}

export interface Dataset {
  /** "sample" until the backend is connected, then "live". */
  origin: "sample" | "live";
  today: string;
  lastSyncedAt: string;
  /** Dates oldest → newest, ending today. */
  days: string[];
  products: Product[];
  vendors: Vendor[];
  locations: Location[];
  clinics: CrmClinic[];
  channels: ChannelInfo[];
  sources: Source[];
  /** Net units sold per day (sales minus returns): [product][source][day]. */
  sold: Int32Array[][];
  /** Net sales value per day in ₹ (line price after line discount): [product][source][day]. */
  value: Float64Array[][];
  /** Net units used per day (sold + free samples + exchanges): drives stock planning. */
  used: Int32Array[][];
  /** 1 = in stock that day, 0 = out of stock everywhere (left out of the daily rate). Absent = unknown. */
  inStock?: Uint8Array[];
  /** stock[productId][locationId]; null = this location cannot be read. */
  stock: Record<string, Record<string, number | null>>;
  purchaseOrders: PurchaseOrder[];
  /** false = the Zoho login cannot read purchase orders yet (stock on the way unknown). */
  purchaseOrdersAvailable: boolean;
  health: DataHealth;
}

// ── wire format (JSON) ────────────────────────────────────────────────────────

/** Only non-zero days travel: [dayIndex, sold, value, used] per product × source. */
export type WireCells = [number, number, number, number][];

export interface DatasetWire extends Omit<Dataset, "sold" | "value" | "used" | "inStock"> {
  cells: Record<string, WireCells>; // key `${productIndex}:${sourceIndex}`
  inStock?: number[][];
}

export function encodeDataset(ds: Dataset): DatasetWire {
  const { sold, value, used, inStock, ...rest } = ds;
  const cells: Record<string, WireCells> = {};
  ds.products.forEach((_, pi) => {
    ds.sources.forEach((_, si) => {
      const out: WireCells = [];
      const s = sold[pi]![si]!;
      const v = value[pi]![si]!;
      const u = used[pi]![si]!;
      for (let d = 0; d < ds.days.length; d++) {
        if (s[d] || v[d] || u[d]) out.push([d, s[d]!, Math.round(v[d]! * 100) / 100, u[d]!]);
      }
      if (out.length) cells[`${pi}:${si}`] = out;
    });
  });
  return { ...rest, cells, inStock: inStock?.map((a) => Array.from(a)) };
}

export function decodeDataset(w: DatasetWire): Dataset {
  const n = w.days.length;
  const sold = w.products.map(() => w.sources.map(() => new Int32Array(n)));
  const value = w.products.map(() => w.sources.map(() => new Float64Array(n)));
  const used = w.products.map(() => w.sources.map(() => new Int32Array(n)));
  for (const [key, list] of Object.entries(w.cells)) {
    const [pi, si] = key.split(":").map(Number) as [number, number];
    for (const [d, s, v, u] of list) {
      sold[pi]![si]![d] = s;
      value[pi]![si]![d] = v;
      used[pi]![si]![d] = u;
    }
  }
  const { cells: _cells, inStock, ...rest } = w;
  return { ...rest, sold, value, used, inStock: inStock?.map((a) => Uint8Array.from(a)) };
}

/** Product × location pairs where Zoho reports stock below zero (stock went out before Zoho recorded it coming in). */
export function belowZeroStock(ds: Dataset): { productId: string; product: string; location: string; qty: number }[] {
  const out: { productId: string; product: string; location: string; qty: number }[] = [];
  for (const p of ds.products)
    for (const l of ds.locations) {
      const q = ds.stock[p.id]?.[l.id];
      if (q !== null && q !== undefined && q < 0) out.push({ productId: p.id, product: p.name, location: l.name, qty: q });
    }
  return out.sort((a, b) => a.qty - b.qty);
}

export function connectedChannels(ds: Dataset): ChannelId[] {
  return ds.channels.filter((c) => c.connected).map((c) => c.id);
}

export function primaryLocation(ds: Dataset) {
  return ds.locations.find((l) => l.isPrimary) ?? ds.locations[0]!;
}

/** "clinic:<id>" for clinic sales and clinic pickups, "loc:<zoho location>" for warehouse dispatch. */
export function salesPointId(s: Source): string {
  return s.clinicId ? `clinic:${s.clinicId}` : `loc:${s.locationId}`;
}
