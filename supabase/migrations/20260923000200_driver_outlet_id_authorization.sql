-- Permanent driver-to-outlet authorization by stable driver UUID.
-- Keep the legacy driver text for display/backward compatibility.

alter table public.outlets
  add column if not exists driver_id uuid references public.driver_accounts(id);

update public.outlets o
set driver_id=da.id
from public.driver_accounts da
where o.driver_id is null
  and lower(trim(o.driver))=lower(trim(da.driver_name));

create index if not exists outlets_driver_id_idx
  on public.outlets(driver_id,order_id);

create or replace function public.update_outlet_settings(
  p_order_id uuid,
  p_outlet_id uuid,
  p_access_token text,
  p_rank integer,
  p_driver text
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_driver_id uuid;
begin
  if not exists(
    select 1 from public.orders
    where id=p_order_id and access_token=p_access_token
  ) then return false; end if;

  select id into v_driver_id
  from public.driver_accounts
  where active=true
    and lower(trim(driver_name))=lower(trim(coalesce(p_driver,'')))
  limit 1;

  update public.outlets
  set outlet_rank=p_rank,
      driver=nullif(trim(p_driver),''),
      driver_id=v_driver_id
  where id=p_outlet_id and order_id=p_order_id;

  return found;
end;
$$;

create or replace function public.driver_invoice_target(
  p_session_token text,
  p_outlet_id uuid,
  p_order_id uuid,
  p_outlet_name text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_hash text;
  v_driver_id uuid;
  v_driver text;
  o public.outlets;
begin
  v_hash:=encode(extensions.digest(p_session_token,'sha256'),'hex');

  select da.id,da.driver_name into v_driver_id,v_driver
  from public.driver_accounts da
  join public.driver_sessions s on s.driver_id=da.id
  where s.token_hash=v_hash and s.expires_at>now() and da.active=true
  limit 1;

  if v_driver_id is null then
    return jsonb_build_object('ok',false,'message','Session expired');
  end if;

  select * into o
  from public.outlets x
  where x.driver_id=v_driver_id
    and (
      (p_outlet_id is not null and x.id=p_outlet_id)
      or (p_order_id is not null and x.order_id=p_order_id
          and p_outlet_name is not null
          and lower(trim(x.store_name))=lower(trim(p_outlet_name)))
      or (p_outlet_name is not null
          and lower(trim(x.store_name))=lower(trim(p_outlet_name)))
    )
  order by case when p_outlet_id is not null and x.id=p_outlet_id then 0 else 1 end,
           x.created_at desc nulls last
  limit 1;

  if o.id is null then
    return jsonb_build_object('ok',false,'message','Outlet is not assigned to this driver');
  end if;

  return jsonb_build_object(
    'ok',true,'outlet_id',o.id,'order_id',o.order_id,'store_name',o.store_name,
    'status',o.status,'driver',o.driver,'delivery_charge',o.delivery_charge,
    'driver_id',v_driver_id
  );
end;
$$;

-- Driver dashboard pages now use the stable driver_id assignment.
-- The complete function body is maintained in the live schema and should be
-- preserved when rebuilding the database.
