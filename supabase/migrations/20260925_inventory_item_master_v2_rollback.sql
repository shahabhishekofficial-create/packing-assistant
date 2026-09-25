drop function if exists public.inv_add_item_v2(text,text,text,text[],text,text,text,text,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,boolean);
drop function if exists public.inv_bulk_add_items_v2(text,text,jsonb);
drop function if exists public.inv_get_items_v2(text,text);
drop index if exists public.inv_items_section_item_code_uidx;
alter table public.inv_items
 drop column if exists item_code, drop column if exists brand, drop column if exists subcategory,
 drop column if exists description, drop column if exists purchase_unit, drop column if exists pack_size,
 drop column if exists pack_uom, drop column if exists base_qty_per_pack, drop column if exists storage_condition,
 drop column if exists storage_location, drop column if exists shelf_life_days, drop column if exists reorder_level,
 drop column if exists preferred_supplier, drop column if exists is_perishable;