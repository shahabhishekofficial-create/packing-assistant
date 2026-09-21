-- Historical multi-day reporting
-- Run this once in Supabase SQL Editor.

create or replace function public.get_order_history(
  p_access_token text
) returns table(
  order_id uuid,
  order_name text,
  created_at timestamptz,
  completed_at timestamptz,
  order_status text,
  outlet_count bigint,
  item_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.orders where access_token = p_access_token
  ) then
    raise exception 'Invalid access token';
  end if;

  return query
  select
    o.id,
    o.order_name,
    o.created_at,
    o.completed_at,
    case when o.completed_at is null then 'ACTIVE' else 'COMPLETED' end,
    count(distinct ot.id),
    count(oi.id)
  from public.orders o
  left join public.outlets ot on ot.order_id = o.id
  left join public.order_items oi on oi.outlet_id = ot.id
  group by o.id, o.order_name, o.created_at, o.completed_at
  order by o.created_at desc;
end;
$$;

grant execute on function public.get_order_history(text) to anon, authenticated;

create or replace function public.get_report_data(
  p_access_token text,
  p_from_date date default null,
  p_to_date date default null
) returns table(
  order_id uuid,
  order_name text,
  order_created_at timestamptz,
  order_completed_at timestamptz,
  outlet_id uuid,
  outlet_name text,
  outlet_rank integer,
  driver text,
  outlet_status text,
  item_id uuid,
  item_code text,
  product_name text,
  required_qty numeric,
  packed_qty numeric,
  missing_qty numeric,
  item_status text,
  reason text,
  item_started_at timestamptz,
  item_completed_at timestamptz,
  packer_device text,
  delivery_status text,
  delivered_at timestamptz,
  invoice_filename text,
  invoice_uploaded_at timestamptz,
  delivery_charge numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.orders where access_token = p_access_token
  ) then
    raise exception 'Invalid access token';
  end if;

  return query
  select
    ord.id,
    ord.order_name,
    ord.created_at,
    ord.completed_at,
    out.id,
    out.store_name,
    out.outlet_rank,
    out.driver,
    out.status,
    item.id,
    item.item_code,
    item.product_name,
    item.required_qty,
    coalesce(item.packed_qty,0),
    coalesce(item.missing_qty,0),
    case when item.status='pending' then 'PENDING' else upper(item.status) end,
    coalesce(item.reason,''),
    item.started_at,
    item.completed_at,
    (
      select pe.device_id
      from public.packing_events pe
      where pe.item_id = item.id
      order by pe.created_at desc
      limit 1
    ),
    coalesce(dr.status,'pending'),
    dr.delivered_at,
    dr.invoice_filename,
    dr.invoice_uploaded_at,
    coalesce(dr.delivery_charge,0)
  from public.orders ord
  join public.outlets out on out.order_id = ord.id
  join public.order_items item on item.outlet_id = out.id
  left join public.delivery_records dr
    on dr.order_id = ord.id and dr.outlet_id = out.id
  where (p_from_date is null or ord.created_at >= (p_from_date::text || ' 00:00:00 Asia/Kolkata')::timestamptz)
    and (p_to_date is null or ord.created_at < ((p_to_date + 1)::text || ' 00:00:00 Asia/Kolkata')::timestamptz)
  order by ord.created_at desc,
           out.outlet_rank nulls last,
           out.store_name,
           item.narration_rank nulls last,
           item.product_name;
end;
$$;

grant execute on function public.get_report_data(text,date,date) to anon, authenticated;
