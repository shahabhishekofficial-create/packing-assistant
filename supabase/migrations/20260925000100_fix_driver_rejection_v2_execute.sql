-- Fix driver rejection V2 RPC execution for the service-role Edge Function.
-- Legacy driver rejection RPC remains untouched.
revoke execute on function public.save_driver_item_rejections_v2(text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_driver_item_rejections_v2(text,uuid,uuid,jsonb) to service_role;
