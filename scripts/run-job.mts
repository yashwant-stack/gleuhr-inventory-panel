// One sync job by hand, against the configured databases and Zoho (local use only):
//   npx tsx --conditions=react-server scripts/run-job.mts zoho_regimen
import { panelDb } from "../src/server/db";
import { crmSource } from "../src/server/sources";
import { runSync, type JobName } from "../src/server/sync";
import { zohoConfig } from "../src/server/zoho";

const jobs = process.argv.slice(2) as JobName[];
const results = await runSync(jobs, { panel: panelDb(), crm: crmSource(), zohoCfg: zohoConfig(), deadline: Date.now() + 15 * 60_000 });
for (const r of results) console.log(r.job, r.ok ? "ok" : "FAILED", `${r.zohoCalls} Zoho calls`, "|", r.note);
