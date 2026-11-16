import "server-only";
// Where the sync reads the CRM from: a read-only SQL login when CRM_DATABASE_URL is set, else the CRM
// project's REST API when SUPABASE_URL + SUPABASE_SECRET_KEY are set, else nowhere (CRM jobs are skipped).
import { type CrmSource, sqlCrm } from "./crm";
import { crmRestConfig, postgrestFetcher, restCrm } from "./crm-rest";
import { panelDb, postgresDb } from "./db";

export function crmSource(): CrmSource | null {
  const url = process.env.CRM_DATABASE_URL;
  if (url) return sqlCrm(postgresDb(url));
  const rest = crmRestConfig();
  return rest ? restCrm(postgrestFetcher(rest), panelDb()) : null;
}
