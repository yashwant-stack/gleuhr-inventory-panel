// Deterministic SAMPLE data in the real shape (docs/ZOHO_STOCK_FINDINGS.md): the 16 Zoho locations,
// the CRM clinics and how each posts to Zoho, sales per channel per source, stock per location
// (unknown where Zoho refuses the read), and the data-health findings of 14 Nov 2026.
// The same seed always produces the same numbers, so screenshots and tests are stable.

import { addDays, diffDays } from "../dates";
import type { ChannelId, Product, PurchaseOrder } from "../domain/types";
import type { ChannelInfo, Dataset, DataHealth, Source } from "../data/model";
import {
  CATALOG,
  CATEGORY_MIX,
  CHANNELS,
  CLINIC_WEIGHT,
  DELHI_LOCATION_ID,
  PICKUP_CLINICS,
  PRIMARY_LOCATION_ID,
  SAMPLE_CLINICS,
  SAMPLE_LOCATIONS,
  SAMPLE_PRICE_FACTOR,
  VENDORS,
} from "./catalog";

export const TODAY = "2026-11-14";
export const LAST_SYNCED_AT = "2026-11-14T11:02:00+05:30";
export const HISTORY_DAYS = 180;

/** First day each channel has data (as in the CRMs: online orders from 22 Jul, Shopify intake from 2 Aug, clinic sales from 28 Aug). */
const DATA_FROM: Record<ChannelId, string | null> = {
  clinic: "2026-08-28",
  online_team: "2026-07-22",
  website: "2026-08-02",
  amazon: null,
  flipkart: null,
};

// ── seeded random ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L && k < 200);
  return k - 1;
}

/** Hair Serum's last 90 days, exactly the worked example (630 / 240 / 70), sold only online. */
function hairSerumLast90(): number[] {
  const s: number[] = [];
  for (let i = 0; i < 60; i++) s.push(i < 30 ? 7 : 6);
  for (let i = 0; i < 23; i++) s.push(i < 9 ? 8 : 7);
  for (let i = 0; i < 7; i++) s.push(10);
  return s;
}

interface Script {
  stock?: number;
  cover?: number;
  warehouseShare?: number;
  launchedDaysAgo?: number;
  stockoutFrom?: number;
  stockoutDays?: number;
  /** Exact stock per location (overrides the spread). */
  at?: Record<string, number>;
}

/** Products with a scripted story, so every status and rule shows up in the demo. */
const SCRIPT: Record<string, Script> = {
  "GL-HAIRSER": { at: { "z-mohali": 110, "z-delhi": 40 } }, // the worked example → Low, order 308
  "GL-UVARMOR": { cover: 5, warehouseShare: 0.62 }, // Critical
  "GL-SEASUNS": { cover: 7, warehouseShare: 0.5 }, // would be Critical, rescued by an order landing in 4 days
  "GL-SPACREM": { stock: 500, warehouseShare: 0.84 }, // Overstock
  "GL-BDYLOTN": { cover: 190, warehouseShare: 0.8 }, // Overstock
  "GL-MASCARA": { stock: 60, warehouseShare: 0.9 }, // No sales
  "GL-SAQMASK": { cover: 40, launchedDaysAgo: 18 }, // New product
  "GL-GLUTABT": { cover: 40, stockoutFrom: 26, stockoutDays: 5 }, // a stock-out stretch (counts as 0 sales in the 60-day rate)
  "GL-VITCSRM": { cover: 18, warehouseShare: 0.55 }, // Low
  "GL-AGELOCK": { cover: 22, warehouseShare: 0.45 }, // Critical (30-day vendor)
  "GL-FGPLTTE": { cover: 140, warehouseShare: 0.9 }, // Overstock (makeup)
  "GL-HAIRGRO": { cover: 26, warehouseShare: 0.6 }, // Low-ish
};

/** Open purchase orders: sku → [qty, ordered days ago, arrives in days]. */
const OPEN_POS: Record<string, [number, number, number]> = {
  "GL-SEASUNS": [300, 11, 4],
  "GL-GLOWFOR": [480, 20, 10],
  "GL-COLSERM": [120, 3, 12],
  "GL-MOUSCLE": [240, 9, 6],
  "GL-HAIRSHM": [144, 6, 9],
  "GL-PCOS": [144, 18, 12],
};

/** Clinic imbalance for transfer / send-to-clinic suggestions: sku → { location: days of cover }. */
const LOCATION_COVER_OVERRIDE: Record<string, Record<string, number>> = {
  "GL-COLSERM": { "z-chandigarh": 160, "z-amritsar": 1, "z-karnal": 2 },
  "GL-DAYCREM": { "z-ludhiana": 150, "z-gurugram": 1 },
  "GL-TTFACEW": { "z-delhi": 140, "z-jalandhar": 1 },
  "GL-VITCSRM": { "z-chandigarh": 2, "z-jalandhar": 3 },
};

export function sampleSources(): Source[] {
  const out: Source[] = [];
  for (const c of SAMPLE_CLINICS.filter((c) => c.active)) {
    const loc = c.zohoLocationId ?? PRIMARY_LOCATION_ID;
    out.push({ id: `clinic-${c.id}`, channel: "clinic", locationId: loc, clinicId: c.id, label: c.zohoLocationId ? c.name : `${c.name} (booked on Mohali)` });
  }
  out.push({ id: "online-mohali", channel: "online_team", locationId: PRIMARY_LOCATION_ID, clinicId: null, label: "Online team · Mohali dispatch" });
  out.push({ id: "online-delhi", channel: "online_team", locationId: DELHI_LOCATION_ID, clinicId: null, label: "Online team · Delhi dispatch" });
  for (const id of PICKUP_CLINICS) {
    const c = SAMPLE_CLINICS.find((x) => x.id === id)!;
    out.push({ id: `online-pickup-${id}`, channel: "online_team", locationId: c.zohoLocationId!, clinicId: id, label: `Online team · ${c.name} pickup / Rapido` });
  }
  out.push({ id: "web-mohali", channel: "website", locationId: PRIMARY_LOCATION_ID, clinicId: null, label: "Website · Mohali dispatch" });
  out.push({ id: "web-delhi", channel: "website", locationId: DELHI_LOCATION_ID, clinicId: null, label: "Website · Delhi dispatch" });
  return out;
}

/** Share of a channel's units each of its sources takes. */
function sourceWeights(sources: Source[]): number[] {
  return sources.map((s) => {
    if (s.channel === "clinic") return CLINIC_WEIGHT[s.clinicId ?? ""] ?? 0.03;
    if (s.channel === "online_team") return s.id === "online-mohali" ? 0.84 : s.id === "online-delhi" ? 0.06 : 0.1 / PICKUP_CLINICS.length;
    if (s.channel === "website") return s.id === "web-mohali" ? 0.92 : 0.08;
    return 0;
  });
}

export const SAMPLE_HEALTH: DataHealth = {
  checkedAt: "2026-11-15T12:00:00+05:30",
  unmappedClinics: [
    { clinicId: "10", name: "Delhi East", landsOn: "Mohali - Warehouse" },
    { clinicId: "46", name: "Pune", landsOn: "Mohali - Warehouse" },
  ],
  unreadableLocations: SAMPLE_LOCATIONS.filter((l) => !l.readable).map((l) => ({ locationId: l.id, name: l.name })),
  failedPushes: [
    { locationName: "Mumbai", failed: 1119, firstFailed: "2026-10-15", lastFailed: "2026-11-14", topError: "No access to this Zoho location" },
    { locationName: "Ahmedabad", failed: 663, firstFailed: "2026-10-15", lastFailed: "2026-11-13", topError: "No access to this Zoho location" },
    { locationName: "Chandigarh", failed: 140, firstFailed: "2026-10-22", lastFailed: "2026-11-14", topError: "Zoho: not authorized (code 57)" },
    { locationName: "Mohali - Warehouse", failed: 135, firstFailed: "2026-10-15", lastFailed: "2026-11-14", topError: "Zoho: not authorized (code 57)" },
    { locationName: "Amritsar", failed: 84, firstFailed: "2026-10-23", lastFailed: "2026-11-14", topError: "Zoho: not authorized (code 57)" },
    { locationName: "Jalandhar", failed: 83, firstFailed: "2026-10-22", lastFailed: "2026-11-13", topError: "Zoho: not authorized (code 57)" },
    { locationName: "Delhi", failed: 55, firstFailed: "2026-10-23", lastFailed: "2026-11-14", topError: "Zoho: not authorized (code 57)" },
    { locationName: "Karnal", failed: 53, firstFailed: "2026-10-15", lastFailed: "2026-11-13", topError: "Zoho: not authorized (code 57)" },
  ],
  zohoAccess: [
    { area: "Locations", ok: true, note: "All 16 listed" },
    { area: "Stock per location", ok: true, note: "11 of 16 locations; 5 refused (no location permission)" },
    { area: "Items", ok: true, note: "197 items" },
    { area: "Stock adjustments", ok: true, note: "How the CRMs post every sale" },
    { area: "Sales orders", ok: false, note: "Not authorized" },
    { area: "Invoices", ok: false, note: "Not authorized" },
    { area: "Transfer orders", ok: false, note: "Not authorized (warehouse → clinic moves)" },
    { area: "Purchase orders", ok: false, note: "Not checked yet: stock on the way needs it" },
  ],
  // Read-only check of the CRM database, 15 Nov 2026: 13 of the CRMs' 55 products have no Zoho item.
  // Listed: the active ones and any sold in the last 90 days (Vitamin C Serum is neither).
  leftOutProducts: [
    ["Blemishes Pigmentation facial Treatment kit", 360, "2026-11-11"],
    ["Age Lock Facial Treatment Kit", 47, "2026-10-19"],
    ["Holistic Skin Plan 1 Month", 17, "2026-11-04"],
    ["Purifying Acne Facial Treatment Kit", 12, "2026-10-17"],
    ["Holistic Skin Plan 3 Month", 5, "2026-10-19"],
    ["Hair Spa kit", 4, "2026-09-19"],
    ["Holistic Skin Plan 6 Month", 3, "2026-11-06"],
    ["Holistic Skin Plan 2 Month", 1, "2026-09-28"],
    ["Holistic Skin Plan 4 Month", 1, "2026-09-28"],
    ["Holistic Skin Plan 12 Month", 0, null],
    ["Holistic Skin Plan 8 Month", 0, null],
    ["Jet Black Magic Waterproof & Smudgeproof Mascara", 0, "2026-08-10"],
  ].map(([name, units, last]) => ({ name: name as string, reason: "No Zoho item linked in the CRM", unitsSold90d: units as number, lastSale: last as string | null })),
  zohoOnlyItems: null,
  lastSync: [
    { job: "Zoho stock", at: LAST_SYNCED_AT, ok: true, note: "Sample" },
    { job: "CRM sales", at: LAST_SYNCED_AT, ok: true, note: "Sample" },
  ],
};

let cached: Dataset | null = null;

export function getDataset(): Dataset {
  if (cached) return cached;
  const rand = mulberry32(20261114);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(TODAY, i - HISTORY_DAYS + 1));
  const sources = sampleSources();
  const weights = sourceWeights(sources);
  const channels: ChannelInfo[] = CHANNELS.map((c) => ({
    ...c,
    connected: DATA_FROM[c.id] !== null,
    dataFrom: DATA_FROM[c.id],
    note: DATA_FROM[c.id] === null ? "Not in the clinic or online CRM, and no Zoho location. Tell us how these orders are recorded to connect them." : undefined,
  }));
  const fromIdx: Record<string, number> = {};
  for (const c of channels) fromIdx[c.id] = c.dataFrom ? Math.max(0, diffDays(c.dataFrom, days[0]!)) : HISTORY_DAYS;

  const products: Product[] = [];
  const sold: Int32Array[][] = [];
  const value: Float64Array[][] = [];
  const used: Int32Array[][] = [];
  const inStock: Uint8Array[] = [];
  const stock: Record<string, Record<string, number | null>> = {};
  const purchaseOrders: PurchaseOrder[] = [];

  CATALOG.forEach((c, pi) => {
    const script = SCRIPT[c.sku] ?? {};
    const id = `zi-${(4006255000000100000 + pi * 7919).toString()}`;
    const launchedIdx = script.launchedDaysAgo !== undefined ? HISTORY_DAYS - script.launchedDaysAgo : 0;
    products.push({
      id,
      sku: c.sku,
      name: c.name,
      category: c.category,
      price: c.price,
      cost: Math.round(c.price * 0.3),
      vendorId: c.vendorId,
      leadTimeOverride: c.sku === "GL-AGELOCK" ? 30 : null,
      packSize: c.packSize,
      launchedOn: days[launchedIdx] ?? TODAY,
      soldInCrm: true,
    });

    const flags = new Uint8Array(HISTORY_DAYS).fill(1);
    if (script.stockoutFrom !== undefined) {
      for (let k = 0; k < (script.stockoutDays ?? 0); k++) flags[HISTORY_DAYS - script.stockoutFrom + k] = 0;
    }
    const mix = CATEGORY_MIX[c.category] ?? [0.45, 0.4, 0.15];
    const chShare: Record<ChannelId, number> = { clinic: mix[0], online_team: mix[1], website: mix[2], amazon: 0, flipkart: 0 };
    if (c.sku === "GL-HAIRSER") Object.assign(chShare, { clinic: 0, online_team: 1, website: 0 });
    const growth = (rand() - 0.4) * 0.7;

    const s = sources.map(() => new Int32Array(HISTORY_DAYS));
    const v = sources.map(() => new Float64Array(HISTORY_DAYS));
    const u = sources.map(() => new Int32Array(HISTORY_DAYS));
    const serum = c.sku === "GL-HAIRSER" ? hairSerumLast90() : null;

    for (const ch of ["clinic", "online_team", "website"] as ChannelId[]) {
      if (chShare[ch] <= 0) continue;
      const idx = sources.map((src, i) => (src.channel === ch ? i : -1)).filter((i) => i >= 0);
      const w = idx.map((i) => weights[i]!);
      const wSum = w.reduce((a, b) => a + b, 0);
      for (let d = Math.max(fromIdx[ch]!, launchedIdx); d < HISTORY_DAYS; d++) {
        if (!flags[d]) continue;
        let units: number;
        if (serum) {
          units = d >= HISTORY_DAYS - 90 ? serum[d - (HISTORY_DAYS - 90)]! : 6;
        } else {
          const t = d / HISTORY_DAYS;
          const weekday = new Date(`${days[d]}T00:00:00Z`).getUTCDay();
          const weekFactor = [0.78, 1.0, 1.02, 0.98, 1.04, 1.08, 1.12][weekday] ?? 1;
          const festive = days[d]! >= "2026-10-18" && days[d]! <= "2026-11-08" && (c.category === "Makeup" || c.category === "Wellness") ? 1.22 : 1;
          units = poisson(rand, c.baseRate * chShare[ch] * (1 + growth * (t - 0.5)) * weekFactor * festive);
        }
        for (let k = 0; k < units; k++) {
          let r = rand() * wSum;
          let pick = idx[idx.length - 1]!;
          for (let j = 0; j < idx.length; j++) {
            r -= w[j]!;
            if (r <= 0) {
              pick = idx[j]!;
              break;
            }
          }
          const price = c.price * SAMPLE_PRICE_FACTOR[ch];
          s[pick]![d]! += 1;
          u[pick]![d]! += 1;
          v[pick]![d]! += price;
          if (serum) continue;
          if (ch === "clinic" && rand() < 0.05) u[pick]![d]! += 1; // a free sample goes with it
          if (ch !== "clinic" && rand() < 0.04 && d + 7 < HISTORY_DAYS) {
            // returned a week later (RTO): stock comes back, the sale is reversed
            s[pick]![d + 7]! -= 1;
            u[pick]![d + 7]! -= 1;
            v[pick]![d + 7]! -= price;
          }
        }
      }
    }
    sold.push(s);
    value.push(v);
    used.push(u);
    inStock.push(flags);

    // stock now, per location — sized from each location's recent usage so statuses are believable
    const rate30 = (si: number) => u[si]!.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const locRate: Record<string, number> = {};
    sources.forEach((src, si) => (locRate[src.locationId] = (locRate[src.locationId] ?? 0) + rate30(si)));
    const network = Object.values(locRate).reduce((a, b) => a + b, 0) || c.baseRate;
    const roll = rand();
    const defaultCover = roll < 0.12 ? 14 + rand() * 8 : roll < 0.2 ? 100 + rand() * 60 : 32 + rand() * 50;
    const perLoc: Record<string, number | null> = {};
    if (script.at) {
      for (const l of SAMPLE_LOCATIONS) perLoc[l.id] = l.readable ? (script.at[l.id] ?? 0) : null;
    } else {
      const total = script.stock ?? Math.round(network * (script.cover ?? defaultCover));
      const wh = Math.round(total * (script.warehouseShare ?? 0.6 + rand() * 0.15));
      let rest = total - wh;
      const readableClinics = SAMPLE_LOCATIONS.filter((l) => l.readable && l.kind !== "warehouse");
      const share = readableClinics.map((l) => (locRate[l.id] ?? 0) + 0.05);
      const shareSum = share.reduce((a, b) => a + b, 0);
      for (const l of SAMPLE_LOCATIONS) perLoc[l.id] = l.readable ? 0 : null;
      perLoc[PRIMARY_LOCATION_ID] = wh;
      readableClinics.forEach((l, i) => {
        const q = i === readableClinics.length - 1 ? rest : Math.min(rest, Math.round(((total - wh) * share[i]!) / shareSum * (0.7 + rand() * 0.6)));
        perLoc[l.id] = Math.max(0, q);
        rest -= Math.max(0, q);
      });
    }
    for (const [locId, cover] of Object.entries(LOCATION_COVER_OVERRIDE[c.sku] ?? {})) {
      if (perLoc[locId] !== null) perLoc[locId] = Math.max(0, Math.round(Math.max(locRate[locId] ?? 0, 0.25) * cover));
    }
    stock[id] = perLoc;

    const po = OPEN_POS[c.sku];
    if (po) {
      purchaseOrders.push({ id: `PO-${String(2600 + purchaseOrders.length * 7)}`, productId: id, vendorId: c.vendorId, qty: po[0], orderedOn: addDays(TODAY, -po[1]), expectedOn: addDays(TODAY, po[2]) });
    }
  });

  cached = {
    origin: "sample",
    today: TODAY,
    lastSyncedAt: LAST_SYNCED_AT,
    days,
    products,
    vendors: VENDORS,
    locations: SAMPLE_LOCATIONS,
    clinics: SAMPLE_CLINICS,
    channels,
    sources,
    sold,
    value,
    used,
    inStock,
    stock,
    purchaseOrders,
    purchaseOrdersAvailable: true,
    health: SAMPLE_HEALTH,
  };
  return cached;
}
