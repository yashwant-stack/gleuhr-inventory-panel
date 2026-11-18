-- One-time setup of the inventory panel inside the shared CRM database (project gleuhr-clinic-prod),
-- run as `postgres`. It ONLY creates new things; no existing schema, table, row, grant or policy changes.
--
--   role   inventory_panel  NOLOGIN, owns the schema below and nothing else: it has no rights on the CRM's tables.
--   schema inventory_panel  every panel table (the migration in supabase/migrations/ is applied into it, as that role,
--                            through the gateway function: supabase/functions/inventory-panel-sql).
--
-- The gateway connects as postgres and, per request:
--   panel queries → SET LOCAL ROLE inventory_panel, search_path inventory_panel (cannot touch CRM tables);
--   CRM reads     → a READ ONLY transaction (any write is refused by Postgres).
-- The schema is not exposed to the Data API, so the CRM's anon / authenticated users cannot reach it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'inventory_panel') then
    create role inventory_panel nologin;
  end if;
end $$;

-- the gateway (postgres) may switch to the role; it does not inherit the role's rights
grant inventory_panel to postgres with inherit false, set true;

create schema if not exists inventory_panel authorization inventory_panel;
revoke all on schema inventory_panel from public;
