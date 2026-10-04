-- Restaurant Inventory template import v1
-- Maps the business template's packaging_method/default_pack_size into the
-- existing count_unit/count_to_base model. No table changes.

create or replace function public.inv_v2_import_restaurant_template_v1(
  p_session_token text,
  p_rows jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  r jsonb;
  p jsonb;
  errors jsonb := '[]'::jsonb;
  items jsonb := '[]'::jsonb;
  seen_names text[] := '{}';
  seen_barcodes text[] := '{}';
  nm text;
  section text;
  category text;
  uom text;
  packaging text;
  pack numeric;
  barcodes text[];
  b text;
  flag text;
  err text;
begin
  if not public.inv_require_admin(p_session_token) then
    raise exception 'Unauthorized';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Template rows must be an array.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    nm := public.inv_v2_normalize_text(r->>'name');
    if nm ilike 'EXAMPLE%' then
      continue;
    end if;

    if coalesce(nullif(public.inv_v2_normalize_text(r->>'section'),''),'') <> 'restaurant'
       or nm='' or public.inv_v2_normalize_text(r->>'category')=''
       or public.inv_v2_normalize_text(r->>'base_uom')=''
       or public.inv_v2_normalize_text(r->>'packaging_method')='' then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'name',nm,'error','section, name, category, base_uom and packaging_method are required.'
      ));
      continue;
    end if;

    section := 'restaurant';
    category := public.inv_v2_normalize_text(r->>'category');
    uom := public.inv_v2_normalize_text(r->>'base_uom');
    packaging := public.inv_v2_normalize_text(r->>'packaging_method');
    flag := upper(public.inv_v2_normalize_text(r->>'no_barcode'));

    if uom not in ('kg','g','L','ml','pcs') then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','base_uom','error','Invalid base_uom.'));
      continue;
    end if;

    if packaging not in ('Bottle','Packet','Box','Loose Packing','Carton','Pouch','Sack','Jar','Can','Tray','Crate','Drum','Bag','Bundle') then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','packaging_method','error','Invalid packaging_method.'));
      continue;
    end if;

    pack := nullif(trim(r->>'default_pack_size'),'')::numeric;
    if packaging <> 'Loose Packing' and (pack is null or pack <= 0) then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','default_pack_size','error','Positive default_pack_size is required for packaged items.'));
      continue;
    end if;
    if packaging = 'Loose Packing' then
      pack := 1;
    end if;

    if flag not in ('TRUE','FALSE','') then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','no_barcode','error','no_barcode must be TRUE or FALSE.'));
      continue;
    end if;

    barcodes := array(
      select public.inv_v2_normalize_text(x)
      from unnest(string_to_array(coalesce(r->>'barcodes',''),'|')) x
      where public.inv_v2_normalize_text(x) <> ''
    );

    if cardinality(barcodes)>0 then
      foreach b in array barcodes loop
        if b !~ '^[0-9]+$' or length(b) not in (8,12,13) then
          errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','barcodes','error','Invalid barcode: '||b));
        end if;
        if b = any(seen_barcodes) then
          errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','barcodes','error','Duplicate barcode in import: '||b));
        end if;
        if exists(select 1 from public.inv_v2_item_barcodes ib where ib.barcode=b) then
          errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','barcodes','error','Barcode already linked: '||b));
        end if;
        seen_barcodes := array_append(seen_barcodes,b);
      end loop;
    end if;

    if lower(nm) = any(seen_names) then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','name','error','Duplicate item name in import.'));
    end if;
    if exists(select 1 from public.inv_v2_items i where i.section=section and lower(i.name_normalized)=lower(nm) and i.active=true) then
      errors := errors || jsonb_build_array(jsonb_build_object('name',nm,'field','name','error','Item already exists in Restaurant Inventory.'));
    end if;
    seen_names := array_append(seen_names,lower(nm));

    if packaging='Loose Packing' then
      p := jsonb_build_object(
        'operation','create','section',section,'name',nm,'category',category,'base_uom',uom,
        'count_mode','unit','count_unit',case when uom='kg' then 'kg' when uom='g' then 'g' when uom='L' then 'L' when uom='ml' then 'ml' else 'pcs' end,
        'default_pack_size',null,'count_to_base',1,'storage_shelf',nullif(public.inv_v2_normalize_text(r->>'storage_shelf'),''),
        'storage_rack',nullif(public.inv_v2_normalize_text(r->>'storage_rack'),''),
        'barcodes',to_jsonb(barcodes),'no_barcode',case when cardinality(barcodes)=0 then true else false end,
        'aliases',to_jsonb(array(select public.inv_v2_normalize_text(x) from unnest(string_to_array(coalesce(r->>'aliases',''),'|')) x where public.inv_v2_normalize_text(x)<>'')),
        'brand',nullif(public.inv_v2_normalize_text(r->>'brand'),'')
      );
    else
      p := jsonb_build_object(
        'operation','create','section',section,'name',nm,'category',category,'base_uom',uom,
        'count_mode','packet','count_unit',packaging,'default_pack_size',pack,'count_to_base',pack,
        'storage_shelf',nullif(public.inv_v2_normalize_text(r->>'storage_shelf'),''),
        'storage_rack',nullif(public.inv_v2_normalize_text(r->>'storage_rack'),''),
        'barcodes',to_jsonb(barcodes),'no_barcode',case when cardinality(barcodes)=0 then true else false end,
        'aliases',to_jsonb(array(select public.inv_v2_normalize_text(x) from unnest(string_to_array(coalesce(r->>'aliases',''),'|')) x where public.inv_v2_normalize_text(x)<>'')),
        'brand',nullif(public.inv_v2_normalize_text(r->>'brand'),'')
      );
    end if;
    items := items || jsonb_build_array(p);
  end loop;

  if jsonb_array_length(errors)>0 then
    return jsonb_build_object('ok',false,'added',0,'errors',errors);
  end if;

  if jsonb_array_length(items)=0 then
    return jsonb_build_object('ok',false,'added',0,'errors',jsonb_build_array(jsonb_build_object('error','No importable restaurant rows found.')));
  end if;

  return public.inv_v2_save_item_v5(
    p_session_token,
    null,
    jsonb_build_object('operation','batch_create','items',items),
    p_import_id
  ) || jsonb_build_object('ok',true,'errors','[]'::jsonb);
end;
$$;

revoke execute on function public.inv_v2_import_restaurant_template_v1(text,jsonb,uuid) from public;
revoke execute on function public.inv_v2_import_restaurant_template_v1(text,jsonb,uuid) from anon;
grant execute on function public.inv_v2_import_restaurant_template_v1(text,jsonb,uuid) to authenticated;
