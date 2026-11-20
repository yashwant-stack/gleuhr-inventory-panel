// Bottles and packaging (decided 20 Nov 2026): Zoho items whose "Stock" field is "Bottle Count". They are kept only
// at the Mohali warehouse. The count comes from Zoho; the projection says how long it lasts:
//   1. From Zoho's own counts, once the panel holds 14 days of daily Mohali counts: the average fall per day
//      (rises are deliveries and are left out).
//   2. Until then, from sales: the bottle is linked by name to the product it holds (one bottle, cap or pump per
//      unit sold), and uses that product's daily rate. A name that fits no product, or more than one, is not
//      linked: the panel never guesses which product a bottle belongs to.
import { addDays } from "../dates";
import type { BottleItem } from "./model";
import type { ProductMetrics } from "./engine";

/** Days of daily Mohali counts needed before the counts are trusted over sales. */
export const BOTTLE_HISTORY_DAYS = 14;

// packaging words (a "lotion pump" is a kind of pump, not the body lotion)
const PACKAGING = /\b(lotion\s+pumps?|bottles?|btl|pumps?|caps?|tubes?|droppers?|plugs?|lids?|inner|head|silver|gold(en)?|matt|pearl|white|light|color|colour)\b/gi;

const compact = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** The product phrases a bottle's name points at: what is in brackets (split on - & , / +) and the name without packaging words. */
export function bottlePhrases(name: string): string[] {
  const inside = [...name.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1]!.split(/[-&,/+]/));
  const outside = name.replace(/\([^)]*\)/g, " ");
  const strip = (s: string) =>
    s
      .replace(PACKAGING, " ")
      .replace(/\b\d+\s*(ml|mm|g)?\b/gi, " ")
      .replace(/\b\d+-?[a-z]?\b/gi, " ")
      .replace(/[+]/g, " ");
  const phrases = [...inside.map(strip), strip(outside)].map(compact).filter((p) => p.length >= 3);
  return [...new Set(phrases)];
}

export interface BottleLink {
  /** Products this bottle is used for (empty = not linked). */
  products: ProductMetrics[];
  /** Why it is not linked: a phrase that fits several products, or nothing at all. */
  problem: { kind: "none" } | { kind: "ambiguous"; phrase: string; candidates: string[] } | null;
}

export function linkBottle(name: string, metrics: ProductMetrics[]): BottleLink {
  const phrases = bottlePhrases(name);
  const found = new Map<string, ProductMetrics>();
  for (const ph of phrases) {
    const hits = metrics.filter((m) => compact(m.product.name).includes(ph));
    if (hits.length > 1) return { products: [], problem: { kind: "ambiguous", phrase: ph, candidates: hits.map((m) => m.product.name) } };
    if (hits.length === 1) found.set(hits[0]!.product.id, hits[0]!);
  }
  return found.size ? { products: [...found.values()], problem: null } : { products: [], problem: { kind: "none" } };
}

/**
 * Average pieces used per day from daily counts. A day the count rises is a delivery: that day's use cannot be
 * seen, so it is left out of the average (counting it as "nothing used" would make the pace look slower).
 * null until there are enough days of counts.
 */
export function observedUse(history: { day: string; qty: number }[], minDays = BOTTLE_HISTORY_DAYS): number | null {
  const h = [...history].sort((a, b) => a.day.localeCompare(b.day));
  if (h.length < minDays) return null;
  let fall = 0;
  let days = 0;
  for (let i = 1; i < h.length; i++) {
    const d = h[i - 1]!.qty - h[i]!.qty;
    if (d < 0) continue; // a delivery
    fall += d;
    days += Math.max(1, (Date.parse(h[i]!.day) - Date.parse(h[i - 1]!.day)) / 86_400_000);
  }
  return days ? fall / days : null;
}

export interface BottleRow {
  bottle: BottleItem;
  link: BottleLink;
  /** Pieces used per day, and where that number comes from. */
  perDay: number | null;
  source: "zoho_counts" | "sales" | null;
  daysLeft: number | null;
  runOut: string | null;
  /** Pieces needed for the next 30 / 90 days at that pace, and what is missing (0 = enough). */
  need30: number | null;
  need90: number | null;
  short90: number | null;
  /** Runs out before a new order could arrive (the lead time). */
  atRisk: boolean;
}

export function bottleRows(bottles: BottleItem[], metrics: ProductMetrics[], today: string, leadDays: number): BottleRow[] {
  return bottles
    .map((b) => {
      const link = linkBottle(b.name, metrics);
      const counted = observedUse(b.history);
      const fromSales = link.products.length ? link.products.reduce((a, m) => a + m.rate, 0) : null;
      const perDay = counted ?? fromSales;
      const source: BottleRow["source"] = counted !== null ? "zoho_counts" : fromSales !== null ? "sales" : null;
      const qty = Math.max(0, b.qty ?? 0);
      const daysLeft = perDay && perDay > 0 ? qty / perDay : perDay === 0 ? Infinity : null;
      const need = (d: number) => (perDay === null ? null : Math.ceil(perDay * d));
      const need90 = need(90);
      return {
        bottle: b,
        link,
        perDay,
        source,
        daysLeft,
        runOut: daysLeft !== null && Number.isFinite(daysLeft) ? addDays(today, Math.floor(daysLeft)) : null,
        need30: need(30),
        need90,
        short90: need90 === null ? null : Math.max(0, need90 - qty),
        atRisk: daysLeft !== null && daysLeft < leadDays,
      };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || (b.bottle.qty ?? 0) - (a.bottle.qty ?? 0));
}
