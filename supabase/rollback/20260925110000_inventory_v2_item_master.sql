-- Rollback for 20260925110000_inventory_v2_item_master
-- Removes only indexes introduced by this hardening migration.

drop index if exists public.inv_barcode_lookup_cache_fetched_at_idx;
drop index if exists public.inv_v2_item_barcodes_barcode_idx;

-- END OF PART 1/1
