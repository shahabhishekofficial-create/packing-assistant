-- Inventory Item Master V2: richer item identity and operational metadata.
-- New columns only. Existing inv_items data and legacy RPCs remain untouched.
alter table public.inv_items
  add column if not exists item_code text,
  add column if not exists brand text,
  add column if not exists subcategory text,
  add column if not exists description text,
  add column if not exists purchase_unit text,
  add column if not exists pack_size numeric,
  add column if not exists pack_uom text,
  add column if not exists base_qty_per_pack numeric,
  add column if not exists storage_condition text,
  add column if not exists storage_location text,
  add column if not exists shelf_life_days integer,
  add column if not exists reorder_level numeric,
  add column if not exists preferred_supplier text,
  add column if not exists is_perishable boolean not null default false;

create unique index if not exists inv_items_section_item_code_uidx
  on public.inv_items(section, lower(item_code))
  where item_code is not null and btrim(item_code) <> '';

create or replace function public.inv_add_item_v2(
 p_session_token text,p_section text,p_name text,p_aliases text[] default '{}',
 p_unit text default 'pcs',p_category text default 'Uncategorized',
 p_item_code text default null,p_brand text default null,p_subcategory text default null,
 p_description text default null,p_purchase_unit text default null,p_pack_size numeric default null,
 p_pack_uom text default null,p_base_qty_per_pack numeric default null,
 p_storage_condition text default null,p_storage_location text default null,
 p_shelf_life_days integer default null,p_reorder_level numeric default null,
 p_preferred_supplier text default null,p_is_perishable boolean default false
) returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_id uuid;
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
 if p_section not in ('restaurant','vegetable') then raise exception 'Invalid section'; end if;
 if coalesce(length(trim(p_name)),0)=0 then raise exception 'Item name is required'; end if;
 if p_pack_size is not null and p_pack_size < 0 then raise exception 'Pack size cannot be negative'; end if;
 if p_base_qty_per_pack is not null and p_base_qty_per_pack < 0 then raise exception 'Base quantity per pack cannot be negative'; end if;
 if p_shelf_life_days is not null and p_shelf_life_days < 0 then raise exception 'Shelf life cannot be negative'; end if;
 if p_reorder_level is not null and p_reorder_level < 0 then raise exception 'Reorder level cannot be negative'; end if;
 insert into public.inv_items(section,name,aliases,unit,category,item_code,brand,subcategory,description,purchase_unit,pack_size,pack_uom,base_qty_per_pack,storage_condition,storage_location,shelf_life_days,reorder_level,preferred_supplier,is_perishable)
 values(p_section,trim(p_name),coalesce(p_aliases,'{}'),coalesce(nullif(trim(p_unit),''),'pcs'),coalesce(nullif(trim(p_category),''),'Uncategorized'),
 nullif(trim(p_item_code),''),nullif(trim(p_brand),''),nullif(trim(p_subcategory),''),nullif(trim(p_description),''),
 coalesce(nullif(trim(p_purchase_unit),''),coalesce(nullif(trim(p_unit),''),'pcs')),p_pack_size,nullif(trim(p_pack_uom),''),p_base_qty_per_pack,
 nullif(trim(p_storage_condition),''),nullif(trim(p_storage_location),''),p_shelf_life_days,p_reorder_level,nullif(trim(p_preferred_supplier),''),coalesce(p_is_perishable,false))
 returning id into v_id; return v_id;
end;$function$;

create or replace function public.inv_bulk_add_items_v2(p_session_token text,p_section text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare r jsonb; v_id uuid; v_added int:=0; v_skipped int:=0; v_name text;
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
 if p_section not in ('restaurant','vegetable') then raise exception 'Invalid section'; end if;
 for r in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_name=trim(coalesce(r->>'name','')); if v_name='' then continue; end if;
  if exists(select 1 from public.inv_items where section=p_section and lower(name)=lower(v_name)) then v_skipped:=v_skipped+1; continue; end if;
  insert into public.inv_items(section,name,aliases,unit,category,item_code,brand,subcategory,description,purchase_unit,pack_size,pack_uom,base_qty_per_pack,storage_condition,storage_location,shelf_life_days,reorder_level,preferred_supplier,is_perishable)
  values(p_section,v_name,
   case when jsonb_typeof(r->'aliases')='array' then array(select jsonb_array_elements_text(r->'aliases')) else '{}' end,
   coalesce(nullif(trim(r->>'unit),''),'pcs'),coalesce(nullif(trim(r->>'category'),''),'Uncategorized'),
   nullif(trim(r->>'item_code),''),nullif(trim(r->>'brand),''),nullif(trim(r->>'subcategory),''),nullif(trim(r->>'description'),''),
   coalesce(nullif(trim(r->>'purchase_unit),''),coalesce(nullif(trim(r->>'unit'),''),'pcs')),
   nullif(r->>'pack_size','')::numeric,nullif(trim(r->>'pack_uom),''),nullif(r->>'base_qty_per_pack','')::numeric,
   nullif(trim(r->>'storage_condition),''),nullif(trim(r->>'storage_location),''),nullif(r->>'shelf_life_days','')::integer,
   nullif(r->>'reorder_level','')::numeric,nullif(trim(r->>'preferred_supplier),''),coalesce((r->>'is_perishable')::boolean,false))
  returning id into v_id;
  v_added:=v_added+1;
  if coalesce(trim(r->>'barcode'),'')<>'' then insert into public.inv_item_barcodes(barcode,item_id) values(trim(r->>'barcode'),v_id) on conflict(barcode) do nothing; end if;
 end loop; return jsonb_build_object('added',v_added,'skipped',v_skipped);
end;$function$;

create or replace function public.inv_get_items_v2(p_session_token text,p_section text default 'restaurant')
returns table(id uuid,section text,name text,aliases text[],unit text,category text,active boolean,barcode text,item_code text,brand text,subcategory text,description text,purchase_unit text,pack_size numeric,pack_uom text,base_qty_per_pack numeric,storage_condition text,storage_location text,shelf_life_days integer,reorder_level numeric,preferred_supplier text,is_perishable boolean)
language plpgsql security definer set search_path=''
as $function$
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
 return query select i.id,i.section,i.name,i.aliases,i.unit,i.category,i.active,
 coalesce(string_agg(b.barcode,'|' order by b.barcode),''),
 i.item_code,i.brand,i.subcategory,i.description,i.purchase_unit,i.pack_size,i.pack_uom,i.base_qty_per_pack,
 i.storage_condition,i.storage_location,i.shelf_life_days,i.reorder_level,i.preferred_supplier,i.is_perishable
 from public.inv_items i left join public.inv_item_barcodes b on b.item_id=i.id
 where i.section=p_section and i.active group by i.id order by i.category,i.name;
end;$function$;

grant execute on function public.inv_add_item_v2(text,text,text,text[],text,text,text,text,text,text,text,numeric,text,numeric,text,text,integer,numeric,text,boolean) to anon,authenticated;
grant execute on function public.inv_bulk_add_items_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.inv_get_items_v2(text,text) to anon,authenticated;
