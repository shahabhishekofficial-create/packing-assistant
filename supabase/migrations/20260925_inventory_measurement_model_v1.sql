-- Inventory measurement model v1
-- Inventory measurement model: base UOM + count unit + conversion factor.
alter table public.inv_v2_items
  add column if not exists count_unit text,
  add column if not exists count_to_base numeric;

alter table public.inv_items
  add column if not exists count_unit text,
  add column if not exists count_to_base numeric;

update public.inv_v2_items
set count_unit = case when lower(coalesce(count_mode,''))='packet' then 'packet' else
  case when base_uom='kg' then 'kg' when base_uom='g' then 'g' when base_uom='L' then 'L' when base_uom='ml' then 'ml' else 'pcs' end end,
    count_to_base = case when lower(coalesce(count_mode,''))='packet' then coalesce(default_pack_size,1) else 1 end
where count_unit is null or count_to_base is null;

update public.inv_items i
set count_unit=v.count_unit,count_to_base=v.count_to_base
from public.inv_v2_items v where v.legacy_item_id=i.id;

create or replace function public.inv_v2_get_items_v5(p_session_token text,p_section text default 'restaurant')
returns table(
 id uuid, legacy_item_id uuid, section text, name text, aliases text[], category text,
 base_uom text, count_mode text, default_pack_size numeric, count_unit text,
 count_to_base numeric, no_barcode boolean, brand text, active boolean, barcodes text[],
 storage_shelf text, storage_rack text
)
language plpgsql security definer set search_path=''
as $$
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
 return query
 select i.id,i.legacy_item_id,i.section,i.name,i.aliases,i.category,i.base_uom,i.count_mode,
 i.default_pack_size,i.count_unit,i.count_to_base,i.no_barcode,i.brand,i.active,
 coalesce(array_agg(b.barcode order by b.barcode) filter(where b.barcode is not null),'{}'::text[]),
 i.storage_shelf,i.storage_rack
 from public.inv_v2_items i
 left join public.inv_v2_item_barcodes b on b.item_id=i.id
 where i.section=p_section
 group by i.id order by i.category,i.name;
end $$;

grant execute on function public.inv_v2_get_items_v5(text,text) to anon,authenticated,service_role;

-- Versioned save path with explicit counting unit/conversion.
create or replace function public.inv_v2_save_item_v5(p_session_token text,p_item_id uuid default null,p_payload jsonb default '{}'::jsonb,p_import_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $
declare result jsonb;v_id uuid;v_legacy uuid;v_mode text;v_unit text;v_factor numeric;v_uom text;v_sec text;x jsonb;nm text;
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
 if lower(trim(coalesce(p_payload->>'operation','create')))='batch_create' then
   result:=public.inv_v2_save_item_v4(p_session_token,null,p_payload,p_import_id);
   for x in select value from jsonb_array_elements(p_payload->'items') loop
     v_sec:=public.inv_v2_normalize_text(x.value->>'section');nm:=public.inv_v2_normalize_text(x.value->>'name');v_unit:=public.inv_v2_normalize_text(x.value->>'count_unit');v_factor:=nullif(trim(x.value->>'count_to_base'),'')::numeric;v_uom:=public.inv_v2_normalize_text(x.value->>'base_uom');v_mode:=lower(public.inv_v2_normalize_text(x.value->>'count_mode'));
     if v_sec='vegetable' then v_unit=case when v_uom='kg' then 'kg' else 'pcs' end;v_factor=1; elsif v_mode='unit' then v_unit=case when v_uom='kg' then 'kg' when v_uom='g' then 'g' when v_uom='L' then 'L' when v_uom='ml' then 'ml' else 'pcs' end;v_factor=1; elsif v_mode='packet' then if v_unit='' or v_factor is null or v_factor<=0 then raise exception 'Invalid count unit/conversion for %',nm;end if;end if;
     select id,legacy_item_id into v_id,v_legacy from public.inv_v2_items where section=v_sec and lower(name_normalized)=lower(nm) and active=true order by created_at desc limit 1;
     if v_id is null then raise exception 'Created item not found: %',nm;end if;update public.inv_v2_items set count_unit=v_unit,count_to_base=v_factor,updated_at=now() where id=v_id;update public.inv_items set count_unit=v_unit,count_to_base=v_factor where id=v_legacy;
   end loop;return result;
 end if;
 v_mode=lower(public.inv_v2_normalize_text(p_payload->>'count_mode'));v_sec=public.inv_v2_normalize_text(p_payload->>'section');v_uom=public.inv_v2_normalize_text(p_payload->>'base_uom');v_unit=public.inv_v2_normalize_text(p_payload->>'count_unit');v_factor=nullif(trim(p_payload->>'count_to_base'),'')::numeric;
 if v_sec='vegetable' then v_unit=case when v_uom='kg' then 'kg' else 'pcs' end;v_factor=1; elsif v_mode='unit' then v_unit=case when v_uom='kg' then 'kg' when v_uom='g' then 'g' when v_uom='L' then 'L' when v_uom='ml' then 'ml' else 'pcs' end;v_factor=1; elsif v_mode='packet' then if v_unit='' then raise exception 'Count unit is required for Packet mode';end if;if v_factor is null or v_factor<=0 then raise exception 'Quantity per count unit must be greater than 0';end if;end if;
 p_payload=jsonb_set(jsonb_set(p_payload,'{count_unit}',to_jsonb(v_unit),true),'{count_to_base}',to_jsonb(v_factor),true);result=public.inv_v2_save_item_v4(p_session_token,p_item_id,p_payload,p_import_id);v_id=(result->>'item_id')::uuid;if v_id is not null then select legacy_item_id into v_legacy from public.inv_v2_items where id=v_id;update public.inv_v2_items set count_unit=v_unit,count_to_base=v_factor,updated_at=now() where id=v_id;update public.inv_items set count_unit=v_unit,count_to_base=v_factor where id=v_legacy;end if;return result;
end $;
grant execute on function public.inv_v2_save_item_v5(text,uuid,jsonb,uuid) to anon,authenticated,service_role;