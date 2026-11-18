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
} from "./formulas";
import { DEFAULT_FORMULA_SETTINGS as S, DEFAULT_LEAD_DAYS } from "./types";

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
  it("daily rate = last 60 days' sales ÷ 60 = 420 ÷ 60 = 7", () => {
    expect(series.slice(-60).reduce((a, b) => a + b, 0)).toBe(420);
    expect(dailyRate(series, S)).toMatchObject({ rate: 7, sold: 420, days: 60 });
  });
  it("projections 7/15/30/60/90 = 49/105/210/420/630", () => {
    expect([7, 15, 30, 60, 90].map((d) => Math.round(projection(7, d)))).toEqual([49, 105, 210, 420, 630]);
  });
  it("150 in stock covers 21 days", () => {
    expect(Math.floor(daysOfCover(150, 7))).toBe(21);
  });
  it("reorder point = 7 a day × 60 days = 420; 150 in stock is below it → status Low (time to order)", () => {
    expect(reorderPoint(7, S.reorderAtDays, 15)).toBe(420);
    expect(stockStatus({ stock: 150, onOrder: 0, nextArrivalDays: null, rate: 7, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("low");
  });
  it("order now for lead 15, cover 60 = 7 × (15 + 60) − 150 = 375", () => {
    expect(indentQuantity({ rate: 7, leadTime: 15, coverDays: S.defaultCoverDays, reorderAtDays: S.reorderAtDays, stock: 150, onOrder: 0, packSize: 1 })).toEqual({ raw: 375, qty: 375, due: true });
  });
  it("order quantities for lead times 7/15/30/60/90 (cover 60) = 319/375/480/690/900", () => {
    const q = [7, 15, 30, 60, 90].map(
      (L) => indentQuantity({ rate: 7, leadTime: L, coverDays: 60, reorderAtDays: 60, stock: 150, onOrder: 0, packSize: 1 }).qty,
    );
    expect(q).toEqual([319, 375, 480, 690, 900]);
  });
  it("days with no stock for lead times 7/15/30/60/90 = 0/0/9/39/69", () => {
    expect([7, 15, 30, 60, 90].map((L) => daysWithNoStock(150, 7, L))).toEqual([0, 0, 9, 39, 69]);
  });
  it("status by lead time: low / low / critical / critical / critical", () => {
    const st = [7, 15, 30, 60, 90].map((L) =>
      stockStatus({ stock: 150, onOrder: 0, nextArrivalDays: null, rate: 7, leadTime: L, reorderAtDays: 60, overstockDays: 90 }),
    );
    expect(st).toEqual(["low", "low", "critical", "critical", "critical"]);
  });
});

describe("the 60-day purchase rule (decided 17 Nov 2026)", () => {
  it("defaults: lead time 60 days, order when 60 days of stock are left, order enough for 60 days", () => {
    expect(DEFAULT_LEAD_DAYS).toBe(60);
    expect(S.reorderAtDays).toBe(60);
    expect(S.defaultCoverDays).toBe(60);
  });
  it("20 a day, 1,200 left (60 days), lead 60: order 1,200 — the stock runs down to 0 as it lands, then 60 days again", () => {
    const r = indentQuantity({ rate: 20, leadTime: 60, coverDays: 60, reorderAtDays: 60, stock: 1200, onOrder: 0, packSize: 1 });
    expect(r).toEqual({ raw: 1200, qty: 1200, due: true });
    expect(daysOfCover(1200 - 20 * 60 + r.qty, 20)).toBe(60);
  });
  it("above 60 days of stock nothing is ordered yet, and the panel says when it falls due", () => {
    expect(indentQuantity({ rate: 7, leadTime: 15, coverDays: 60, reorderAtDays: 60, stock: 450, onOrder: 0, packSize: 1 })).toEqual({ raw: 75, qty: 0, due: false });
    expect(daysUntilOrder(450, 0, 7, 60, 15)).toBe(4); // (450 − 420) ÷ 7 = 4.3 → in 4 days
    expect(stockStatus({ stock: 450, onOrder: 0, nextArrivalDays: null, rate: 7, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("healthy");
  });
  it("stock on the way counts: an open order that lifts stock above 60 days means no new order", () => {
    expect(indentQuantity({ rate: 7, leadTime: 15, coverDays: 60, reorderAtDays: 60, stock: 150, onOrder: 300, packSize: 1 }).due).toBe(false);
  });
  it("a lead time longer than 60 days moves the reorder point to the lead time (ordering later would run out first)", () => {
    expect(reorderPoint(10, 60, 90)).toBe(900);
    expect(indentQuantity({ rate: 10, leadTime: 90, coverDays: 60, reorderAtDays: 60, stock: 800, onOrder: 0, packSize: 1 })).toEqual({ raw: 700, qty: 700, due: true });
  });
});

describe("overstock example · Face Cream", () => {
  it("2/day with 500 in stock = 250 days cover, 320 excess over a 90-day limit", () => {
    expect(daysOfCover(500, 2)).toBe(250);
    expect(excessUnits(500, 2, 90)).toBe(320);
    expect(stockStatus({ stock: 500, onOrder: 0, nextArrivalDays: null, rate: 2, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("overstock");
  });
});

describe("edge rules", () => {
  it("the founder's example: day 42 → (day 1 + … + day 42 sales) ÷ 42; 500 in stock at 20 a day = 25 days", () => {
    const days = Array.from({ length: 42 }, (_, i) => (i % 2 === 0 ? 15 : 25)); // 840 units over 42 days
    const r = dailyRate(days, S);
    expect(r).toMatchObject({ rate: 20, sold: 840, days: 42 });
    expect(daysOfCover(500, r.rate)).toBe(25);
  });
  it("the window rolls: only the latest 60 days count, and days with no sales count as 0", () => {
    const old = new Array(30).fill(100); // more than 60 days ago: dropped
    const last60 = [...new Array(30).fill(0), ...new Array(30).fill(6)];
    expect(dailyRate([...old, ...last60], S)).toMatchObject({ rate: 3, sold: 180, days: 60 });
    expect(dailyRate([...old, ...last60, 9], S).rate).toBe(3.15); // tomorrow: the oldest day drops off, today is added
  });
  it("a product with < 30 days of history is New and uses only its own days", () => {
    const r = dailyRate([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], S, { historyDays: 10 });
    expect(r.isNew).toBe(true);
    expect(r.rate).toBe(4);
  });
  it("an open order arriving before the stock-out date is not Critical", () => {
    expect(stockStatus({ stock: 50, onOrder: 300, nextArrivalDays: 4, rate: 10, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("low"); // 35 days with the order: still time to order
    expect(stockStatus({ stock: 50, onOrder: 300, nextArrivalDays: 9, rate: 10, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("critical");
  });
  it("nothing sold → no_sales, not overstock", () => {
    expect(stockStatus({ stock: 40, onOrder: 0, nextArrivalDays: null, rate: 0, leadTime: 15, reorderAtDays: 60, overstockDays: 90 })).toBe("no_sales");
  });
  it("orders round up to the pack size; ≤ 0 orders nothing", () => {
    expect(roundUpToPack(308, 12)).toBe(312);
    expect(roundUpToPack(-5, 12)).toBe(0);
    expect(indentQuantity({ rate: 1, leadTime: 7, coverDays: 15, reorderAtDays: 60, stock: 500, onOrder: 0, packSize: 6 }).qty).toBe(0);
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
