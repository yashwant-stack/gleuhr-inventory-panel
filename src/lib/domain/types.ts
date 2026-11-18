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
  /** Order when the stock left falls to this many days of sales (decided 17 Nov 2026: 60). */
  reorderAtDays: number;
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
}

export const DEFAULT_FORMULA_SETTINGS: FormulaSettings = {
  rateWindowDays: 60,
  reorderAtDays: 60,
  safetyDays: 7,
  overstockDays: 90,
  defaultCoverDays: 60,
  useTrendFactor: false,
  trendCapPct: 25,
  gapFlagPct: 20,
  transferHighDays: 60,
  transferLowDays: 7,
  replenishLeadDays: 3,
  replenishCoverDays: 15,
};

export const LEAD_TIME_OPTIONS = [7, 15, 30, 60, 90] as const;
export const COVER_OPTIONS = [7, 15, 30, 60, 90] as const;

/** Lead time for a product whose vendor has none set (decided 17 Nov 2026: 60 days). */
export const DEFAULT_LEAD_DAYS = 60;
export const PROJECTION_HORIZONS = [7, 15, 30, 60, 90] as const;
