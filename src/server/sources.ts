import "server-only";
// Where the sync reads the CRM from: a read-only SQL login (CRM_DATABASE_URL), else the panel's gateway in the
// CRM project (PANEL_SQL_URL + PANEL_SQL_KEY), else the CRM's REST API (SUPABASE_URL + SUPABASE_SECRET_KEY),
// else nowhere (CRM jobs are skipped).
import { type CrmSource, sqlCrm } from "./crm";
import { crmRestConfig, postgrestFetcher, restCrm } from "./crm-rest";
import { gatewayConfig, gatewayDb, panelDb, postgresDb } from "./db";

export function crmSource(): CrmSource | null {
  const url = process.env.CRM_DATABASE_URL;
  if (url) return sqlCrm(postgresDb(url));
  // the panel's gateway in the CRM project: CRM reads in a read-only transaction, the same SQL as a direct login
  const gw = gatewayConfig();
  if (gw) return sqlCrm(gatewayDb(gw.url, gw.key, "crm"));
  const rest = crmRestConfig();
  return rest ? restCrm(postgrestFetcher(rest), panelDb()) : null;
}
