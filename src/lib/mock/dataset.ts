// Deterministic sample dataset, shaped like what the backend will sync from Zoho:
// products, locations, daily units sold per product per source (a source = one clinic or
// one online channel), stock per product per location, and open purchase orders.
// The same seed always produces the same numbers, so screenshots and tests are stable.

import { addDays } from "../dates";
import type { ChannelId, Location, Product, PurchaseOrder, Vendor } from "../domain/types";
import { CATALOG, CATEGORY_MIX, CHANNELS, CLINIC_WEIGHT, LOCATIONS, VENDORS, WAREHOUSE_ID } from "./catalog";

export const TODAY = "2026-11-14";
export const LAST_SYNCED_AT = "2026-11-14T11:02:00+05:30";
export const HISTORY_DAYS = 180;

export interface Source {
  id: string;
  channel: ChannelId;
  /** Clinic id for clinic sales; the warehouse for online channels (they ship from it). */
  locationId: string;
  label: string;
}

export interface Dataset {
  today: string;
  lastSyncedAt: string;
  /** HISTORY_DAYS dates, oldest → newest, ending today. */
  days: string[];
  products: Product[];
  vendors: Vendor[];
  locations: Location[];
  sources: Source[];
  /** qty[productIndex][sourceIndex][dayIndex] = units sold. */
  qty: Uint16Array[][];
  /** inStock[productIndex][dayIndex] = 0 when the product was out of stock everywhere that day. */
  inStock: Uint8Array[];
  /** stock[productId][locationId] = units on hand now. */
  stock: Record<string, Record<string, number>>;
  purchaseOrders: PurchaseOrder[];
}

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

/** Hair Serum's last 90 days, exactly the worked example (630 / 240 / 70). */
function hairSerumLast90(): number[] {
  const s: number[] = [];
  for (let i = 0; i < 60; i++) s.push(i < 30 ? 7 : 6);
  for (let i = 0; i < 23; i++) s.push(i < 9 ? 8 : 7);
  for (let i = 0; i < 7; i++) s.push(10);
  return s;
}

/** Products with a scripted story, so every status and rule shows up in the demo. */
const SCRIPT: Record<string, { stock?: number; cover?: number; warehouseShare?: number; launchedDaysAgo?: number; stockoutFrom?: number; stockoutDays?: number }> = {
  "GL-HAIRSER": { stock: 150, warehouseShare: 110 / 150 }, // the worked example → Low, order 308
  "GL-UVARMOR": { cover: 5, warehouseShare: 0.62 }, // Critical
  "GL-SEASUNS": { cover: 7, warehouseShare: 0.5 }, // would be Critical, rescued by an order landing in 4 days
  "GL-SPACREM": { stock: 500, warehouseShare: 0.84 }, // Overstock, ~320 excess
  "GL-BDYLOTN": { cover: 190, warehouseShare: 0.8 }, // Overstock
  "GL-MASCARA": { stock: 60, warehouseShare: 0.9 }, // No sales
  "GL-SAQMASK": { cover: 40, launchedDaysAgo: 18 }, // New product
  "GL-GLUTABT": { cover: 40, stockoutFrom: 26, stockoutDays: 5 }, // stock-out days left out of the rate
  "GL-VITCSRM": { cover: 18, warehouseShare: 0.55 }, // Low
  "GL-AGELOCK": { cover: 22, warehouseShare: 0.45 }, // Critical (30-day vendor)
  "GL-FGPLTTE": { cover: 140, warehouseShare: 0.9 }, // Overstock (makeup)
  "GL-HAIRGRO": { cover: 26, warehouseShare: 0.6 }, // Low-ish (15-day vendor)
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

/** Clinic-level imbalance for transfer suggestions: sku → { clinic: days of cover }. */
const CLINIC_COVER_OVERRIDE: Record<string, Record<string, number>> = {
  "GL-COLSERM": { "loc-chandigarh": 160, "loc-amritsar": 1, "loc-karnal": 2 },
  "GL-DAYCREM": { "loc-ludhiana": 150, "loc-gurugram": 1 },
  "GL-TTFACEW": { "loc-delhi": 140, "loc-delhi92": 1 },
};

let cached: Dataset | null = null;

export function getDataset(): Dataset {
  if (cached) return cached;
  const rand = mulberry32(20261114);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(TODAY, i - HISTORY_DAYS + 1));

  const clinics = LOCATIONS.filter((l) => l.kind === "clinic");
  const sources: Source[] = [
    ...clinics.map((c) => ({ id: `src-${c.id}`, channel: "clinic" as const, locationId: c.id, label: c.name })),
    ...CHANNELS.filter((c) => c.id !== "clinic").map((c) => ({ id: `src-${c.id}`, channel: c.id, locationId: WAREHOUSE_ID, label: c.label })),
  ];

  const products: Product[] = [];
  const qty: Uint16Array[][] = [];
  const inStock: Uint8Array[] = [];
  const stock: Record<string, Record<string, number>> = {};
  const purchaseOrders: PurchaseOrder[] = [];

  CATALOG.forEach((c, pi) => {
    const script = SCRIPT[c.sku] ?? {};
    const id = `zi-${(460000000 + pi * 7919).toString()}`;
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
    });

    // 1 · total units per day
    const growth = (rand() - 0.4) * 0.7; // −28% … +42% across the 180 days
    const totals: number[] = [];
    const flags = new Uint8Array(HISTORY_DAYS).fill(1);
    for (let d = 0; d < HISTORY_DAYS; d++) {
      if (d < launchedIdx) {
        totals.push(0);
        continue;
      }
      const t = d / HISTORY_DAYS;
      const weekday = new Date(`${days[d]}T00:00:00Z`).getUTCDay();
      const weekFactor = [0.78, 1.0, 1.02, 0.98, 1.04, 1.08, 1.12][weekday] ?? 1;
      const festive = days[d]! >= "2026-10-18" && days[d]! <= "2026-11-08" && (c.category === "Makeup" || c.category === "Wellness") ? 1.22 : 1;
      const lambda = c.baseRate * (1 + growth * (t - 0.5)) * weekFactor * festive;
      totals.push(poisson(rand, lambda));
    }
    if (c.sku === "GL-HAIRSER") {
      const last90 = hairSerumLast90();
      for (let i = 0; i < 90; i++) totals[HISTORY_DAYS - 90 + i] = last90[i]!;
    }
    if (script.stockoutFrom !== undefined) {
      for (let k = 0; k < (script.stockoutDays ?? 0); k++) {
        const d = HISTORY_DAYS - script.stockoutFrom + k;
        flags[d] = 0;
        totals[d] = 0;
      }
    }

    // 2 · split each day's units across sources
    const mix = CATEGORY_MIX[c.category] ?? [0.4, 0.2, 0.2, 0.1, 0.1];
    const probs: number[] = sources.map((s) => {
      if (s.channel === "clinic") return mix[0] * (CLINIC_WEIGHT[s.locationId] ?? 0);
      const ci = CHANNELS.findIndex((ch) => ch.id === s.channel);
      return mix[ci] ?? 0;
    });
    const jitter = probs.map((p) => p * (0.75 + rand() * 0.5));
    const sum = jitter.reduce((a, b) => a + b, 0);
    const cum: number[] = [];
    let acc = 0;
    for (const p of jitter) {
      acc += p / sum;
      cum.push(acc);
    }
    const perSource = sources.map(() => new Uint16Array(HISTORY_DAYS));
    for (let d = 0; d < HISTORY_DAYS; d++) {
      for (let u = 0; u < (totals[d] ?? 0); u++) {
        const r = rand();
        let si = cum.findIndex((x) => r <= x);
        if (si < 0) si = sources.length - 1;
        perSource[si]![d]!++;
      }
    }
    qty.push(perSource);
    inStock.push(flags);

    // 3 · stock now — sized from the recent rate so statuses are believable
    const recent = totals.slice(-30).reduce((a, b) => a + b, 0) / 30 || c.baseRate;
    const roll = rand();
    const defaultCover = roll < 0.12 ? 14 + rand() * 8 : roll < 0.2 ? 100 + rand() * 60 : 32 + rand() * 50;
    const total = script.stock ?? Math.round(recent * (script.cover ?? defaultCover));
    const whShare = script.warehouseShare ?? 0.55 + rand() * 0.15;
    const wh = Math.round(total * whShare);
    const perLoc: Record<string, number> = { [WAREHOUSE_ID]: wh };
    let remaining = total - wh;
    clinics.forEach((cl, ci) => {
      const share = CLINIC_WEIGHT[cl.id] ?? 0.1;
      const q = ci === clinics.length - 1 ? remaining : Math.min(remaining, Math.round((total - wh) * share * (0.7 + rand() * 0.6)));
      perLoc[cl.id] = Math.max(0, q);
      remaining -= Math.max(0, q);
    });
    const override = CLINIC_COVER_OVERRIDE[c.sku];
    if (override) {
      for (const [locId, cover] of Object.entries(override)) {
        const si = sources.findIndex((s) => s.locationId === locId && s.channel === "clinic");
        const clinicRecent = perSource[si]!.slice(-30).reduce((a, b) => a + b, 0) / 30;
        perLoc[locId] = Math.max(1, Math.round(Math.max(clinicRecent, 0.25) * cover));
      }
    }
    stock[id] = perLoc;

    const po = OPEN_POS[c.sku];
    if (po) {
      purchaseOrders.push({
        id: `PO-${String(2600 + purchaseOrders.length * 7)}`,
        productId: id,
        vendorId: c.vendorId,
        qty: po[0],
        orderedOn: addDays(TODAY, -po[1]),
        expectedOn: addDays(TODAY, po[2]),
      });
    }
  });

  cached = {
    today: TODAY,
    lastSyncedAt: LAST_SYNCED_AT,
    days,
    products,
    vendors: VENDORS,
    locations: LOCATIONS,
    sources,
    qty,
    inStock,
    stock,
    purchaseOrders,
  };
  return cached;
}
