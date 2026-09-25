-- Inventory V2 additive schema. Existing inventory tables/RPCs remain untouched.
create table if not exists public.inv_v2_items (
 id uuid primary key default extensions.gen_random_uuid(),
 legacy_item_id uuid unique not null references public.inv_items(id) on delete restrict,
 section text not null check(section in ('restaurant','vegetable')),
 name text not null,name_normalized text not null,aliases text[] not null default '{}',
 category text not null,base_uom text not null check(base_uom in ('kg','L','pcs')),
 count_mode text not null check(count_mode in ('unit','packet')),
 default_pack_size numeric null check(default_pack_size is null or default_pack_size>0),
 no_barcode boolean not null,brand text null,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists inv_v2_items_section_name_uq on public.inv_v2_items(section,lower(name_normalized));
create table if not exists public.inv_v2_item_barcodes (
 barcode text primary key,item_id uuid not null references public.inv_v2_items(id) on delete restrict,created_at timestamptz not null default now()
);
create index if not exists inv_v2_item_barcodes_item_idx on public.inv_v2_item_barcodes(item_id);
create table if not exists public.inv_barcode_lookup_cache (
 barcode text primary key,source text not null default 'open_food_facts',fetched_at timestamptz not null default now(),
 found boolean not null default false,raw_response jsonb null,image_url text null,fetched_by text null
);
create table if not exists public.inv_v2_audit_log (
 id bigint generated always as identity primary key,action text not null,actor text null,item_id uuid null,import_id uuid null,
 barcode text null,old_data jsonb null,new_data jsonb null,result text not null default 'success',created_at timestamptz not null default now()
);
alter table public.inv_v2_items enable row level security;
alter table public.inv_v2_item_barcodes enable row level security;
alter table public.inv_barcode_lookup_cache enable row level security;
alter table public.inv_v2_audit_log enable row level security;
revoke all on public.inv_v2_items,public.inv_v2_item_barcodes,public.inv_barcode_lookup_cache,public.inv_v2_audit_log from anon,authenticated,public;
-- END OF PART 1/1