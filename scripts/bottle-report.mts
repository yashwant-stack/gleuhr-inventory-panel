// The live bottle projections as the Bottles page shows them (local use):
//   npx tsx --conditions=react-server scripts/bottle-report.mts
import { bottleRows } from "../src/lib/data/bottles";
import { computeMetrics } from "../src/lib/data/engine";
import { DEFAULT_FORMULA_SETTINGS, DEFAULT_LEAD_DAYS } from "../src/lib/domain/types";
import { buildDataset } from "../src/server/dataset";
import { panelDb } from "../src/server/db";

const ds = await buildDataset(panelDb());
const rows = bottleRows(ds.bottles ?? [], computeMetrics(ds, DEFAULT_FORMULA_SETTINGS), ds.today, DEFAULT_LEAD_DAYS);
const f = (n: number | null) => (n === null ? "—" : Number.isFinite(n) ? Math.round(n).toLocaleString("en-IN") : "∞");
for (const r of rows) {
  const used = r.link.products.map((m) => m.product.name).join(" + ") || (r.link.problem?.kind === "ambiguous" ? `NOT LINKED: "${r.link.problem.phrase}" fits ${r.link.problem.candidates.length}` : "NOT LINKED");
  console.log(`${r.atRisk ? "!" : " "} ${r.bottle.name.slice(0, 44).padEnd(44)} ${f(r.bottle.qty).padStart(9)} | ${r.perDay === null ? "—".padStart(6) : r.perDay.toFixed(1).padStart(6)}/day | ${f(r.daysLeft).padStart(6)} days | short 90d ${f(r.short90).padStart(7)} | ${used}`);
}
console.log(`\n${rows.length} bottle items, ${rows.filter((r) => r.perDay !== null).length} paced, ${rows.filter((r) => r.atRisk).length} run out within ${DEFAULT_LEAD_DAYS} days; elsewhere > 0: ${(ds.bottles ?? []).filter((b) => b.elsewhere > 0).length}`);
