import { describe, expect, it } from "vitest";
import {
  dailyRate,
  daysOfCover,
  daysUntilOrder,
  daysWithNoStock,
  excessUnits,
  gapPct,
  indentQuantity,
  isGapFlagged,
  projection,
  reorderPoint,
  roundUpToPack,
  stockStatus,
  transferSuggestions,
  trendFactor,
  windowAverage,
} from "./formulas";
import { DEFAULT_FORMULA_SETTINGS as S } from "./types";

/** 90 days of Hair Serum: 630 in 90 days, 240 in the last 30, 70 in the last 7 (the worked example). */
function serumSeries(): number[] {
  const s: number[] = [];
  // days 1–60: 390 units (630 − 240)
  for (let i = 0; i < 60; i++) s.push(i < 30 ? 7 : 6); // 210 + 180 = 390
  // days 61–83: 170 units (240 − 70)
  for (let i = 0; i < 23; i++) s.push(i < 9 ? 8 : 7); // 72 + 98 = 170
  // last 7 days: 70 units
  for (let i = 0; i < 7; i++) s.push(10);
  return s;
}

describe("worked example · Hair Serum 50 ml", () => {
  const series = serumSeries();
  it("the series matches the example totals", () => {
    expect(series.length).toBe(90);
    expect(series.reduce((a, b) => a + b, 0)).toBe(630);
    expect(series.slice(-30).reduce((a, b) => a + b, 0)).toBe(240);
    expect(series.slice(-7).reduce((a, b) => a + b, 0)).toBe(70);
  });
  it("daily rate = 0.5×10 + 0.3×8 + 0.2×7 = 8.8", () => {
    expect(dailyRate(series, S).rate).toBe(8.8);
  });
  it("projections 7/15/30/60/90 = 62/132/264/528/792 (rounded)", () => {
    expect([7, 15, 30, 60, 90].map((d) => Math.round(projection(8.8, d)))).toEqual([62, 132, 264, 528, 792]);
  });
  it("150 in stock covers 17 days", () => {
    expect(Math.floor(daysOfCover(150, 8.8))).toBe(17);
  });
  it("reorder point for lead time 15, safety 7 = 193.6 → status Low", () => {
    expect(reorderPoint(8.8, 15, 7)).toBe(193.6);
    expect(stockStatus({ stock: 150, onOrder: 0, nextArrivalDays: null, rate: 8.8, leadTime: 15, safetyDays: 7, overstockDays: 90 })).toBe("low");
  });
  it("order now for lead 15, cover 30 = 308 (no float drift to 309)", () => {
    expect(indentQuantity({ rate: 8.8, leadTime: 15, coverDays: 30, safetyDays: 7, stock: 150, onOrder: 0, packSize: 1 }).qty).toBe(308);
  });
  it("order quantities for lead times 7/15/30/60/90 = 238/308/440/704/968", () => {
    const q = [7, 15, 30, 60, 90].map(
      (L) => indentQuantity({ rate: 8.8, leadTime: L, coverDays: 30, safetyDays: 7, stock: 150, onOrder: 0, packSize: 1 }).qty,
    );
    expect(q).toEqual([238, 308, 440, 704, 968]);
  });
  it("days with no stock for lead times 7/15/30/60/90 = 0/0/13/43/73", () => {
    expect([7, 15, 30, 60, 90].map((L) => daysWithNoStock(150, 8.8, L))).toEqual([0, 0, 13, 43, 73]);
  });
  it("status by lead time: healthy / low / critical / critical / critical", () => {
    const st = [7, 15, 30, 60, 90].map((L) =>
      stockStatus({ stock: 150, onOrder: 0, nextArrivalDays: null, rate: 8.8, leadTime: L, safetyDays: 7, overstockDays: 90 }),
    );
    expect(st).toEqual(["healthy", "low", "critical", "critical", "critical"]);
  });
  it("with a 7-day lead time the order is due in about 3 days", () => {
    expect(daysUntilOrder(150, 0, 8.8, 7, 7)).toBe(3);
  });
});

describe("overstock example · Face Cream", () => {
  it("2/day with 500 in stock = 250 days cover, 320 excess over a 90-day limit", () => {
    expect(daysOfCover(500, 2)).toBe(250);
    expect(excessUnits(500, 2, 90)).toBe(320);
    expect(stockStatus({ stock: 500, onOrder: 0, nextArrivalDays: null, rate: 2, leadTime: 15, safetyDays: 7, overstockDays: 90 })).toBe("overstock");
  });
});

describe("edge rules", () => {
  it("stock-out days are left out of the average", () => {
    const series = [10, 10, 0, 0, 10];
    const inStock = [true, true, false, false, true];
    expect(windowAverage(series, 5, inStock)).toBe(10);
    expect(windowAverage(series, 5, new Uint8Array([1, 1, 0, 0, 1]))).toBe(10);
  });
  it("a product with < 30 days of history is New and uses only its own days", () => {
    const r = dailyRate([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], S, { historyDays: 10 });
    expect(r.isNew).toBe(true);
    expect(r.rate).toBe(4);
  });
  it("an open order arriving before the stock-out date is not Critical", () => {
    expect(stockStatus({ stock: 50, onOrder: 300, nextArrivalDays: 4, rate: 10, leadTime: 15, safetyDays: 7, overstockDays: 90 })).toBe("healthy");
    expect(stockStatus({ stock: 50, onOrder: 300, nextArrivalDays: 9, rate: 10, leadTime: 15, safetyDays: 7, overstockDays: 90 })).toBe("critical");
  });
  it("nothing sold → no_sales, not overstock", () => {
    expect(stockStatus({ stock: 40, onOrder: 0, nextArrivalDays: null, rate: 0, leadTime: 15, safetyDays: 7, overstockDays: 90 })).toBe("no_sales");
  });
  it("orders round up to the pack size; ≤ 0 orders nothing", () => {
    expect(roundUpToPack(308, 12)).toBe(312);
    expect(roundUpToPack(-5, 12)).toBe(0);
    expect(indentQuantity({ rate: 1, leadTime: 7, coverDays: 15, safetyDays: 7, stock: 500, onOrder: 0, packSize: 6 }).qty).toBe(0);
  });
  it("trend factor is capped at ±25%", () => {
    const up = [...Array(30).fill(10), ...Array(30).fill(20)];
    expect(trendFactor(up, 25)).toBe(1.25);
    const flat = Array(60).fill(5);
    expect(trendFactor(flat, 25)).toBe(1);
  });
  it("plan gap: Shopify 1,400 planned vs 1,250 system = +12%, not flagged at 20%", () => {
    expect(gapPct(1400, 1250)).toBe(12);
    expect(isGapFlagged(1400, 1250, 20)).toBe(false);
    expect(isGapFlagged(1600, 1250, 20)).toBe(true);
  });
  it("transfer: a clinic over 60 days sends to one under 7 days", () => {
    const t = transferSuggestions(
      [
        { locationId: "A", stock: 180, rate: 2 }, // 90 days
        { locationId: "B", stock: 3, rate: 1 }, // 3 days
      ],
      60,
      7,
    );
    expect(t).toEqual([{ fromId: "A", toId: "B", qty: 11, fromCover: 90, toCover: 3 }]);
  });
});
