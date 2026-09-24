-- Driver delivery V2 migration
-- Adds persistent outlet->driver defaults, invoice number, and versioned driver/order RPCs.
-- Existing delivery/order RPCs are intentionally left untouched.

create table if not exists public.outlet_driver_defaults (
  store_name text primary key check (trim(store_name) <> ''),
  driver_id uuid null references public.driver_accounts(id),
  driver_name text null,
  updated_at timestamptz not null default now()
);
alter table public.outlet_driver_defaults enable row level security;
alter table public.delivery_records add column if not exists invoice_number text;
create unique index if not exists delivery_records_order_outlet_uidx on public.delivery_records(order_id,outlet_id);

-- The canonical definitions are deployed through the Supabase project migration runner.
-- See the versioned RPC names:
-- create_order_v2
-- update_outlet_settings_v2
-- get_driver_dashboard_page_v2
-- save_driver_item_rejections_v2
-- driver_invoice_target_v2
