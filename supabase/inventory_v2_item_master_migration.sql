-- Inventory Item Master V2 deployment record/source guard.
-- Production currently contains the versioned migrations below.
-- This file is documentation/source traceability; do not apply it as a second production migration.

-- Required V2 objects:
-- inv_v2_items
-- inv_v2_item_barcodes
-- inv_v2_audit_log
-- inv_barcode_lookup_cache
-- inv_v2_normalize_text(text)
-- inv_v2_barcode_valid(text)
-- inv_v2_save_item(text,uuid,jsonb,uuid)
-- inv_v2_get_items(text,text)
-- inv_v2_lookup_linked(text,text)
-- Edge Function: admin-item-lookup

-- Applied production migrations:
-- 20260925055836_20260925121000_inv_v2_item_master_schema
-- 20260925055853_20260925121100_inv_v2_item_master_rpcs
-- 20260925060541_inv_v2_item_master_import_lookup
-- 20260925061202_inventory_v2_item_master_lookup_hardening
-- 20260925061255_inventory_v2_barcode_preflight

-- END OF PART 1/1
