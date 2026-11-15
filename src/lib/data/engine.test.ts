import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA_SETTINGS as S } from "../domain/types";
import { getDataset } from "../mock/dataset";
import { allTransfers, channelRates, computeMetrics, dailyTotals, locationBreakdown, rateFor, salesByProduct, sendToClinics, type Filters } from "./engine";
import { decodeDataset, encodeDataset, type Dataset } from "./model";

const ds = getDataset();
const metrics = computeMetrics(ds, S);
const bySku = (sku: string) => metrics.find((m) => m.product.sku === sku)!;
const ALL: Filters = { from: "2026-11-01", to: "2026-11-14", channels: [], points: [], locations: [], categories: [], search: "" };

describe("sample data tells the documented stories", () => {
  it("Hair Serum is the worked example: 8.8/day, 150 in stock (Mohali 110 + Delhi 40), Low, order 308", () => {
    const m = bySku("GL-HAIRSER");
    expect(m.rate).toBe(8.8);
    expect(m.stock).toBe(150);
    expect(m.warehouseStock).toBe(110);
    expect(m.status).toBe("low");
    expect(m.indentQty).toBe(308);
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
