import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS as S } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { addDays } from "../dates";
import type { PlanCycle } from "../mock/plans";
import { computeMetrics, type ProductMetrics } from "./engine";
import { canStillSubmit, clinicSplit, consolidate, cycleById, cycleState, planBaseline, planStockCheck, spreadPlan, type PlanSubmission } from "./plans";
import { cyclesFor } from "../mock/plans";

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
      by: "marketing",
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

describe("the sales plan, clinic by clinic (the clinic plan merged in)", () => {
  const sales = planBaseline(ds, S, "sales", cycle);
  const clinicLine = sales.find((b) => b.key === "clinic")!;

  it("the clinics add up exactly to the Clinics line", () => {
    const rows = clinicSplit(ds, S, cycle, clinicLine.systemUnits);
    expect(rows.length).toBe(ds.clinics.filter((c) => c.active).length);
    expect(rows.reduce((a, r) => a + r.systemUnits, 0)).toBe(clinicLine.systemUnits);
  });

  it("the report reads each clinic's number from the sales plan, and the sales plan wins over marketing", () => {
    const rows = clinicSplit(ds, S, cycle, clinicLine.systemUnits);
    const clinics = rows.map((r, i) => ({ key: r.key, label: r.label, systemUnits: r.systemUnits, plannedUnits: r.systemUnits + (i === 0 ? 10 : 0) }));
    const sub: PlanSubmission = {
      cycleId: cycle.id, part: "sales", by: "sales", submittedAt: "2026-11-24T10:00:00.000Z", note: "", version: 1,
      lines: sales.map((b) => (b.key === "clinic" ? { key: b.key, label: b.label, systemUnits: b.systemUnits, plannedUnits: b.systemUnits + 10, activity: "", budget: 0, clinics } : { key: b.key, label: b.label, systemUnits: b.systemUnits, plannedUnits: b.systemUnits, activity: "", budget: 0 })),
    };
    const report = consolidate(ds, S, metrics, cycle, { sales: sub });
    expect(report.rows.find((r) => r.channel === "clinic")!.plan).toBe(clinicLine.systemUnits + 10);
    expect(report.clinics[0]!.plan).toBe(rows[0]!.systemUnits + 10);
    expect(report.clinics[1]!.plan).toBe(rows[1]!.systemUnits);
    expect(consolidate(ds, S, metrics, cycle, {}).clinics.every((c) => c.plan === null)).toBe(true);
  });
});

describe("the plan's stock check: days left and when new stock arrives", () => {
  const today = ds.today;
  const week: PlanCycle = { id: "t", kind: "weekly", label: "test week", periodFrom: addDays(today, 3), periodTo: addDays(today, 9), requestOn: today, dueOn: today, reportOn: today };
  const base = metrics.find((m) => m.rate > 0)!;
  const fake = (over: Partial<ProductMetrics> & { id: string }): ProductMetrics =>
    ({ ...base, product: { ...base.product, id: over.id, name: over.id }, rate: 10, stock: 100, leadTime: 60, nextArrivalDays: null, status: "healthy", ...over }) as ProductMetrics;

  it("a plan that doubles sales empties the shelf in 6½ days, long before new stock (60 days): at risk", () => {
    // 3 days at 10 a day (30), then 20 a day: 70 ÷ 20 = 3.5 more days
    const [r] = planStockCheck(ds, [fake({ id: "A" })], week, { A: { system: 70, planned: 140, budget: 20000 } });
    expect(r).toMatchObject({ risk: "at_risk", dailyAtPlan: 20, daysLeft: 6.5, runOut: addDays(today, 6), eta: addDays(today, 60), etaOnOrder: false, budget: 20000 });
  });
  it("the same plan with an order landing in 2 days is tight, not at risk", () => {
    const [r] = planStockCheck(ds, [fake({ id: "B", nextArrivalDays: 2 })], week, { B: { system: 70, planned: 140, budget: 0 } });
    expect(r).toMatchObject({ risk: "tight", eta: addDays(today, 2), etaOnOrder: true });
  });
  it("at the system's own pace 100 units last 10 days, past the week: OK", () => {
    const [r] = planStockCheck(ds, [fake({ id: "C" })], week, { C: { system: 70, planned: 70, budget: 0 } });
    expect(r).toMatchObject({ risk: "ok", daysLeft: 10 });
  });
  it("overstock the plan does not push is flagged; a product with no sales and no plan is left out", () => {
    const rows = planStockCheck(ds, [fake({ id: "D", stock: 5000, status: "overstock" }), fake({ id: "E", rate: 0 })], week, { D: { system: 70, planned: 70, budget: 0 } });
    expect(rows.map((r) => [r.product.id, r.risk])).toEqual([["D", "overstock"]]);
  });
});

describe("plan cycles follow the calendar (21 Nov 2026: the fixed sample list ran out after 14 Nov)", () => {
  const ids = (d: string) => cyclesFor(d).map((c) => c.id);
  it("on the sample day they are exactly the sample cycles", () => {
    expect(ids("2026-11-14")).toEqual(["m-2026-12", "w-2026-11-16", "w-2026-11-09", "m-2026-11"]);
  });
  it("on Saturday 21 Nov the weekly plan for the week of 23 Nov is open (request Thu 19, due Sat 21)", () => {
    const w = cyclesFor("2026-11-21").find((c) => c.id === "w-2026-11-23")!;
    expect(w).toMatchObject({ label: "Week of 23 Nov", requestOn: "2026-11-19", dueOn: "2026-11-21", periodFrom: "2026-11-23", periodTo: "2026-11-29" });
    expect(cycleState(w, "2026-11-21")).toBe("open");
  });
  it("December's monthly plan: request 23 Nov, due 25 Nov, report 26 Nov", () => {
    expect(cyclesFor("2026-11-21").find((c) => c.id === "m-2026-12")).toMatchObject({ label: "December 2026", requestOn: "2026-11-23", dueOn: "2026-11-25", reportOn: "2026-11-26", periodTo: "2026-12-31" });
  });
  it("a plan can still be filled after its due day (late) until its period starts, not before the request day", () => {
    const w = cyclesFor("2026-11-21").find((c) => c.id === "w-2026-11-23")!;
    expect(canStillSubmit(w, "2026-11-18")).toBe(false); // before Thursday's request
    expect(canStillSubmit(w, "2026-11-21")).toBe(true); // due day
    expect(canStillSubmit(w, "2026-11-22")).toBe(true); // Sunday: late, still accepted
    expect(canStillSubmit(w, "2026-11-23")).toBe(false); // the week has started
  });
});
