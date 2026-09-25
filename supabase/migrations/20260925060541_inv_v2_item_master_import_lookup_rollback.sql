-- Rollback for 20260925060541_inv_v2_item_master_import_lookup.
-- Run only after disabling the V2 Item Master UI and exporting V2 data.
revoke all on public.inv_v2_items,public.inv_v2_item_barcodes,public.inv_barcode_lookup_cache,public.inv_v2_audit_log from public,anon,authenticated;
drop function if exists public.inv_v2_get_items(text,text);
drop function if exists public.inv_v2_save_item(text,uuid,jsonb,uuid);
drop function if exists public.inv_v2_barcode_valid(text);
drop function if exists public.inv_v2_normalize_text(text);
drop table if exists public.inv_v2_item_barcodes;
drop table if exists public.inv_v2_items;
drop table if exists public.inv_barcode_lookup_cache;
drop table if exists public.inv_v2_audit_log;
-- END OF PART 1/1