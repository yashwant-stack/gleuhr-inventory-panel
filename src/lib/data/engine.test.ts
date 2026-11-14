import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { allTransfers, computeMetrics, dailyTotals, salesByProduct } from "./engine";

const ds = getDataset();
const metrics = computeMetrics(ds, DEFAULT_FORMULA_SETTINGS);
const bySku = (sku: string) => metrics.find((m) => m.product.sku === sku)!;

describe("sample data tells the documented stories", () => {
  it("Hair Serum is the worked example: 8.8/day, 150 in stock, Low, order 308", () => {
    const m = bySku("GL-HAIRSER");
    expect(m.rate).toBe(8.8);
    expect(m.stock).toBe(150);
    expect(m.warehouseStock).toBe(110);
    expect(m.leadTime).toBe(15);
    expect(m.status).toBe("low");
    expect(m.indentQty).toBe(308);
  });
  it("UV Armour is Critical; Seaweed Gel is rescued by an order landing in 4 days", () => {
    expect(bySku("GL-UVARMOR").status).toBe("critical");
    const sea = bySku("GL-SEASUNS");
    expect(sea.nextArrivalDays).toBe(4);
    expect(sea.status).not.toBe("critical");
  });
  it("Spa Cream is Overstock with excess units; Mascara has no sales; Aqua Mask is New", () => {
    expect(bySku("GL-SPACREM").status).toBe("overstock");
    expect(bySku("GL-SPACREM").excess).toBeGreaterThan(200);
    expect(bySku("GL-MASCARA").status).toBe("no_sales");
    expect(bySku("GL-SAQMASK").isNew).toBe(true);
  });
  it("every status appears at least once, and transfer suggestions exist", () => {
    const statuses = new Set(metrics.map((m) => m.status));
    for (const s of ["critical", "low", "healthy", "overstock", "no_sales"]) expect(statuses.has(s as never)).toBe(true);
    expect(allTransfers(ds, DEFAULT_FORMULA_SETTINGS).length).toBeGreaterThan(0);
  });
  it("daily totals add up to the per-product sales", () => {
    const f = { from: "2026-11-01", to: "2026-11-14", channels: [], locations: [], categories: [], search: "" };
    const perProduct = salesByProduct(ds, f).reduce((a, s) => a + s.qty, 0);
    const perDay = dailyTotals(ds, f).reduce((a, d) => a + d.total, 0);
    expect(perDay).toBe(perProduct);
    expect(perDay).toBeGreaterThan(0);
  });
});
