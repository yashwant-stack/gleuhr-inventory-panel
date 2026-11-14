// Shared shapes for the panel. These mirror what the backend will later read from
// Zoho Inventory (items, locations, stock per location, sales lines, purchase orders),
// so the screens do not change when sample data is swapped for real data.

export type ChannelId = "clinic" | "online_team" | "amazon" | "flipkart" | "website";

export type LocationKind = "warehouse" | "clinic";

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  city: string;
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
  /** Weights for the daily sales rate, in percent. Must add up to 100. */
  weight7: number;
  weight30: number;
  weight90: number;
  safetyDays: number;
  overstockDays: number;
  defaultCoverDays: number;
  useTrendFactor: boolean;
  trendCapPct: number;
  gapFlagPct: number;
  transferHighDays: number;
  transferLowDays: number;
}

export const DEFAULT_FORMULA_SETTINGS: FormulaSettings = {
  weight7: 50,
  weight30: 30,
  weight90: 20,
  safetyDays: 7,
  overstockDays: 90,
  defaultCoverDays: 30,
  useTrendFactor: false,
  trendCapPct: 25,
  gapFlagPct: 20,
  transferHighDays: 60,
  transferLowDays: 7,
};

export const LEAD_TIME_OPTIONS = [7, 15, 30, 60, 90] as const;
export const COVER_OPTIONS = [15, 30, 60, 90] as const;
export const PROJECTION_HORIZONS = [7, 15, 30, 60, 90] as const;
