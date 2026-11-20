// Shared shapes for the panel. These mirror what the backend will later read from
// Zoho Inventory (items, locations, stock per location, sales lines, purchase orders),
// so the screens do not change when sample data is swapped for real data.

export type ChannelId = "clinic" | "online_team" | "amazon" | "flipkart" | "website";

export type LocationKind = "warehouse" | "clinic" | "darkstore";

/** A Zoho Inventory location: the place stock physically sits. Zoho counts stock per location, never per channel. */
export interface Location {
  /** Zoho location_id. */
  id: string;
  name: string;
  kind: LocationKind;
  /** Zoho's primary location: an adjustment sent without a location lands here. */
  isPrimary: boolean;
  /** false when the Zoho login is not allowed to read this location (its stock is unknown, never 0). */
  readable: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  /** Default days from placing an order to stock arriving. */
  leadTimeDays: number;
}

export interface Product {
  /** Zoho item_id. */
  id: string;
  sku: string;
  name: string;
  category: string;
  /** Selling price per unit (₹). Catalogue prices are provisional data, not code. */
  price: number;
  /** Purchase cost per unit (₹), used for order value. */
  cost: number;
  vendorId: string;
  /** Product-level lead time override; null = use the vendor's. */
  leadTimeOverride: number | null;
  /** Units per carton / minimum order step. 1 = no rounding. */
  packSize: number;
  /** First sale date (yyyy-mm-dd); products with < 30 days of history are flagged "New". */
  launchedOn: string;
  /** Sold through the clinic or online CRM (false = a Zoho item the CRMs never sell, e.g. a consumable). */
  soldInCrm: boolean;
  /** Day Regime / Night Regime / Wellness, from the Zoho item's segment field (null = not set in Zoho yet). */
  segment?: Segment | null;
  /** true = Zoho has no real purchase price, so `cost` is the fallback share of the selling price. */
  costEstimated?: boolean;
}

/** The three product segments (decided 20 Nov 2026), read from a field on each Zoho item. */
export type Segment = "day" | "night" | "wellness";
export const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "day", label: "Day Regime" },
  { id: "night", label: "Night Regime" },
  { id: "wellness", label: "Wellness (edibles)" },
];

/** Reads a segment from free text (a Zoho field value or category): "Day regime", "NIGHT", "Wellness / edible"… */
export function parseSegment(v: unknown): Segment | null {
  const s = String(v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/\bnight/.test(s)) return "night";
  if (/\bday\b|day[\s-]*regime/.test(s)) return "day";
  if (/wellness|edible|nutrition|supplement/.test(s)) return "wellness";
  return null;
}

export interface PurchaseOrder {
  id: string;
  productId: string;
  vendorId: string;
  qty: number;
  orderedOn: string;
  expectedOn: string;
}

export type StockStatus = "critical" | "low" | "healthy" | "overstock" | "no_sales";

export interface FormulaSettings {
  /** Days in the rolling sales window: per day = sales of the last N days ÷ N (decided 17 Nov 2026: 60). */
  rateWindowDays: number;
  /** Order when the stock left falls to this many days of sales (decided 20 Nov 2026: 150). */
  reorderAtDays: number;
  /** Safety stock added to every purchase order, in days of sales (decided 20 Nov 2026: 90). */
  purchaseSafetyDays: number;
  /** Extra days of a clinic's own usage kept when topping clinics up from the warehouse. */
  safetyDays: number;
  overstockDays: number;
  defaultCoverDays: number;
  useTrendFactor: boolean;
  trendCapPct: number;
  gapFlagPct: number;
  transferHighDays: number;
  transferLowDays: number;
  /** Days for stock sent from the warehouse to reach a clinic. */
  replenishLeadDays: number;
  /** How many days of a clinic's own usage each send-to-clinic covers. */
  replenishCoverDays: number;
  /** Unused (empty) bottle stock at cost, ₹, entered by Management; 0 = not entered yet (decided 20 Nov 2026). */
  unusedBottleValue: number;
}

export const DEFAULT_FORMULA_SETTINGS: FormulaSettings = {
  rateWindowDays: 60,
  reorderAtDays: 150,
  purchaseSafetyDays: 90,
  safetyDays: 7,
  // above the highest normal stock (≈150 days just before an order), so a planned stock isn't "overstock"
  overstockDays: 180,
  defaultCoverDays: 45,
  useTrendFactor: false,
  trendCapPct: 25,
  gapFlagPct: 20,
  transferHighDays: 60,
  transferLowDays: 7,
  replenishLeadDays: 3,
  replenishCoverDays: 15,
  unusedBottleValue: 0,
};

export const LEAD_TIME_OPTIONS = [7, 15, 30, 60, 90] as const;
export const COVER_OPTIONS = [7, 15, 30, 45, 60, 90] as const;

/** Lead time for a product whose vendor has none set (decided 17 Nov 2026: 60 days). */
export const DEFAULT_LEAD_DAYS = 60;
export const PROJECTION_HORIZONS = [7, 15, 30, 60, 90] as const;
