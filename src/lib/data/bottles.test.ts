// Bottles (decided 20 Nov 2026): linking Zoho's bottle items to products by name, and how long they last.
import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS as S } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { bottleRows, linkBottle, observedUse } from "./bottles";
import { computeMetrics } from "./engine";

const ds = getDataset();
const metrics = computeMetrics(ds, S);
const linked = (name: string) => linkBottle(name, metrics).products.map((m) => m.product.name).sort();

describe("a bottle is linked to a product only when its name names exactly one", () => {
  it("the real Zoho bottle names (20 Nov 2026) that name one product each", () => {
    expect(linked("Night Cream")).toEqual(["Multipurpose Night Cream"]);
    expect(linked("Day cream")).toEqual(["Multipurpose Day Cream"]);
    expect(linked("UV Armour")).toEqual(["UV Armour Sunscreen"]);
    expect(linked("UV Armour Pump + cap")).toEqual(["UV Armour Sunscreen"]);
    expect(linked("EGF Bottles")).toEqual(["EGF Serum"]);
    expect(linked("EGF Pump")).toEqual(["EGF Serum"]);
    expect(linked("Eye Revive Bottles")).toEqual(["Eye Revive"]);
    expect(linked("Glow Forever Pump 081")).toEqual(["Glow Forever"]);
    expect(linked("Seaweed 50 ML")).toEqual(["Seaweed Sunscreen Gel"]);
    expect(linked("Seaweed Pump+cap")).toEqual(["Seaweed Sunscreen Gel"]);
    expect(linked("Purifying Serum 15ml")).toEqual(["Purifying Serum"]);
    expect(linked("Purifying Active Solution")).toEqual(["Purifying Active Solution Gel"]);
    expect(linked("Clarifying Solution Bottle")).toEqual(["Clarifying Solution"]);
    expect(linked("Collagen Serum Bottle")).toEqual(["Collagen Serum"]);
    expect(linked("Age Combat Bottle")).toEqual(["Age Combat"]);
    expect(linked("Glutabeauty")).toEqual(["Gluta Beauty"]);
    expect(linked("Multivitamin")).toEqual(["Multi-Vitamin Face Serum"]);
  });
  it("a shared cap names all its products, from the brackets", () => {
    expect(linked("7612-C Cap (Age Combat-Gluta Beauty-collagen Serum)")).toEqual(["Age Combat", "Collagen Serum", "Gluta Beauty"]);
  });
  it("a name that fits several products is not guessed", () => {
    expect(linkBottle("Vitamin C", metrics).problem).toMatchObject({ kind: "ambiguous", phrase: "vitaminc" });
    expect(linkBottle("Purifying Dropper", metrics).problem).toMatchObject({ kind: "ambiguous", phrase: "purifying" });
    expect(linked("486-C Cap (Multivitamin & Vitamin C)")).toEqual([]);
  });
  it("generic packaging names no product", () => {
    for (const n of ["White inner lid", "15ml plug", "Dropper Cap (15 ml)", "cap + pump 40", "Matt Gold Cap", "Lotion Pump 20mm", "Silver Pump Head cap 40ml", "Cap (Creams ) (Pearl gold Cap )", "Advance Collagen"]) {
      expect(linkBottle(n, metrics), n).toMatchObject({ products: [], problem: { kind: "none" } });
    }
  });
});

describe("how long a bottle lasts", () => {
  it("from Zoho's daily counts once there are 14 days: a delivery day is left out of the average", () => {
    const h = (qs: number[]) => qs.map((qty, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, qty }));
    expect(observedUse(h([100, 90, 80]))).toBeNull(); // fewer than 14 days
    const counts = [1000, 990, 980, 970, 960, 950, 2950, 2940, 2930, 2920, 2910, 2900, 2890, 2880]; // +2000 delivered on day 7
    expect(observedUse(h(counts))).toBeCloseTo(10, 6); // 10 a day: the delivery day is left out, not counted as zero use
  });
  it("from the linked product's sales until then: Night Cream bottles follow Multipurpose Night Cream", () => {
    const night = metrics.find((m) => m.product.name === "Multipurpose Night Cream")!;
    const [r] = bottleRows([{ id: "b", sku: "BOTT-NIGHT-CREAM", name: "Night Cream", unit: "Box", qty: 950, elsewhere: 0, history: [] }], metrics, ds.today, 60);
    expect(r).toMatchObject({ source: "sales", perDay: night.rate, need30: Math.ceil(night.rate * 30) });
    expect(r!.daysLeft).toBeCloseTo(950 / night.rate, 6);
    expect(r!.atRisk).toBe(950 / night.rate < 60);
    expect(r!.short90).toBe(Math.max(0, Math.ceil(night.rate * 90) - 950));
  });
  it("a shared cap is used by all its products: the paces add up", () => {
    const names = ["Age Combat", "Gluta Beauty", "Collagen Serum"];
    const sum = metrics.filter((m) => names.includes(m.product.name)).reduce((a, m) => a + m.rate, 0);
    const [r] = bottleRows([{ id: "c", sku: "x", name: "7612-C Cap (Age Combat-Gluta Beauty-collagen Serum)", unit: null, qty: 2016, elsewhere: 0, history: [] }], metrics, ds.today, 60);
    expect(r!.perDay).toBeCloseTo(sum, 6);
  });
  it("not linked and no counts yet: no pace, shown as such", () => {
    const [r] = bottleRows([{ id: "d", sku: "y", name: "15ml plug", unit: null, qty: 2000, elsewhere: 0, history: [] }], metrics, ds.today, 60);
    expect(r).toMatchObject({ perDay: null, source: null, daysLeft: null, runOut: null, atRisk: false });
  });
});
