-- Vegetable Inward v1 — receiving by vendor with graded sorting.
--
-- New objects only. Nothing existing is altered: the item list is the live
-- vegetable item table (public.inv_vegetable_items) used by the vegetable
-- count screens, referenced by foreign key, never copied.
--
-- Quantities are integer grams. A trip is one row. The same vendor and item can
-- have many rows a day (separate trips). Rows are never hard deleted: a removal
-- sets deleted_at + delete_reason so the audit trail stays complete.

-- ---------------------------------------------------------------------------
-- 1. Vendors
-- ---------------------------------------------------------------------------
create table if not exists public.veg_inward_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text generated always as (lower(btrim(name))) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint veg_inward_vendors_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint veg_inward_vendors_name_key_uniq unique (name_key)
);

comment on table public.veg_inward_vendors is
  'Vegetable inward vendors. Unique on lower(btrim(name)); deactivated, never deleted.';

-- ---------------------------------------------------------------------------
-- 2. Inward entries (one row = one trip)
-- ---------------------------------------------------------------------------
create table if not exists public.veg_inward_entries (
  id uuid primary key,
  item_id uuid not null references public.inv_vegetable_items(item_id) on delete restrict,
  vendor_id uuid not null references public.veg_inward_vendors(id) on delete restrict,
  received_at timestamptz not null,
  total_g bigint not null,
  a_g bigint,
  b_g bigint,
  dump_g bigint,
  sorted_at timestamptz,
  notes text,
  entered_by text not null default '',
  deleted_at timestamptz,
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint veg_inward_entries_total_positive check (total_g > 0),
  constraint veg_inward_entries_grades_complete check (
    (a_g is null and b_g is null and dump_g is null)
    or (a_g is not null and b_g is not null and dump_g is not null)
  ),
  constraint veg_inward_entries_grades_nonneg check (
    coalesce(a_g, 0) >= 0 and coalesce(b_g, 0) >= 0 and coalesce(dump_g, 0) >= 0
  ),
  constraint veg_inward_entries_grades_le_total check (
    coalesce(a_g, 0) + coalesce(b_g, 0) + coalesce(dump_g, 0) <= total_g
  ),
  constraint veg_inward_entries_sorted_flag check ((sorted_at is null) = (a_g is null)),
  constraint veg_inward_entries_notes_len check (notes is null or char_length(notes) <= 500),
  constraint veg_inward_entries_reason_len check (delete_reason is null or char_length(delete_reason) <= 300),
  constraint veg_inward_entries_actor_len check (char_length(entered_by) <= 60)
);

create index if not exists veg_inward_entries_received_idx
  on public.veg_inward_entries (received_at desc) where deleted_at is null;
create index if not exists veg_inward_entries_item_idx
  on public.veg_inward_entries (item_id, received_at desc) where deleted_at is null;
create index if not exists veg_inward_entries_vendor_idx
  on public.veg_inward_entries (vendor_id, received_at desc) where deleted_at is null;

comment on table public.veg_inward_entries is
  'One row per vendor trip. total_g is the weighed total; grades are null while sorting is pending.';

-- ---------------------------------------------------------------------------
-- 3. Audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.veg_inward_audit (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.veg_inward_entries(id) on delete restrict,
  action text not null,
  before jsonb,
  after jsonb,
  actor text not null,
  at timestamptz not null default now(),
  constraint veg_inward_audit_action_allowed check (action in ('create', 'sort', 'edit', 'delete')),
  constraint veg_inward_audit_actor_len check (char_length(actor) between 1 and 60)
);

create index if not exists veg_inward_audit_entry_idx
  on public.veg_inward_audit (entry_id, at desc);

comment on table public.veg_inward_audit is
  'Who changed what on an inward entry, with the row before and after. Entries are never hard deleted.';

-- ---------------------------------------------------------------------------
-- 4. Guards: keep updated_at fresh, refuse hard deletes
-- ---------------------------------------------------------------------------
create or replace function public.veg_inward_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists veg_inward_entries_touch on public.veg_inward_entries;
create trigger veg_inward_entries_touch
  before update on public.veg_inward_entries
  for each row execute function public.veg_inward_touch_updated_at();

create or replace function public.veg_inward_block_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = 'P0001',
    message = 'DELETE_BLOCKED: inward entries are removed with a reason and kept for audit.';
end;
$function$;

drop trigger if exists veg_inward_entries_no_delete on public.veg_inward_entries;
create trigger veg_inward_entries_no_delete
  before delete on public.veg_inward_entries
  for each row execute function public.veg_inward_block_hard_delete();

-- ---------------------------------------------------------------------------
-- 5. Access: service_role only
-- ---------------------------------------------------------------------------
alter table public.veg_inward_vendors enable row level security;
alter table public.veg_inward_entries enable row level security;
alter table public.veg_inward_audit enable row level security;

revoke all on table public.veg_inward_vendors from public;
revoke all on table public.veg_inward_vendors from anon;
revoke all on table public.veg_inward_vendors from authenticated;
revoke all on table public.veg_inward_entries from public;
revoke all on table public.veg_inward_entries from anon;
revoke all on table public.veg_inward_entries from authenticated;
revoke all on table public.veg_inward_audit from public;
revoke all on table public.veg_inward_audit from anon;
revoke all on table public.veg_inward_audit from authenticated;

grant all on table public.veg_inward_vendors to service_role;
grant all on table public.veg_inward_entries to service_role;
grant all on table public.veg_inward_audit to service_role;

revoke all on sequence public.veg_inward_audit_id_seq from public;
revoke all on sequence public.veg_inward_audit_id_seq from anon;
revoke all on sequence public.veg_inward_audit_id_seq from authenticated;
grant usage, select on sequence public.veg_inward_audit_id_seq to service_role;

revoke all on function public.veg_inward_touch_updated_at() from public;
revoke all on function public.veg_inward_block_hard_delete() from public;

-- ---------------------------------------------------------------------------
-- 6. Summary — the only place quantities and percentages are added up
-- ---------------------------------------------------------------------------
create or replace function public.veg_inward_summary(
  p_from_date date,
  p_to_date date,
  p_item_id uuid,
  p_vendor_id uuid
)
returns table (
  row_kind text,
  item_id uuid,
  item_name text,
  vendor_id uuid,
  vendor_name text,
  trips bigint,
  total_g text,
  sorted_g text,
  a_g text,
  b_g text,
  dump_g text,
  unaccounted_g text,
  pending_g text,
  a_pct text,
  b_pct text,
  dump_pct text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_detail bigint;
begin
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception using errcode = '22007',
      message = 'INVALID_DATE_RANGE: the start date is after the end date.';
  end if;

  -- Business dates are Indian dates: a trip counts on the day it was received
  -- in Asia/Kolkata, whatever the server time zone is.
  select count(*) into v_detail
  from (
    select 1
    from public.veg_inward_entries e
    where e.deleted_at is null
      and (p_item_id is null or e.item_id = p_item_id)
      and (p_vendor_id is null or e.vendor_id = p_vendor_id)
      and (p_from_date is null or ((e.received_at at time zone 'Asia/Kolkata')::date) >= p_from_date)
      and (p_to_date is null or ((e.received_at at time zone 'Asia/Kolkata')::date) <= p_to_date)
    group by e.item_id, e.vendor_id
  ) g;

  if v_detail > 20000 then
    raise exception using errcode = '54000',
      message = 'ROW_LIMIT_EXCEEDED: this period has more than 20,000 item and vendor rows. Choose a shorter period.';
  end if;

  return query
  with base as (
    select e.item_id,
           e.vendor_id,
           e.total_g,
           coalesce(e.a_g, 0) as a_g,
           coalesce(e.b_g, 0) as b_g,
           coalesce(e.dump_g, 0) as dump_g,
           (e.sorted_at is not null) as is_sorted
    from public.veg_inward_entries e
    where e.deleted_at is null
      and (p_item_id is null or e.item_id = p_item_id)
      and (p_vendor_id is null or e.vendor_id = p_vendor_id)
      and (p_from_date is null or ((e.received_at at time zone 'Asia/Kolkata')::date) >= p_from_date)
      and (p_to_date is null or ((e.received_at at time zone 'Asia/Kolkata')::date) <= p_to_date)
  ),
  agg as (
    select b.item_id,
           b.vendor_id,
           count(*)::bigint as trips,
           sum(b.total_g)::numeric as total,
           sum(case when b.is_sorted then b.total_g else 0 end)::numeric as sorted,
           sum(case when b.is_sorted then b.a_g else 0 end)::numeric as a,
           sum(case when b.is_sorted then b.b_g else 0 end)::numeric as b,
           sum(case when b.is_sorted then b.dump_g else 0 end)::numeric as d,
           sum(case when b.is_sorted then b.total_g - b.a_g - b.b_g - b.dump_g else 0 end)::numeric as unacc,
           sum(case when b.is_sorted then 0 else b.total_g end)::numeric as pending
    from base b
    group by b.item_id, b.vendor_id
  ),
  vendor_rows as (
    select 'vendor'::text as row_kind,
           x.item_id,
           i.name_en as item_name,
           v.id as vendor_id,
           v.name as vendor_name,
           x.trips, x.total, x.sorted, x.a, x.b, x.d, x.unacc, x.pending,
           1 as lvl
    from agg x
    join public.inv_vegetable_items i on i.item_id = x.item_id
    join public.veg_inward_vendors v on v.id = x.vendor_id
  ),
  item_rows as (
    select 'item'::text as row_kind,
           i.item_id,
           i.name_en as item_name,
           null::uuid as vendor_id,
           null::text as vendor_name,
           sum(x.trips) as trips, sum(x.total) as total, sum(x.sorted) as sorted,
           sum(x.a) as a, sum(x.b) as b, sum(x.d) as d, sum(x.unacc) as unacc, sum(x.pending) as pending,
           0 as lvl
    from agg x
    join public.inv_vegetable_items i on i.item_id = x.item_id
    group by i.item_id, i.name_en
  ),
  total_rows as (
    select 'total'::text as row_kind,
           null::uuid as item_id,
           null::text as item_name,
           null::uuid as vendor_id,
           null::text as vendor_name,
           coalesce(sum(x.trips), 0) as trips,
           coalesce(sum(x.total), 0) as total,
           coalesce(sum(x.sorted), 0) as sorted,
           coalesce(sum(x.a), 0) as a,
           coalesce(sum(x.b), 0) as b,
           coalesce(sum(x.d), 0) as d,
           coalesce(sum(x.unacc), 0) as unacc,
           coalesce(sum(x.pending), 0) as pending,
           2 as lvl
    from agg x
  ),
  all_rows as (
    select * from item_rows
    union all
    select * from vendor_rows
    union all
    select * from total_rows
  )
  select r.row_kind,
         r.item_id,
         r.item_name,
         r.vendor_id,
         r.vendor_name,
         r.trips::bigint,
         r.total::text,
         r.sorted::text,
         r.a::text,
         r.b::text,
         r.d::text,
         r.unacc::text,
         r.pending::text,
         case when r.sorted > 0 then round(100 * r.a / r.sorted, 1)::text end as a_pct,
         case when r.sorted > 0 then round(100 * r.b / r.sorted, 1)::text end as b_pct,
         case when r.sorted > 0 then round(100 * r.d / r.sorted, 1)::text end as dump_pct
  from all_rows r
  order by (r.row_kind = 'total')::int,
           r.item_name nulls last,
           r.item_id,
           r.lvl,
           case when r.sorted > 0 then r.a / r.sorted end desc nulls last,
           r.vendor_name nulls last;
end;
$function$;

revoke all on function public.veg_inward_summary(date, date, uuid, uuid) from public;
revoke all on function public.veg_inward_summary(date, date, uuid, uuid) from anon;
revoke all on function public.veg_inward_summary(date, date, uuid, uuid) from authenticated;
grant execute on function public.veg_inward_summary(date, date, uuid, uuid) to service_role;

comment on function public.veg_inward_summary(date, date, uuid, uuid) is
  'Per item and vendor inward totals with item subtotals and a grand total. Percentages are computed here from sorted entries only.';
