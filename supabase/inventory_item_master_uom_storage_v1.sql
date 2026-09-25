-- Inventory Item Master UOM + storage location
-- Applied: 2026-09-25
-- Adds g/ml UOM support and optional shelf/rack storage tracking.
alter table public.inv_v2_items add column if not exists storage_shelf text;
alter table public.inv_v2_items add column if not exists storage_rack text;
alter table public.inv_items add column if not exists storage_shelf text;
alter table public.inv_items add column if not exists storage_rack text;
alter table public.inv_v2_items drop constraint if exists inv_v2_items_base_uom_check;
alter table public.inv_v2_items add constraint inv_v2_items_base_uom_check
  check (base_uom = any (array['kg','g','L','ml','pcs']));
-- Existing save RPCs were updated to accept the same five UOM values.
-- Versioned wrappers:
--   inv_v2_save_item_v4  -> saves optional storage fields
--   inv_v2_get_items_v3  -> returns optional storage fields
