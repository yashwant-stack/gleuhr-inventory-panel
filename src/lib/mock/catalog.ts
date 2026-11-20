// Sample catalogue and locations. Product names, SKUs, categories and prices come from the
// Gleuhr online CRM's catalogue fixture; the clinics are the clinic CRM's nine locations.
// Quantities, vendors, lead times and pack sizes are made up for the demo.

import type { ChannelId, Location, Segment, Vendor } from "../domain/types";
import type { CrmClinic } from "../data/model";

/** Channel names and colours are fixed; whether a channel is connected comes from the data. */
export const CHANNELS: { id: ChannelId; label: string; short: string }[] = [
  { id: "clinic", label: "Clinics", short: "Clinic" },
  { id: "online_team", label: "Online team", short: "Online team" },
  { id: "website", label: "Website (Shopify)", short: "Website" },
  { id: "amazon", label: "Amazon", short: "Amazon" },
  { id: "flipkart", label: "Flipkart", short: "Flipkart" },
];

/** Net price the business receives per channel, relative to the catalogue price (sample data only). */
export const SAMPLE_PRICE_FACTOR: Record<ChannelId, number> = { clinic: 1, online_team: 1, website: 0.95, amazon: 0.85, flipkart: 0.85 };

// The 16 Zoho locations as read on 14 Nov 2026 (ids shortened for the sample).
// readable=false: the Zoho login was refused ("insufficient location permissions").
export const SAMPLE_LOCATIONS: Location[] = [
  { id: "z-mohali", name: "Mohali - Warehouse", kind: "warehouse", isPrimary: true, readable: true },
  { id: "z-chandigarh", name: "Chandigarh", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-ludhiana", name: "Ludhiana", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-jalandhar", name: "Jalandhar", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-amritsar", name: "Amritsar", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-bathinda", name: "Bathinda", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-karnal", name: "Karnal", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-delhi", name: "Delhi", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-delhi92", name: "Delhi 92", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-gurugram", name: "Gurugram", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-jaipur", name: "Jaipur", kind: "clinic", isPrimary: false, readable: true },
  { id: "z-ahmedabad", name: "Ahmedabad", kind: "clinic", isPrimary: false, readable: false },
  { id: "z-mumbai", name: "Mumbai", kind: "clinic", isPrimary: false, readable: false },
  { id: "z-pune", name: "Pune", kind: "clinic", isPrimary: false, readable: false },
  { id: "z-delhi-ds", name: "Delhi - DARKSTORE", kind: "darkstore", isPrimary: false, readable: false },
  { id: "z-mumbai-ds", name: "Mumbai - Darkstore", kind: "darkstore", isPrimary: false, readable: false },
];

export const PRIMARY_LOCATION_ID = "z-mohali";
export const DELHI_LOCATION_ID = "z-delhi";

// CRM clinics and the Zoho location each one posts to, as in production on 14 Nov 2026.
export const SAMPLE_CLINICS: CrmClinic[] = [
  { id: "1", name: "Chandigarh", active: true, zohoLocationId: "z-chandigarh" },
  { id: "2", name: "Ludhiana", active: true, zohoLocationId: "z-ludhiana" },
  { id: "3", name: "Jalandhar", active: true, zohoLocationId: "z-jalandhar" },
  { id: "4", name: "Amritsar", active: true, zohoLocationId: "z-amritsar" },
  { id: "5", name: "Bathinda", active: true, zohoLocationId: "z-bathinda" },
  { id: "6", name: "Karnal", active: true, zohoLocationId: "z-karnal" },
  { id: "7", name: "Delhi", active: true, zohoLocationId: "z-delhi" },
  { id: "8", name: "Gurgaon", active: true, zohoLocationId: "z-gurugram" },
  { id: "9", name: "Delhi West", active: false, zohoLocationId: "z-delhi92" },
  { id: "10", name: "Delhi East", active: true, zohoLocationId: null },
  { id: "11", name: "Jaipur", active: true, zohoLocationId: "z-jaipur" },
  { id: "42", name: "Ahmedabad", active: true, zohoLocationId: "z-ahmedabad" },
  { id: "45", name: "Mumbai", active: true, zohoLocationId: "z-mumbai" },
  { id: "46", name: "Pune", active: true, zohoLocationId: null },
];

/** Relative clinic size (share of clinic sales), roughly as in the last 30 days of real data. */
export const CLINIC_WEIGHT: Record<string, number> = {
  "1": 0.2, "2": 0.1, "3": 0.1, "4": 0.1, "5": 0.05, "6": 0.08, "7": 0.09, "8": 0.04,
  "10": 0.05, "11": 0.03, "42": 0.03, "45": 0.06, "46": 0.02,
};

/** Clinics where online-team orders are picked up or sent by Rapido (stock leaves the clinic). */
export const PICKUP_CLINICS = ["1", "2", "3", "4", "5", "6", "8"];

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

/**
 * Sample segments (Day Regime / Night Regime / Wellness). In the real panel this comes from a "Segment" custom
 * field on each Zoho item. A few sample products are left without one, so the "Not set in Zoho" state shows.
 */
export const SAMPLE_SEGMENT: Record<string, Segment> = {
  "GL-FGPLTTE": "day", "GL-BBCREAM": "day", "GL-CLRSOLN": "day", "GL-MOUSCLE": "day", "GL-DAYCREM": "day", "GL-MVTSERM": "day",
  "GL-PURGELL": "day", "GL-SEASUNS": "day", "GL-TTFACEW": "day", "GL-VITCSRM": "day", "GL-UVARMOR": "day", "GL-HAIRSHM": "day",
  "GL-AGECMBT": "night", "GL-AGELOCK": "night", "GL-BLMPIGT": "night", "GL-COLCREM": "night", "GL-COLSERM": "night", "GL-EGFSERM": "night",
  "GL-EYEREVI": "night", "GL-NGTCREM": "night", "GL-PURACNE": "night", "GL-PURSERM": "night", "GL-SPACREM": "night", "GL-HAIROIL": "night",
  "GL-HAIRSER": "night", "GL-SAQMASK": "night", "GL-MSGCREM": "night",
  "GL-FLXSEED": "wellness", "GL-HAIRGRO": "wellness", "GL-GLOWFOR": "wellness", "GL-GLUTABT": "wellness", "GL-GLUTCAP": "wellness",
  "GL-GRAPESD": "wellness", "GL-MAGCIT": "wellness", "GL-PCOS": "wellness", "GL-ROYCHAM": "wellness", "GL-SLMHTEA": "wellness",
  "GL-THYROID": "wellness", "GL-VITCRH": "wellness", "GL-SKNHTEA": "wellness",
};

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

/** Share of each product category's sales by channel: clinic, online team, website. */
export const CATEGORY_MIX: Record<string, [number, number, number]> = {
  Serums: [0.52, 0.34, 0.14],
  "Creams & Moisturizers": [0.56, 0.3, 0.14],
  "Cleansers & Toners": [0.44, 0.38, 0.18],
  "Sun Care": [0.42, 0.38, 0.2],
  "Hair Care": [0.46, 0.38, 0.16],
  Wellness: [0.26, 0.54, 0.2],
  "Treatment Kits": [0.78, 0.16, 0.06],
  Makeup: [0.3, 0.4, 0.3],
};
