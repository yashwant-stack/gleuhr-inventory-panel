// The Purchase-only additions (decided 20 Nov 2026): segments, Total inventory value, and campaigns / festivals
// that feed Order now.
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { DEFAULT_FORMULA_SETTINGS as S, parseSegment } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { canOpen, inNav, roleById } from "../roles";
import { eventExtra, eventImpact, type Campaign } from "./campaigns";
import { computeMetrics, inventoryValue } from "./engine";

const ds = getDataset();

describe("segments from the Zoho field", () => {
  it("follows the founder's rule for Zoho's Type Regimen field (20 Nov 2026)", () => {
    // night → Night Regime; anytime → Wellness; anything else → Day Regime
    expect(parseSegment("Night regimen")).toBe("night");
    expect(parseSegment("anytime")).toBe("wellness");
    expect(parseSegment("Any time")).toBe("wellness");
    expect(parseSegment("day regimen")).toBe("day");
    expect(parseSegment("after lunch")).toBe("day");
    expect(parseSegment("Day regimen, after lunch/breakfast")).toBe("day");
    expect(parseSegment("twice daily")).toBe("day");
    // two or three in one field: the longest day limit wins (Night 150 → 180 beats Day / Wellness 120 → 150)
    expect(parseSegment("Day regimen, Night regimen")).toBe("night");
    expect(parseSegment("anytime, night regimen")).toBe("night");
    expect(parseSegment("day regimen, anytime, night regimen")).toBe("night");
    // Day and Wellness have the same limits: Wellness
    expect(parseSegment("day regimen, anytime")).toBe("wellness");
    // empty = not set in Zoho
    expect(parseSegment("")).toBeNull();
    expect(parseSegment("   ")).toBeNull();
    expect(parseSegment(null)).toBeNull();
  });
  it("the longest day limit follows the settings: if Day were given a longer target, Day would win", () => {
    expect(parseSegment("Day regimen, Night regimen", { ...S, dayTargetDays: 200 })).toBe("day");
  });
});

describe("Total inventory value", () => {
  const inv = inventoryValue(ds, ds.products, 0);
  it("adds the warehouse, the clinics and the darkstores at cost, and leaves unreadable locations out", () => {
    let want = 0;
    for (const p of ds.products) for (const l of ds.locations) if (l.readable) want += Math.max(0, ds.stock[p.id]?.[l.id] ?? 0) * p.cost;
    expect(inv.total).toBeCloseTo(want, 6);
    expect(inv.byKind.warehouse + inv.byKind.clinic + inv.byKind.darkstore).toBeCloseTo(want, 6);
    expect(inv.unreadable).toEqual(ds.locations.filter((l) => !l.readable).map((l) => l.name));
  });
  it("the segments add up to the stock value, and unused bottles are added on top", () => {
    expect(inv.bySegment.reduce((a, g) => a + g.value, 0)).toBeCloseTo(inv.total, 6);
    expect(inventoryValue(ds, ds.products, 250000).total).toBeCloseTo(inv.total + 250000, 6);
  });
  it("says how much uses an estimated cost", () => {
    expect(inv.estimated).toBeCloseTo(inv.total, 6); // every sample cost is 30% of the price
  });
});

describe("campaigns and festivals feed Order now", () => {
  const metrics = computeMetrics(ds, S);
  const pi = ds.products.findIndex((p) => p.name === "Hair Serum");
  const m = metrics[pi]!;
  const camp: Campaign = {
    id: "c1", name: "Hair week", from: addDays(ds.today, 5), to: addDays(ds.today, 14), budget: 50000, segment: "all",
    productIds: [m.product.id], channels: [], clinicIds: [], uplift: { conservative: 10, expected: 20, aggressive: 30 }, scenario: "expected", applied: false,
  };

  it("extra units = usage per day × days × uplift %, and only applied events count", () => {
    const off = eventExtra(ds, S, pi, { campaigns: [camp], festivals: [] }, ds.today, addDays(ds.today, 104));
    expect(off.units).toBe(0);
    const on = eventExtra(ds, S, pi, { campaigns: [{ ...camp, applied: true }], festivals: [] }, ds.today, addDays(ds.today, 104));
    expect(on.units).toBeCloseTo(m.rate * 10 * 0.2, 1);
  });

  it("the impact preview's 'with' order is what Order now becomes once the campaign is applied", () => {
    const pre = eventImpact(ds, S, metrics, { campaign: camp });
    const row = pre.rows.find((r) => r.product.id === m.product.id)!;
    expect(row.orderWithout).toBe(m.indentQty);
    const appliedMetrics = computeMetrics(ds, S, {}, (i, from, to) => eventExtra(ds, S, i, { campaigns: [{ ...camp, applied: true }], festivals: [] }, from, to));
    expect(appliedMetrics[pi]!.indentQty).toBe(row.orderWith);
    expect(row.orderWith).toBeGreaterThan(row.orderWithout);
    // and the preview of an applied campaign still compares with vs without it
    const after = eventImpact(ds, S, appliedMetrics, { campaign: { ...camp, applied: true } }).rows.find((r) => r.product.id === m.product.id)!;
    expect([after.orderWithout, after.orderWith]).toEqual([row.orderWithout, row.orderWith]);
  });

  it("a scenario changes the uplift", () => {
    const t = (s: "conservative" | "aggressive") => eventImpact(ds, S, metrics, { campaign: camp }, s).totals.extra;
    expect(t("aggressive")).toBeCloseTo(t("conservative") * 3, 6);
  });
});

describe("Purchase-only pages", () => {
  it("only Purchase opens Marketing impact or sees it in the menu", () => {
    for (const id of ["management", "marketing", "sales", "supply"] as const) {
      expect(canOpen("/marketing-impact", roleById(id).access, id)).toBe(false);
      expect(inNav("/marketing-impact", id)).toBe(false);
    }
    expect(canOpen("/marketing-impact", roleById("purchase").access, "purchase")).toBe(true);
    expect(inNav("/marketing-impact", "purchase")).toBe(true);
  });
});
