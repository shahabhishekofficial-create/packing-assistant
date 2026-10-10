-- Additive outlet-location support. Existing packing, assignment and delivery tables remain unchanged.
create table if not exists public.outlet_location_master (
  store_name text primary key,
  normalized_store_name text generated always as (lower(regexp_replace(trim(store_name), '[[:space:]]+', ' ', 'g'))) stored,
  address text not null default '',
  latitude double precision,
  longitude double precision,
  maps_url text not null default '',
  location_verified boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint outlet_location_latitude_chk check (latitude is null or latitude between -90 and 90),
  constraint outlet_location_longitude_chk check (longitude is null or longitude between -180 and 180),
  constraint outlet_location_pair_chk check ((latitude is null) = (longitude is null)),
  constraint outlet_location_name_chk check (trim(store_name) <> '')
);
create unique index if not exists outlet_location_master_normalized_uq on public.outlet_location_master(normalized_store_name);
alter table public.outlet_location_master enable row level security;
revoke all on table public.outlet_location_master from anon, authenticated;

create or replace function public.get_outlet_locations_v1(p_order_id uuid, p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_ok boolean; v_result jsonb;
begin
  select exists(select 1 from public.orders where id=p_order_id and access_token=p_access_token) into v_ok;
  if not v_ok then return jsonb_build_object('ok',false,'message','Invalid order access'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'store_name',o.store_name,'address',coalesce(l.address,''),'latitude',l.latitude,
    'longitude',l.longitude,'maps_url',coalesce(l.maps_url,''),'location_verified',coalesce(l.location_verified,false)
  ) order by o.store_name),'[]'::jsonb)
  into v_result
  from (select distinct store_name from public.outlets where order_id=p_order_id) o
  left join public.outlet_location_master l
    on l.normalized_store_name=lower(regexp_replace(trim(o.store_name), '[[:space:]]+', ' ', 'g'));
  return jsonb_build_object('ok',true,'locations',v_result);
end $$;

create or replace function public.save_outlet_location_v1(
  p_order_id uuid,p_access_token text,p_store_name text,p_address text,
  p_latitude double precision,p_longitude double precision,p_maps_url text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_name text; v_ok boolean;
begin
  v_name:=regexp_replace(trim(coalesce(p_store_name,'')), '[[:space:]]+', ' ', 'g');
  if v_name='' then return jsonb_build_object('ok',false,'message','Outlet name is required'); end if;
  if (p_latitude is null) <> (p_longitude is null) then
    return jsonb_build_object('ok',false,'message','Latitude and longitude must both be provided');
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180) then
    return jsonb_build_object('ok',false,'message','Coordinates are out of range');
  end if;
  select exists(select 1 from public.orders o join public.outlets x on x.order_id=o.id
    where o.id=p_order_id and o.access_token=p_access_token
      and lower(regexp_replace(trim(x.store_name), '[[:space:]]+', ' ', 'g'))=lower(v_name)) into v_ok;
  if not v_ok then return jsonb_build_object('ok',false,'message','Outlet not found in this order'); end if;
  insert into public.outlet_location_master(store_name,address,latitude,longitude,maps_url,location_verified,updated_at)
  values(v_name,trim(coalesce(p_address,'')),p_latitude,p_longitude,trim(coalesce(p_maps_url,'')),p_latitude is not null,now())
  on conflict (normalized_store_name) do update set store_name=excluded.store_name,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,
    maps_url=excluded.maps_url,location_verified=excluded.location_verified,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.get_outlet_locations_v1(uuid,text) from public;
revoke all on function public.save_outlet_location_v1(uuid,text,text,text,double precision,double precision,text) from public;
grant execute on function public.get_outlet_locations_v1(uuid,text) to anon,authenticated;
grant execute on function public.save_outlet_location_v1(uuid,text,text,text,double precision,double precision,text) to anon,authenticated;
