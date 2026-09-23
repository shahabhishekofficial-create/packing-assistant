-- Production Inventory module SQL source.
-- Applied to Supabase project pbhkuofylhqcqmspubmb on 2026-09-23.
-- Browser access is through the inv_* RPC contract; direct table grants are revoked.

create table if not exists public.inv_items (
 id uuid primary key default extensions.gen_random_uuid(),
 section text not null check(section in ('restaurant','vegetable')),
 name text not null, aliases text[] not null default '{}',
 unit text not null default 'pcs', category text not null default 'Uncategorized',
 active boolean not null default true
);
create table if not exists public.inv_item_barcodes (
 barcode text primary key, item_id uuid not null references public.inv_items(id) on delete restrict
);
create table if not exists public.inv_count_sessions (
 id uuid primary key default extensions.gen_random_uuid(),
 section text not null check(section in ('restaurant','vegetable')),
 date date not null default current_date, counted_by text not null,
 status text not null default 'open' check(status in ('open','submitted')),
 created_at timestamptz not null default now(), submitted_at timestamptz
);
create table if not exists public.inv_stock_counts (
 id uuid primary key default extensions.gen_random_uuid(),
 session_id uuid not null references public.inv_count_sessions(id) on delete restrict,
 item_id uuid not null references public.inv_items(id) on delete restrict,
 qty numeric not null check(qty>=0), counted_by text not null,
 counted_at timestamptz not null default now(), note text
);
alter table public.inv_items enable row level security;
alter table public.inv_item_barcodes enable row level security;
alter table public.inv_count_sessions enable row level security;
alter table public.inv_stock_counts enable row level security;
revoke all on table public.inv_items,public.inv_item_barcodes,public.inv_count_sessions,public.inv_stock_counts from anon,authenticated;

-- The RPCs below are the application contract. They all validate the existing
-- custom Admin session token before reading/writing inventory data.
-- Keep their current production definitions when rebuilding the project:
-- inv_require_admin(text)
-- inv_get_items(text,text)
-- inv_add_item(text,text,text,text[],text,text)
-- inv_link_barcode(text,text,uuid)
-- inv_bulk_add_items(text,text,jsonb)
-- inv_start_session(text,text,date,text)
-- inv_save_count(text,uuid,uuid,numeric,text,text)
-- inv_submit_session(text,uuid)
-- inv_report_latest(text,text,date,date,text)
-- inv_report_history(text,text,date,date,text)
-- inv_report_not_counted(text,uuid)

-- See PROJECT_MASTER.md for the full RPC contract and security design.
