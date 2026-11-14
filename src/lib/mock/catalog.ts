// Sample catalogue and locations. Product names, SKUs, categories and prices come from the
// Gleuhr online CRM's catalogue fixture; the clinics are the clinic CRM's nine locations.
// Quantities, vendors, lead times and pack sizes are made up for the demo.

import type { ChannelId, Location, Vendor } from "../domain/types";

export const CHANNELS: { id: ChannelId; label: string; short: string; priceFactor: number }[] = [
  { id: "clinic", label: "Clinics", short: "Clinic", priceFactor: 1 },
  { id: "online_team", label: "Online team", short: "Online team", priceFactor: 1 },
  { id: "amazon", label: "Amazon", short: "Amazon", priceFactor: 0.85 },
  { id: "flipkart", label: "Flipkart", short: "Flipkart", priceFactor: 0.85 },
  { id: "website", label: "Website (Shopify)", short: "Website", priceFactor: 0.95 },
];

export const D2C_CHANNELS: ChannelId[] = ["online_team", "amazon", "flipkart", "website"];

export const WAREHOUSE_ID = "loc-wh-mohali";

export const LOCATIONS: Location[] = [
  { id: WAREHOUSE_ID, name: "Mohali warehouse", kind: "warehouse", city: "Mohali" },
  { id: "loc-chandigarh", name: "Chandigarh", kind: "clinic", city: "Chandigarh" },
  { id: "loc-ludhiana", name: "Ludhiana", kind: "clinic", city: "Ludhiana" },
  { id: "loc-jalandhar", name: "Jalandhar", kind: "clinic", city: "Jalandhar" },
  { id: "loc-amritsar", name: "Amritsar", kind: "clinic", city: "Amritsar" },
  { id: "loc-bathinda", name: "Bathinda", kind: "clinic", city: "Bathinda" },
  { id: "loc-karnal", name: "Karnal", kind: "clinic", city: "Karnal" },
  { id: "loc-delhi", name: "Delhi", kind: "clinic", city: "Delhi" },
  { id: "loc-gurugram", name: "Gurugram", kind: "clinic", city: "Gurugram" },
  { id: "loc-delhi92", name: "Delhi 92", kind: "clinic", city: "Delhi" },
];

/** Relative clinic size (share of clinic sales). */
export const CLINIC_WEIGHT: Record<string, number> = {
  "loc-chandigarh": 0.2,
  "loc-ludhiana": 0.15,
  "loc-jalandhar": 0.1,
  "loc-amritsar": 0.1,
  "loc-bathinda": 0.07,
  "loc-karnal": 0.07,
  "loc-delhi": 0.12,
  "loc-gurugram": 0.12,
  "loc-delhi92": 0.07,
};

export const VENDORS: Vendor[] = [
  { id: "v-a", name: "Vendor A · Serums & creams", leadTimeDays: 15 },
  { id: "v-b", name: "Vendor B · Wellness & supplements", leadTimeDays: 30 },
  { id: "v-c", name: "Vendor C · Sun care & cleansers", leadTimeDays: 15 },
  { id: "v-d", name: "Vendor D · Treatment kits", leadTimeDays: 30 },
  { id: "v-e", name: "Vendor E · Makeup (imported)", leadTimeDays: 45 },
  { id: "v-f", name: "Vendor F · Herbal teas", leadTimeDays: 7 },
  { id: "v-g", name: "Vendor G · Hair care", leadTimeDays: 15 },
];

export interface CatalogEntry {
  sku: string;
  name: string;
  category: string;
  price: number;
  vendorId: string;
  packSize: number;
  /** Typical units per day across every channel. */
  baseRate: number;
}

export const CATALOG: CatalogEntry[] = [
  { sku: "GL-FGPLTTE", name: "3 in 1 Face Glow Palette", category: "Makeup", price: 1400, vendorId: "v-e", packSize: 12, baseRate: 1.6 },
  { sku: "GL-AGECMBT", name: "Age Combat", category: "Serums", price: 2600, vendorId: "v-a", packSize: 6, baseRate: 3.2 },
  { sku: "GL-AGELOCK", name: "Age Lock Facial Treatment Kit", category: "Treatment Kits", price: 5600, vendorId: "v-d", packSize: 4, baseRate: 1.4 },
  { sku: "GL-BBCREAM", name: "BB Cream", category: "Makeup", price: 1200, vendorId: "v-e", packSize: 12, baseRate: 2.4 },
  { sku: "GL-BLMPIGT", name: "Blemishes Pigmentation Treatment Kit", category: "Treatment Kits", price: 5200, vendorId: "v-d", packSize: 4, baseRate: 1.7 },
  { sku: "GL-CLRSOLN", name: "Clarifying Solution", category: "Cleansers & Toners", price: 1400, vendorId: "v-c", packSize: 12, baseRate: 3.1 },
  { sku: "GL-COLCREM", name: "Collagen Cream", category: "Creams & Moisturizers", price: 2200, vendorId: "v-a", packSize: 6, baseRate: 2.8 },
  { sku: "GL-COLSERM", name: "Collagen Serum", category: "Serums", price: 2800, vendorId: "v-a", packSize: 6, baseRate: 3.6 },
  { sku: "GL-EGFSERM", name: "EGF Serum", category: "Serums", price: 3500, vendorId: "v-a", packSize: 6, baseRate: 2.2 },
  { sku: "GL-EYEREVI", name: "Eye Revive", category: "Creams & Moisturizers", price: 2200, vendorId: "v-a", packSize: 6, baseRate: 1.9 },
  { sku: "GL-FLXSEED", name: "Flaxseed Oil (Omega 3 | 6 | 9)", category: "Wellness", price: 900, vendorId: "v-b", packSize: 24, baseRate: 4.1 },
  { sku: "GL-HAIRGRO", name: "G Hair Growth Capsules", category: "Hair Care", price: 1600, vendorId: "v-g", packSize: 24, baseRate: 5.2 },
  { sku: "GL-MOUSCLE", name: "G Mousse Cleanser", category: "Cleansers & Toners", price: 1300, vendorId: "v-c", packSize: 12, baseRate: 3.4 },
  { sku: "GL-GLOWFOR", name: "Glow Forever", category: "Wellness", price: 1800, vendorId: "v-b", packSize: 24, baseRate: 4.6 },
  { sku: "GL-GLUTABT", name: "Gluta Beauty", category: "Wellness", price: 2200, vendorId: "v-b", packSize: 24, baseRate: 5.8 },
  { sku: "GL-GLUTCAP", name: "Glutathione Capsule", category: "Wellness", price: 1900, vendorId: "v-b", packSize: 24, baseRate: 6.4 },
  { sku: "GL-GRAPESD", name: "Grape Seeds Tab", category: "Wellness", price: 1100, vendorId: "v-b", packSize: 24, baseRate: 2.6 },
  { sku: "GL-HAIRSHM", name: "Hair Nourishment Shampoo", category: "Hair Care", price: 1200, vendorId: "v-g", packSize: 12, baseRate: 3.9 },
  { sku: "GL-HAIROIL", name: "Hair Oil", category: "Hair Care", price: 900, vendorId: "v-g", packSize: 12, baseRate: 3.3 },
  { sku: "GL-HAIRSER", name: "Hair Serum", category: "Hair Care", price: 1500, vendorId: "v-g", packSize: 1, baseRate: 6.5 },
  { sku: "GL-HAIRSPA", name: "Hair Spa Kit", category: "Treatment Kits", price: 2400, vendorId: "v-d", packSize: 4, baseRate: 1.2 },
  { sku: "GL-MASCARA", name: "Jet Black Waterproof Mascara", category: "Makeup", price: 900, vendorId: "v-e", packSize: 12, baseRate: 0 },
  { sku: "GL-MAGCIT", name: "Magnesium Citrate", category: "Wellness", price: 1000, vendorId: "v-b", packSize: 24, baseRate: 2.2 },
  { sku: "GL-DAYCREM", name: "Multipurpose Day Cream", category: "Creams & Moisturizers", price: 1600, vendorId: "v-a", packSize: 6, baseRate: 3.8 },
  { sku: "GL-NGTCREM", name: "Multipurpose Night Cream", category: "Creams & Moisturizers", price: 1800, vendorId: "v-a", packSize: 6, baseRate: 3.5 },
  { sku: "GL-MVTSERM", name: "Multi-Vitamin Face Serum", category: "Serums", price: 2400, vendorId: "v-a", packSize: 6, baseRate: 3.0 },
  { sku: "GL-BDYLOTN", name: "Nourishing Body Lotion", category: "Creams & Moisturizers", price: 1100, vendorId: "v-a", packSize: 12, baseRate: 1.4 },
  { sku: "GL-PCOS", name: "PCOS Supplements", category: "Wellness", price: 1400, vendorId: "v-b", packSize: 24, baseRate: 2.9 },
  { sku: "GL-PURACNE", name: "Purifying Acne Treatment Kit", category: "Treatment Kits", price: 5000, vendorId: "v-d", packSize: 4, baseRate: 1.9 },
  { sku: "GL-PURGELL", name: "Purifying Active Solution Gel", category: "Cleansers & Toners", price: 1300, vendorId: "v-c", packSize: 12, baseRate: 2.7 },
  { sku: "GL-PURSERM", name: "Purifying Serum", category: "Serums", price: 2400, vendorId: "v-a", packSize: 6, baseRate: 2.9 },
  { sku: "GL-ROYCHAM", name: "Royal Chamomile Herbal Tea", category: "Wellness", price: 700, vendorId: "v-f", packSize: 24, baseRate: 1.8 },
  { sku: "GL-SEASUNS", name: "Seaweed Sunscreen Gel", category: "Sun Care", price: 1300, vendorId: "v-c", packSize: 12, baseRate: 4.4 },
  { sku: "GL-SLMHTEA", name: "Slim Fit Herbal Tea", category: "Wellness", price: 800, vendorId: "v-f", packSize: 24, baseRate: 3.6 },
  { sku: "GL-SPACREM", name: "Spa Cream", category: "Creams & Moisturizers", price: 1500, vendorId: "v-a", packSize: 6, baseRate: 2 },
  { sku: "GL-TTFACEW", name: "Tea Tree Facewash", category: "Cleansers & Toners", price: 900, vendorId: "v-c", packSize: 12, baseRate: 5.1 },
  { sku: "GL-THYROID", name: "Thyroid Capsules", category: "Wellness", price: 1200, vendorId: "v-b", packSize: 24, baseRate: 1.6 },
  { sku: "GL-VITCSRM", name: "Ultra Pure Vitamin-C Serum", category: "Serums", price: 2400, vendorId: "v-a", packSize: 6, baseRate: 5.5 },
  { sku: "GL-UVARMOR", name: "UV Armour Sunscreen", category: "Sun Care", price: 1200, vendorId: "v-c", packSize: 12, baseRate: 6.1 },
  { sku: "GL-VITCRH", name: "Vitamin C With Rose Hip", category: "Wellness", price: 1300, vendorId: "v-b", packSize: 24, baseRate: 2.4 },
  { sku: "GL-SKNHTEA", name: "Skin Herbal Tea", category: "Wellness", price: 800, vendorId: "v-f", packSize: 24, baseRate: 2.1 },
  { sku: "GL-SAQMASK", name: "G Marine Soothing Aqua Mask", category: "Creams & Moisturizers", price: 10500, vendorId: "v-a", packSize: 2, baseRate: 1.1 },
  { sku: "GL-MSGCREM", name: "G Marine Soothing Aqua Massage Cream", category: "Creams & Moisturizers", price: 10500, vendorId: "v-a", packSize: 2, baseRate: 0.6 },
];

/** Share of each product category's sales by channel (clinic, online team, amazon, flipkart, website). */
export const CATEGORY_MIX: Record<string, [number, number, number, number, number]> = {
  Serums: [0.46, 0.18, 0.16, 0.06, 0.14],
  "Creams & Moisturizers": [0.5, 0.16, 0.14, 0.06, 0.14],
  "Cleansers & Toners": [0.36, 0.14, 0.24, 0.1, 0.16],
  "Sun Care": [0.34, 0.12, 0.28, 0.1, 0.16],
  "Hair Care": [0.4, 0.2, 0.18, 0.08, 0.14],
  Wellness: [0.22, 0.34, 0.2, 0.08, 0.16],
  "Treatment Kits": [0.72, 0.14, 0.04, 0.02, 0.08],
  Makeup: [0.18, 0.1, 0.36, 0.18, 0.18],
};
