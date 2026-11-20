import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS as S } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { allTransfers, channelRates, comparable, computeMetrics, dailyTotals, locationBreakdown, rateFor, salesByProduct, sendToClinics, type Filters } from "./engine";
import { decodeDataset, encodeDataset, type Dataset } from "./model";

const ds = getDataset();
const metrics = computeMetrics(ds, S);
const bySku = (sku: string) => metrics.find((m) => m.product.sku === sku)!;
const ALL: Filters = { from: "2026-11-01", to: "2026-11-14", channels: [], points: [], locations: [], categories: [], search: "" };

describe("sample data tells the documented stories", () => {
  it("Hair Serum is the worked example: 7/day (420 sold in 60 days), 150 in stock (Mohali 110 + Delhi 40) lasts 21 days, Low, order 1,215", () => {
    const m = bySku("GL-HAIRSER");
    // a Night Regime product: below its 1,050-unit reorder point (150 days), so order enough to be back at 180 days
    // when it lands: 7 × (15 lead + 180 target) − 150 = 1,215 (no separate safety stock: the target includes it)
    expect(m.rule).toMatchObject({ kind: "night", reorderAtDays: 150, coverDays: 180, safetyDays: 0 });
    expect(m).toMatchObject({ rate: 7, windowSold: 420, windowDays: 60, stock: 150, warehouseStock: 110, status: "low", reorderAt: 150, reorderPoint: 1050, indentQty: 1215, indentDue: true, safety: 0, extraUnits: 0 });
    expect(Math.floor(m.cover)).toBe(21);
  });
  it("UV Armour is Critical; Seaweed Gel is rescued by an order landing in 4 days", () => {
    expect(bySku("GL-UVARMOR").status).toBe("critical");
    const sea = bySku("GL-SEASUNS");
    expect(sea.nextArrivalDays).toBe(4);
    expect(sea.status).not.toBe("critical");
  });
  it("Spa Cream is Overstock; Mascara has no sales; Aqua Mask is New", () => {
    expect(bySku("GL-SPACREM").status).toBe("overstock");
    expect(bySku("GL-MASCARA").status).toBe("no_sales");
    expect(bySku("GL-SAQMASK").isNew).toBe(true);
  });
  it("every status appears, and send-to-clinic and clinic-transfer suggestions exist", () => {
    const statuses = new Set(metrics.map((m) => m.status));
    for (const s of ["critical", "low", "healthy", "overstock", "no_sales"]) expect(statuses.has(s as never)).toBe(true);
    const sends = sendToClinics(ds, S, metrics);
    expect(sends.some((x) => x.product.sku === "GL-VITCSRM" && x.to.name === "Chandigarh" && x.qty > 0)).toBe(true);
    // clinic-to-clinic moves only for products Mohali cannot cover
    const short = new Set(sends.filter((x) => !x.covered).map((x) => x.product.id));
    for (const t of allTransfers(ds, S, metrics)) expect(short.has(t.product.id)).toBe(true);
  });
  it("daily totals add up to the per-product sales", () => {
    const perProduct = salesByProduct(ds, ALL).reduce((a, s) => a + s.qty, 0);
    const perDay = dailyTotals(ds, ALL).reduce((a, d) => a + d.total, 0);
    expect(perDay).toBe(perProduct);
    expect(perDay).toBeGreaterThan(0);
  });
});

describe("stock lives per location; channels share it", () => {
  it("locations Zoho won't let us read are unknown and left out of the total — never 0", () => {
    const m = bySku("GL-UVARMOR");
    const unreadable = ds.locations.filter((l) => !l.readable).map((l) => l.id);
    expect(unreadable.length).toBe(5);
    for (const id of unreadable) expect(m.stockByLocation[id]).toBeNull();
    expect(m.unknownLocations.sort()).toEqual(unreadable.sort());
    const readableSum = ds.locations.filter((l) => l.readable).reduce((a, l) => a + (m.stockByLocation[l.id] ?? 0), 0);
    expect(m.stock).toBe(readableSum);
  });
  it("Mohali's usage is the sum of every source that ships from it, incl. Delhi East's clinic sales", () => {
    const pi = ds.products.findIndex((p) => p.sku === "GL-TTFACEW");
    const rows = locationBreakdown(ds, S, pi, metrics[pi]!);
    const mohali = rows.find((r) => r.location.isPrimary)!;
    expect(mohali.byChannel.online_team).toBeGreaterThan(0);
    expect(mohali.byChannel.website).toBeGreaterThan(0);
    expect(ds.sources.some((s) => s.channel === "clinic" && s.clinicId === "10" && s.locationId === mohali.location.id)).toBe(true);
  });
  it("Amazon and Flipkart are not connected and contribute nothing", () => {
    expect(ds.channels.filter((c) => !c.connected).map((c) => c.id).sort()).toEqual(["amazon", "flipkart"]);
    const pi = ds.products.findIndex((p) => p.sku === "GL-VITCSRM");
    const r = channelRates(ds, S, pi);
    expect(r.amazon).toBe(0);
    expect(r.flipkart).toBe(0);
  });
});

describe("rates per channel over each channel's own history", () => {
  it("a channel whose data starts later does not drag the 90-day average down", () => {
    const n = 180;
    const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 4, 19 + i)).toISOString().slice(0, 10));
    const online = new Int32Array(n).fill(2);
    const clinic = new Int32Array(n);
    for (let d = 100; d < n; d++) clinic[d] = 2; // clinic data only for the last 80 days
    const tiny: Dataset = {
      ...ds,
      days,
      today: days[n - 1]!,
      products: [{ ...ds.products[0]!, launchedOn: days[0]! }],
      channels: ds.channels.map((c) => ({ ...c, dataFrom: c.id === "clinic" ? days[100]! : c.id === "online_team" ? days[0]! : null, connected: c.id === "clinic" || c.id === "online_team" })),
      sources: [
        { id: "o", channel: "online_team", locationId: "z-mohali", clinicId: null, label: "o" },
        { id: "c", channel: "clinic", locationId: "z-chandigarh", clinicId: "1", label: "c" },
      ],
      sold: [[online, clinic]],
      used: [[online, clinic]],
      value: [[new Float64Array(n), new Float64Array(n)]],
      inStock: undefined,
    };
    // A plain average over the summed series would give 2 + 0.2×2×(80/90) + … ≈ 3.96; per channel it is exactly 4.
    expect(rateFor(tiny, S, 0, () => true, "used").rate).toBe(4);
  });

  // Live data: one clinic recorded product sales from 28 Aug, the other eleven joined the CRM in October.
  const staggered = (lateShare: number): Dataset => {
    const n = 180;
    const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 4, 19 + i)).toISOString().slice(0, 10));
    const early = new Int32Array(n);
    const late = new Int32Array(n);
    const earlyV = new Float64Array(n);
    const lateV = new Float64Array(n);
    for (let d = 100; d < n; d++) (early[d] = 3), (earlyV[d] = 3000);
    for (let d = 150; d < n; d++) (late[d] = 2), (lateV[d] = 1000 * lateShare);
    return {
      ...ds,
      days,
      today: days[n - 1]!,
      products: [{ ...ds.products[0]!, launchedOn: days[0]! }],
      channels: ds.channels.map((c) => ({ ...c, dataFrom: c.id === "clinic" ? days[100]! : null, connected: c.id === "clinic" })),
      sources: [
        { id: "clinic:1", channel: "clinic", locationId: "z-chandigarh", clinicId: "1", label: "early", dataFrom: days[100]! },
        { id: "clinic:2", channel: "clinic", locationId: "z-ludhiana", clinicId: "2", label: "late", dataFrom: days[150]! },
      ],
      sold: [[early, late]],
      used: [[early, late]],
      value: [[earlyV, lateV]],
      inStock: undefined,
    };
  };

  it("a clinic that joined the CRM late is measured from the day it joined", () => {
    const t = staggered(1);
    // early clinic: 3/day over its 80 days; late clinic: 2/day over its 30 days → 5/day.
    // Measured over the clinic channel's 80 days, the late clinic would count 50 days of zeros (≈ 4.1/day).
    expect(rateFor(t, S, 0, () => true, "used").rate).toBe(5);
    expect(rateFor(t, S, 0, () => true, "used").byChannel.clinic).toBe(5);
  });

  it("the rate's parts show each group of sales points over its own days, and add up to the rate", () => {
    const t = staggered(1);
    const r = rateFor(t, S, 0, () => true, "used");
    expect(r.parts).toEqual([
      { days: 60, from: null, points: 1, sold: 180, rate: 3 },
      { days: 30, from: t.days[150], points: 1, sold: 60, rate: 2 },
    ]);
    expect(r.parts.reduce((a, x) => a + x.sold, 0)).toBe(r.sold);
    expect(r.parts.reduce((a, x) => a + x.rate, 0)).toBe(r.rate);
  });

  it("no growth % when the earlier period was before some sales points joined (a join is not growth)", () => {
    const t = staggered(1);
    const f: Filters = { ...ALL, from: t.days[150]!, to: t.today };
    const prevFrom = t.days[120]!;
    expect(comparable(t, f, { from: f.from, to: f.to }, prevFrom)).toBe(false); // the late clinic is 18% of sales
    expect(comparable(t, { ...f, points: ["clinic:1"] }, { from: f.from, to: f.to }, prevFrom)).toBe(true); // the early one alone compares
    expect(comparable(staggered(0.1), f, { from: f.from, to: f.to }, prevFrom)).toBe(true); // a joiner under 5% of sales is ignored
  });
});

describe("wire format", () => {
  it("encode → decode keeps every number", () => {
    const back = decodeDataset(JSON.parse(JSON.stringify(encodeDataset(ds))));
    expect(back.days).toEqual(ds.days);
    let diff = 0;
    ds.products.forEach((_, pi) =>
      ds.sources.forEach((_, si) => {
        for (let d = 0; d < ds.days.length; d++) {
          diff += Math.abs(back.sold[pi]![si]![d]! - ds.sold[pi]![si]![d]!) + Math.abs(back.used[pi]![si]![d]! - ds.used[pi]![si]![d]!);
          diff += Math.abs(back.value[pi]![si]![d]! - ds.value[pi]![si]![d]!) > 0.01 ? 1 : 0;
        }
      }),
    );
    expect(diff).toBe(0);
    expect(computeMetrics(back, S).map((m) => m.indentQty)).toEqual(metrics.map((m) => m.indentQty));
  });
});
