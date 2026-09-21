-- Outlet delivery charge management
alter table public.outlets
  add column if not exists delivery_charge numeric(12,2) not null default 0;

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
  select o.id, coalesce(o.delivery_charge,0)::numeric(12,2)
  from public.outlets o
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
begin
  if not exists(
    select 1 from public.orders
    where id=p_order_id and access_token=p_access_token
  ) then
    raise exception 'Invalid order access';
  end if;

  if coalesce(p_delivery_charge,0) < 0 then
    raise exception 'Delivery charge cannot be negative';
  end if;

  update public.outlets
  set delivery_charge=round(coalesce(p_delivery_charge,0),2)
  where id=p_outlet_id and order_id=p_order_id;

  if not found then
    raise exception 'Outlet not found';
  end if;

  return true;
end;
$$;

grant execute on function public.get_outlet_delivery_charges(uuid,text) to anon,authenticated;
grant execute on function public.update_outlet_delivery_charge(uuid,uuid,text,numeric) to anon,authenticated;
