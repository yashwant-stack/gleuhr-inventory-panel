import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS as S } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { computeMetrics } from "./engine";
import { consolidate, cycleById, planBaseline, spreadPlan, type PlanSubmission } from "./plans";

const ds = getDataset();
const metrics = computeMetrics(ds, S);
const cycle = cycleById("m-2026-12")!;

describe("the marketing plan, product by product", () => {
  const base = planBaseline(ds, S, "marketing", cycle);

  it("lists every product under each channel, and a channel's system figure is the sum of its products", () => {
    expect(base.map((b) => b.key)).toEqual(["clinic", "online_team", "website"]);
    for (const b of base) {
      expect(b.products).toHaveLength(ds.products.length);
      expect(b.products.reduce((a, p) => a + p.systemUnits, 0)).toBe(b.systemUnits);
      expect(b.products.reduce((a, p) => a + p.last30, 0)).toBe(b.last30);
    }
  });

  it("a plan saved as one number per channel is spread over its products in whole units that add up exactly", () => {
    const products = [
      { productId: "a", systemUnits: 50 },
      { productId: "b", systemUnits: 30 },
      { productId: "c", systemUnits: 20 },
      { productId: "d", systemUnits: 0 },
    ];
    expect(spreadPlan(products, 101)).toEqual({ a: 51, b: 30, c: 20, d: 0 });
    const odd = spreadPlan(products, 7);
    expect(Object.values(odd).reduce((a, n) => a + n, 0)).toBe(7);
    expect(spreadPlan(products, 0)).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });

  it("a product's own plan drives its stock check: tripling one product at the clinics raises its demand, other products stay put", () => {
    const clinic = base.find((b) => b.key === "clinic")!;
    const sub = (factor: (id: string) => number): PlanSubmission => ({
      cycleId: cycle.id,
      part: "marketing",
      by: "mh",
      submittedAt: "2026-11-24T10:00:00.000Z",
      note: "",
      version: 1,
      lines: base.map((b) => {
        const products = b.products.map((x) => ({ ...x, plannedUnits: b.key === "clinic" ? Math.round(x.systemUnits * factor(x.productId)) : x.systemUnits }));
        return { key: b.key, label: b.label, systemUnits: b.systemUnits, plannedUnits: products.reduce((a, x) => a + x.plannedUnits, 0), activity: "", budget: 0, products };
      }),
    });
    const flat = consolidate(ds, S, metrics, cycle, { marketing: sub(() => 1) });
    const none = consolidate(ds, S, metrics, cycle, {});
    // planning every product at the system figure changes nothing
    expect(flat.readiness).toEqual(none.readiness);

    // a product sold at the clinics that is already short for the period
    const pick = flat.readiness.find((r) => (clinic.products.find((x) => x.productId === r.product.id)?.systemUnits ?? 0) > 0)!;
    expect(pick).toBeDefined();
    const tripled = consolidate(ds, S, metrics, cycle, { marketing: sub((id) => (id === pick.product.id ? 3 : 1)) });
    const after = tripled.readiness.find((r) => r.product.id === pick.product.id)!;
    expect(after.demand).toBeGreaterThan(pick.demand);
    for (const r of flat.readiness) if (r.product.id !== pick.product.id) expect(tripled.readiness.find((x) => x.product.id === r.product.id)?.demand).toBe(r.demand);
  });
});
