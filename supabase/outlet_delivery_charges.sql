-- Outlet delivery charge management
-- Delivery charges are persistent outlet settings. They are copied into each
-- new order and updated whenever Admin changes the charge.

alter table public.outlets
  add column if not exists delivery_charge numeric(12,2) not null default 0;

create table if not exists public.outlet_delivery_charge_defaults (
  store_name text primary key,
  delivery_charge numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  constraint outlet_delivery_charge_defaults_store_name_chk check (trim(store_name) <> ''),
  constraint outlet_delivery_charge_defaults_charge_chk check (delivery_charge >= 0)
);

alter table public.outlet_delivery_charge_defaults enable row level security;
revoke all on table public.outlet_delivery_charge_defaults from anon, authenticated;

insert into public.outlet_delivery_charge_defaults(store_name, delivery_charge)
select distinct on (store_name)
  trim(store_name),
  round(coalesce(delivery_charge,0),2)
from public.outlets
where trim(store_name) <> ''
order by store_name, created_at desc
on conflict (store_name) do nothing;

create or replace function public.get_outlet_delivery_charges(
  p_order_id uuid,
  p_access_token text
)
returns table(outlet_id uuid, delivery_charge numeric)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists(
    select 1 from public.orders
    where id=p_order_id and access_token=p_access_token
  ) then
    raise exception 'Invalid order access';
  end if;

  return query
  select
    o.id,
    round(coalesce(d.delivery_charge, o.delivery_charge, 0),2)::numeric(12,2)
  from public.outlets o
  left join public.outlet_delivery_charge_defaults d
    on lower(trim(d.store_name))=lower(trim(o.store_name))
  where o.order_id=p_order_id;
end;
$$;

create or replace function public.update_outlet_delivery_charge(
  p_order_id uuid,
  p_outlet_id uuid,
  p_access_token text,
  p_delivery_charge numeric
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_store_name text;
  v_charge numeric(12,2);
begin
  if not exists(
    select 1 from public.orders
    where id=p_order_id and access_token=p_access_token
  ) then
    raise exception 'Invalid order access';
  end if;

  v_charge := round(coalesce(p_delivery_charge,0),2);
  if v_charge < 0 then
    raise exception 'Delivery charge cannot be negative';
  end if;

  select store_name into v_store_name
  from public.outlets
  where id=p_outlet_id and order_id=p_order_id;

  if not found then
    raise exception 'Outlet not found';
  end if;

  update public.outlets
  set delivery_charge=v_charge
  where id=p_outlet_id and order_id=p_order_id;

  insert into public.outlet_delivery_charge_defaults(store_name, delivery_charge, updated_at)
  values(trim(v_store_name),v_charge,now())
  on conflict (store_name) do update
    set delivery_charge=excluded.delivery_charge,
        updated_at=now();

  return true;
end;
$$;

grant execute on function public.get_outlet_delivery_charges(uuid,text) to anon,authenticated;
grant execute on function public.update_outlet_delivery_charge(uuid,uuid,text,numeric) to anon,authenticated;

-- create_order must copy the saved outlet charge into every new order.
create or replace function public.create_order(p_order_name text, p_access_token text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_order_id uuid; v_outlet_id uuid; v_store text; v_item jsonb;
begin
  perform pg_advisory_xact_lock(839274612);
  if p_order_name is null or trim(p_order_name) = '' then raise exception 'Order name is required'; end if;
  if p_access_token is null or length(p_access_token) < 20 then raise exception 'Invalid access token'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Order contains no items'; end if;

  update public.orders set is_current=false where is_current=true;

  insert into public.orders(order_name,access_token,is_current)
  values(trim(p_order_name),p_access_token,true)
  returning id into v_order_id;

  for v_store in select distinct trim(value->>'store_name') from jsonb_array_elements(p_items) value where trim(value->>'store_name')<>'' loop
    insert into public.outlets(order_id,store_name,delivery_charge)
    values(
      v_order_id,
      v_store,
      round(coalesce((
        select d.delivery_charge
        from public.outlet_delivery_charge_defaults d
        where lower(trim(d.store_name))=lower(trim(v_store))
      ),0),2)
    )
    returning id into v_outlet_id;

    for v_item in select value from jsonb_array_elements(p_items) value where trim(value->>'store_name')=v_store loop
      insert into public.order_items(order_id,outlet_id,item_code,product_name,voice_text,required_qty,narration_rank)
      values(v_order_id,v_outlet_id,trim(v_item->>'item_code'),trim(v_item->>'product_name'),coalesce(nullif(trim(v_item->>'voice_text'),''),trim(v_item->>'product_name')),(v_item->>'required_qty')::numeric,(v_item->>'narration_rank')::integer);
    end loop;
  end loop;
  return v_order_id;
exception when unique_violation then raise exception 'Duplicate outlet/item code detected in this order';
end;
$function$;
