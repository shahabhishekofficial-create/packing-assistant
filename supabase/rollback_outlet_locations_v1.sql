-- Destructive rollback for outlet_locations_v1. This permanently deletes saved outlet addresses and coordinates.
revoke all on function public.get_outlet_locations_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.save_outlet_location_v1(uuid,text,text,text,double precision,double precision,text) from public,anon,authenticated,service_role;
drop function if exists public.get_outlet_locations_v1(uuid,text);
drop function if exists public.save_outlet_location_v1(uuid,text,text,text,double precision,double precision,text);
drop table if exists public.outlet_location_master;
