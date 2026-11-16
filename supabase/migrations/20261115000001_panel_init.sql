-- Gleuhr inventory panel — its own database.
-- Stock comes from Zoho Inventory (per location); sales come from the clinic + online CRM database
-- (per channel); everything else (settings, approvals, plans, the sync log) is the panel's own.
-- Every table has row-level security ON and no policies: only the server (service role / direct
-- connection) reads or writes. The browser never talks to this database directly.

-- ── Zoho: where stock sits ──────────────────────────────────────────────────
create table if not exists locations (
  zoho_location_id text primary key,
  name text not null,
  kind text not null default 'clinic' check (kind in ('warehouse', 'clinic', 'darkstore')),
  -- Zoho's primary location: an adjustment sent without a location lands here.
  is_primary boolean not null default false,
  -- false when the Zoho login is refused (stock unknown, never 0).
  readable boolean not null default true,
  active boolean not null default true,
  -- last time the sync tried this location's stock (null = never: the panel shows no data until every location was tried).
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists products (
  zoho_item_id text primary key,
  sku text,
  name text not null,
  category text,
  unit text,
  sell_price numeric,
  purchase_price numeric,
  reorder_level numeric,
  vendor_name text,
  pack_size integer not null default 1 check (pack_size >= 1),
  -- false = Zoho does not track stock for this item (a service, a plan): nothing to plan.
  track_inventory boolean not null default true,
  active boolean not null default true,
  -- false = missing from Zoho's latest item list.
  in_zoho boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Latest stock per item per location (one Zoho call per location refreshes a whole column).
create table if not exists stock_levels (
  zoho_item_id text not null,
  zoho_location_id text not null,
  qty numeric not null,
  read_at timestamptz not null,
  primary key (zoho_item_id, zoho_location_id)
);

-- One photo of stock per IST day: history for trends and stock-out days.
create table if not exists stock_snapshots (
  day date not null,
  zoho_item_id text not null,
  zoho_location_id text not null,
  qty numeric not null,
  primary key (day, zoho_item_id, zoho_location_id)
);

create table if not exists purchase_orders (
  zoho_po_id text not null,
  zoho_item_id text not null,
  vendor_name text,
  qty_open numeric not null,
  ordered_on date,
  expected_on date,
  status text,
  read_at timestamptz not null default now(),
  primary key (zoho_po_id, zoho_item_id)
);

-- What the Zoho login may read (checked by the sync).
create table if not exists zoho_access (
  area text primary key,
  ok boolean not null,
  note text not null,
  checked_at timestamptz not null default now()
);

-- ── CRM: where sales come from ──────────────────────────────────────────────
-- The CRMs' own product list (retail_products), with the Zoho item each one is linked to.
-- A product with no Zoho item cannot be planned: its sales are left out and Data health lists it.
create table if not exists crm_products (
  crm_product_id bigint primary key,
  name text not null,
  sku text,
  zoho_item_id text,
  price numeric,
  active boolean not null,
  -- the IST day the product was added to the CRM: the start of its sales history
  created_on date,
  -- the online CRM's category (online_product_meta); Zoho's items carry none
  category text,
  updated_at timestamptz not null default now()
);
alter table crm_products add column if not exists category text;
create index if not exists crm_products_zoho on crm_products (zoho_item_id);

create table if not exists crm_clinics (
  crm_clinic_id bigint primary key,
  name text not null,
  active boolean not null,
  -- null: not linked; Zoho books this clinic's stock changes on the primary location.
  zoho_location_id text,
  updated_at timestamptz not null default now()
);

-- Daily totals of the CRMs' stock movements, per product × clinic × channel × kind.
-- qty and value keep the CRM's sign: negative = stock out (a sale), positive = stock in (a return).
create table if not exists daily_flows (
  day date not null,
  crm_product_id bigint not null,
  crm_clinic_id bigint not null,
  channel text not null check (channel in ('clinic', 'online_team', 'website', 'amazon', 'flipkart')),
  kind text not null check (kind in ('sale', 'return', 'free', 'exchange', 'stock_in', 'loss')),
  qty numeric not null,
  value numeric not null default 0,
  movements integer not null default 0,
  primary key (day, crm_product_id, crm_clinic_id, channel, kind)
);
create index if not exists daily_flows_day on daily_flows (day);

-- CRM stock changes Zoho refused (last 30 days), per clinic.
create table if not exists push_health (
  crm_clinic_id bigint primary key,
  location_name text not null,
  failed integer not null,
  first_failed date,
  last_failed date,
  top_error text,
  checked_at timestamptz not null default now()
);

-- ── the panel's own records ─────────────────────────────────────────────────
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists indent_approvals (
  id bigserial primary key,
  zoho_item_id text not null,
  qty numeric not null check (qty > 0),
  approved_by text not null,
  approved_at timestamptz not null default now(),
  note text
);

-- A new submission is a new version; earlier ones are kept.
create table if not exists plan_submissions (
  id bigserial primary key,
  cycle_id text not null,
  part text not null check (part in ('marketing', 'sales', 'd2c', 'clinic')),
  submitted_by text not null,
  submitted_at timestamptz not null default now(),
  version integer not null,
  lines jsonb not null,
  note text,
  unique (cycle_id, part, version)
);

create table if not exists notifications_log (
  id bigserial primary key,
  kind text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipients text[] not null,
  sent_at timestamptz not null default now(),
  status text not null,
  summary text,
  error text
);

-- ── sync machinery ──────────────────────────────────────────────────────────
create table if not exists sync_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows_written integer not null default 0,
  zoho_calls integer not null default 0,
  note text
);
create index if not exists sync_runs_job on sync_runs (job, started_at desc);

-- One sync at a time (a lock row, not a session lock: it works through a connection pool).
create table if not exists sync_lock (
  id integer primary key default 1 check (id = 1),
  started_at timestamptz not null
);

-- One cached Zoho access token (1 hour), so each run does not mint a new one.
create table if not exists zoho_token (
  id integer primary key default 1 check (id = 1),
  access_token text not null,
  expires_at timestamptz not null
);

-- The panel's own Zoho call count per minute: its ceilings sit far below the org's shared limit.
create table if not exists zoho_calls (
  minute timestamptz primary key,
  calls integer not null
);

-- ── staging for the CRM's REST path ─────────────────────────────────────────
-- When the CRM is read through its REST API, a window's movements and the bills / orders / lines /
-- offers they point to are copied here, the same sales query runs on them, and they are emptied again.
create schema if not exists crm_stage;
create table if not exists crm_stage.stock_movements (id bigint primary key, product_id bigint, clinic_id bigint, qty integer,
  reason text, online_order_id bigint, product_sale_id bigint, created_at timestamptz);
create table if not exists crm_stage.product_sales (id bigint primary key, complimentary boolean, total_amount numeric);
create table if not exists crm_stage.product_sale_lines (id bigint primary key, product_sale_id bigint, product_id bigint, qty integer,
  unit_price numeric, discount_pct numeric);
create index if not exists crm_stage_psl on crm_stage.product_sale_lines (product_sale_id, product_id);
create table if not exists crm_stage.online_orders (id bigint primary key, disc_mode text, round_off numeric);
create table if not exists crm_stage.online_order_lines (id bigint primary key, order_id bigint, product_id bigint, qty integer,
  disc_pct numeric, offer_id bigint, unit_price_hist numeric);
create index if not exists crm_stage_ool on crm_stage.online_order_lines (order_id, product_id);
create table if not exists crm_stage.online_shopify_orders (id bigint primary key, order_id bigint);
create table if not exists crm_stage.online_offers (id bigint primary key, type text, bogo_type text, paid_pct numeric);
create table if not exists crm_stage.retail_products (id bigint primary key, price numeric);

insert into settings (key, value) values
  ('zoho.max_calls_per_minute', '10'),
  ('zoho.max_calls_per_day', '600'),
  ('panel.history_days', '180'),
  ('lead.default_days', '15'),
  ('cost.fallback_ratio', '0.3')
on conflict (key) do nothing;

do $$
declare t text;
begin
  foreach t in array array['locations','products','stock_levels','stock_snapshots','purchase_orders','zoho_access','crm_products','crm_clinics',
    'daily_flows','push_health','settings','indent_approvals','plan_submissions','notifications_log','sync_runs','zoho_token','zoho_calls',
    'sync_lock']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['stock_movements','product_sales','product_sale_lines','online_orders','online_order_lines',
    'online_shopify_orders','online_offers','retail_products']
  loop
    execute format('alter table crm_stage.%I enable row level security', t);
  end loop;
end $$;
