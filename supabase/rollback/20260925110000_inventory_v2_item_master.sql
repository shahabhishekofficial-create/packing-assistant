-- Inventory V2 Item Master rollback.
-- Removes only objects introduced by migration 20260925110000.

revoke all on function public.inv_v2_save_item(text,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.inv_v2_get_items(text,text) from public,anon,authenticated;
revoke all on function public.inv_v2_lookup_linked(text,text) from public,anon,authenticated;
drop function if exists public.inv_v2_save_item(text,uuid,jsonb,uuid);
drop function if exists public.inv_v2_get_items(text,text);
drop function if exists public.inv_v2_lookup_linked(text,text);
drop function if exists public.inv_v2_barcode_valid(text);
drop function if exists public.inv_v2_normalize_text(text);
drop table if exists public.inv_v2_audit_log;
drop table if exists public.inv_barcode_lookup_cache;
drop table if exists public.inv_v2_item_meta;

-- END OF PART 1/1
