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
  /** Zoho's Type Regimen text as typed (e.g. "Day regimen, after lunch"); null = empty in Zoho. */
  regimenRaw?: string | null;
}

/** The three product segments (decided 20 Nov 2026), read from a field on each Zoho item. */
export type Segment = "day" | "night" | "wellness";
export const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "day", label: "Day Regime" },
  { id: "night", label: "Night Regime" },
  { id: "wellness", label: "Wellness (edibles)" },
];

/** Reads a segment from free text (a Zoho field value or category): "Day regime", "NIGHT", "Wellness / edible"… */
/**
 * Zoho's "Type Regimen" field → the product's regimen (decided 20 Nov 2026, the founder's rule):
 *   "anytime" → Wellness · "night" → Night Regime · any other value ("day regimen", "after lunch",
 *   "Day regimen, after lunch/breakfast" …) → Day Regime. Empty → null ("Not set in Zoho").
 *   Two or three in one field → the one with the longest day limit: the bigger target (then trigger) of its
 *   purchase rule, so Night (back to 180) beats Day and Wellness (150); Day vs Wellness tie → Wellness.
 */
export function parseSegment(v: unknown, s: FormulaSettings = DEFAULT_FORMULA_SETTINGS): Segment | null {
  const t = String(v ?? "").toLowerCase().trim();
  if (!t) return null;
  if (t === "day" || t === "night" || t === "wellness") return t; // the panel's own stored value
  const found: Segment[] = [];
  if (/\bany\s*-?\s*time\b|wellness/.test(t)) found.push("wellness");
  if (/night/.test(t)) found.push("night");
  if (/\bday\b|day\s*regim|lunch|breakfast|morning/.test(t) || !found.length) found.push("day");
  const rank = (g: Segment) => {
    const r = purchaseRule(g, s);
    // tie order: night, then wellness, then day
    return r.coverDays * 1e6 + r.reorderAtDays * 1e3 + (g === "night" ? 2 : g === "wellness" ? 1 : 0);
  };
  return found.sort((a, b) => rank(b) - rank(a))[0]!;
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
  /** Safety stock added to every purchase order, in days of sales (decided 20 Nov 2026: 90). Products with no regimen only. */
  purchaseSafetyDays: number;
  /**
   * Per-regimen purchase rules (decided 20 Nov 2026, second answer): order when the stock left falls to the trigger,
   * and order enough that the stock is back at the target on the day the order arrives:
   *   Order = rate × (lead time + target days) − stock − on the way.
   * Night Regime: at 150 days, back to 180. Day Regime and Wellness: at 120 days, back to 150.
   * With a 60-day lead time both order 90 days of sales. Products with no regimen keep the general rule above.
   */
  nightReorderAtDays: number;
  nightTargetDays: number;
  dayReorderAtDays: number;
  dayTargetDays: number;
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
  nightReorderAtDays: 150,
  nightTargetDays: 180,
  dayReorderAtDays: 120,
  dayTargetDays: 150,
  safetyDays: 7,
  // above the highest planned stock (180 days, the Night Regime target, plus pack rounding), so a just-arrived
  // order isn't flagged "overstock"
  overstockDays: 210,
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
export const COVER_OPTIONS = [7, 15, 30, 45, 60, 90, 150, 180] as const;

/** How one product is reordered: when (trigger), for how long after it lands (cover), and any extra safety stock. */
export interface PurchaseRule {
  kind: "night" | "day_wellness" | "general";
  /** Plain words for screens: "Night Regime: order at 150 days, back to 180". */
  label: string;
  reorderAtDays: number;
  coverDays: number;
  safetyDays: number;
}

/** The purchase rule for a product's regimen (Zoho's "Type Regimen" field). The ONE place this choice is made. */
export function purchaseRule(segment: Segment | null | undefined, s: FormulaSettings): PurchaseRule {
  if (segment === "night") {
    return { kind: "night", label: `Night Regime: order at ${s.nightReorderAtDays} days left, back to ${s.nightTargetDays} days when it lands`, reorderAtDays: s.nightReorderAtDays, coverDays: s.nightTargetDays, safetyDays: 0 };
  }
  if (segment === "day" || segment === "wellness") {
    const name = segment === "day" ? "Day Regime" : "Wellness";
    return { kind: "day_wellness", label: `${name}: order at ${s.dayReorderAtDays} days left, back to ${s.dayTargetDays} days when it lands`, reorderAtDays: s.dayReorderAtDays, coverDays: s.dayTargetDays, safetyDays: 0 };
  }
  return {
    kind: "general",
    label: `No regimen in Zoho: order at ${s.reorderAtDays} days left, for ${s.defaultCoverDays} days + ${s.purchaseSafetyDays} days safety stock`,
    reorderAtDays: s.reorderAtDays,
    coverDays: s.defaultCoverDays,
    safetyDays: s.purchaseSafetyDays,
  };
}

/** Lead time for a product whose vendor has none set (decided 17 Nov 2026: 60 days). */
export const DEFAULT_LEAD_DAYS = 60;
export const PROJECTION_HORIZONS = [7, 15, 30, 60, 90] as const;
