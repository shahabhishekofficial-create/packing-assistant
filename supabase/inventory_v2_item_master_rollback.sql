-- Inventory Item Master V2 rollback.
-- FAIL-SAFE: only removes inv_v2_* objects created by this feature.
-- NEVER drops or alters legacy auth, legacy RPCs, inv_items, inv_item_barcodes,
-- inv_count_sessions, inv_stock_counts, or inv_stock_counts.qty.

BEGIN;
DROP FUNCTION IF EXISTS public.inv_v2_lookup_linked(text,text);
DROP FUNCTION IF EXISTS public.inv_v2_get_items(text,text);
DROP FUNCTION IF EXISTS public.inv_v2_save_item(text,uuid,jsonb,uuid);
DROP FUNCTION IF EXISTS public.inv_v2_save_item(text,text,uuid,jsonb,uuid);
DROP FUNCTION IF EXISTS public.inv_v2_barcode_valid(text);
DROP FUNCTION IF EXISTS public.inv_v2_normalize_text(text);
DROP TABLE IF EXISTS public.inv_v2_item_barcodes;
DROP TABLE IF EXISTS public.inv_v2_items;
DROP TABLE IF EXISTS public.inv_barcode_lookup_cache;
DROP TABLE IF EXISTS public.inv_v2_audit_log;
COMMIT;

-- END OF PART 1/1
