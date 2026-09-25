-- Inventory V2 Item Master / Barcode Lookup / Import
-- Additive only. Existing legacy inventory tables/RPCs are not dropped.
create table if not exists public.inv_v2_items (
 id uuid primary key default extensions.gen_random_uuid(),
 legacy_item_id uuid not null unique references public.inv_items(id) on delete restrict,
 section text not null check(section in ('restaurant','vegetable')),
 name text not null,name_normalized text not null,aliases text[] not null default '{}',
 category text not null,base_uom text not null check(base_uom in ('kg','L','pcs')),
 count_mode text not null check(count_mode in ('unit','packet')),
 default_pack_size numeric null check(default_pack_size is null or default_pack_size > 0),
 no_barcode boolean not null,brand text null,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists inv_v2_items_section_name_uq on public.inv_v2_items(section,lower(name_normalized));
create table if not exists public.inv_v2_item_barcodes (
 barcode text primary key,item_id uuid not null references public.inv_v2_items(id) on delete restrict,created_at timestamptz not null default now()
);
create index if not exists inv_v2_item_barcodes_item_idx on public.inv_v2_item_barcodes(item_id);
create table if not exists public.inv_barcode_lookup_cache (
 barcode text primary key,source text not null default 'open_food_facts',fetched_at timestamptz not null default now(),
 found boolean not null default false,raw_response jsonb null,image_url text null,fetched_by text null
);
create table if not exists public.inv_v2_audit_log (
 id bigint generated always as identity primary key,action text not null,actor text null,item_id uuid null,import_id uuid null,
 barcode text null,old_data jsonb null,new_data jsonb null,result text not null default 'success',created_at timestamptz not null default now()
);
alter table public.inv_v2_items enable row level security;
alter table public.inv_v2_item_barcodes enable row level security;
alter table public.inv_barcode_lookup_cache enable row level security;
alter table public.inv_v2_audit_log enable row level security;
revoke all on public.inv_v2_items,public.inv_v2_item_barcodes,public.inv_barcode_lookup_cache,public.inv_v2_audit_log from anon,authenticated,public;

create or replace function public.inv_v2_normalize_text(p text)
returns text language sql immutable parallel safe set search_path=''
as $fn$ select regexp_replace(trim(coalesce(p,'')), '\s+', ' ', 'g') $fn$;

create or replace function public.inv_v2_barcode_valid(p text)
returns boolean language plpgsql immutable parallel safe set search_path=''
as $fn$
declare v text:=trim(coalesce(p,'')); n int; s int:=0; i int; d int;
begin
 if v !~ '^[0-9]+$' or length(v) not in (8,12,13) then return false; end if;
 n:=length(v);
 for i in 1..n-1 loop d:=substr(v,i,1)::int; if mod(n-i,2)=1 then s:=s+d*3; else s:=s+d; end if; end loop;
 return mod(10-mod(s,10),10)=substr(v,n,1)::int;
end;$fn$;

create or replace function public.inv_v2_save_item(
 p_session_token text,p_item_id uuid default null,p_payload jsonb default '{}'::jsonb,p_import_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_op text:=lower(trim(coalesce(p_payload->>'operation','create')));
 v_section text;v_name text;v_norm text;v_category text;v_uom text;v_mode text;v_pack numeric;
 v_no_barcode boolean;v_brand text;v_aliases text[];v_barcodes text[];v_legacy_id uuid;v_id uuid;v_old jsonb;v_new jsonb;
 v_errors jsonb:='[]'::jsonb;v_item jsonb;v_items jsonb;v_count int:=0;v_import_id uuid:=coalesce(p_import_id,extensions.gen_random_uuid());b text;idx int:=0;
begin
 if not public.inv_require_admin(p_session_token) then
  insert into public.inv_v2_audit_log(action,actor,import_id,result,new_data) values('permission_denied','admin',v_import_id,'denied',jsonb_build_object('operation',v_op));
  raise exception 'Unauthorized';
 end if;

 if v_op='batch_create' then
  v_items:=coalesce(p_payload->'items','[]'::jsonb);
  if jsonb_typeof(v_items)<>'array' then raise exception 'Import items must be an array'; end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
   idx:=idx+1;v_section:=public.inv_v2_normalize_text(v_item->>'section');v_name:=public.inv_v2_normalize_text(v_item->>'name');v_norm:=lower(v_name);
   v_category:=public.inv_v2_normalize_text(v_item->>'category');v_uom:=public.inv_v2_normalize_text(v_item->>'base_uom');v_mode:=lower(public.inv_v2_normalize_text(v_item->>'count_mode'));
   v_pack:=nullif(trim(v_item->>'default_pack_size'),'')::numeric;v_no_barcode:=coalesce((v_item->>'no_barcode')::boolean,false);
   v_aliases:=case when jsonb_typeof(v_item->'aliases')='array' then array(select public.inv_v2_normalize_text(x) from jsonb_array_elements_text(v_item->'aliases') x where public.inv_v2_normalize_text(x)<>'') else '{}' end;
   v_barcodes:=case when jsonb_typeof(v_item->'barcodes')='array' then array(select trim(x) from jsonb_array_elements_text(v_item->'barcodes') x where trim(x)<>'') else '{}' end;
   if v_section not in ('restaurant','vegetable') then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','section','message','Must be restaurant or vegetable')); end if;
   if v_name='' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','name','message','Required')); end if;
   if v_category='' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','category','message','Required')); end if;
   if v_uom not in ('kg','L','pcs') then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','base_uom','message','Must be kg, L or pcs')); end if;
   if v_mode not in ('unit','packet') then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','count_mode','message','Must be unit or packet')); end if;
   if v_mode='packet' and (v_pack is null or v_pack<=0) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','default_pack_size','message','Required and > 0 for packet')); end if;
   if v_no_barcode=false and coalesce(array_length(v_barcodes,1),0)=0 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','barcodes','message','Required unless no_barcode is TRUE')); end if;
   if v_no_barcode=true and coalesce(array_length(v_barcodes,1),0)>0 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','barcodes','message','Must be empty when no_barcode is TRUE')); end if;
   if exists(select 1 from public.inv_v2_items where section=v_section and lower(name_normalized)=v_norm) or exists(select 1 from public.inv_items where section=v_section and lower(public.inv_v2_normalize_text(name))=v_norm) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','name','message','Duplicate name in section')); end if;
   foreach b in array coalesce(v_barcodes,'{}') loop
    if not public.inv_v2_barcode_valid(b) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','barcodes','message','Invalid barcode check digit: '||b)); end if;
    if exists(select 1 from public.inv_v2_item_barcodes where barcode=b) or exists(select 1 from public.inv_item_barcodes where barcode=b) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',idx,'field','barcodes','message','Barcode already linked: '||b)); end if;
   end loop;
  end loop;
  if jsonb_array_length(v_errors)>0 then
   insert into public.inv_v2_audit_log(action,actor,import_id,result,new_data) values('import','admin',v_import_id,'validation_failed',jsonb_build_object('rows',jsonb_array_length(v_items),'errors',v_errors));
   raise exception using message=concat('Import validation failed: ',v_errors::text);
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
   v_section:=public.inv_v2_normalize_text(v_item->>'section');v_name:=public.inv_v2_normalize_text(v_item->>'name');v_norm:=lower(v_name);
   v_category:=public.inv_v2_normalize_text(v_item->>'category');v_uom:=public.inv_v2_normalize_text(v_item->>'base_uom');v_mode:=lower(public.inv_v2_normalize_text(v_item->>'count_mode'));
   v_pack:=nullif(trim(v_item->>'default_pack_size'),'')::numeric;v_no_barcode:=coalesce((v_item->>'no_barcode')::boolean,false);v_brand:=nullif(public.inv_v2_normalize_text(v_item->>'brand'),'');
   v_aliases:=case when jsonb_typeof(v_item->'aliases')='array' then array(select public.inv_v2_normalize_text(x) from jsonb_array_elements_text(v_item->'aliases') x where public.inv_v2_normalize_text(x)<>'') else '{}' end;
   v_barcodes:=case when jsonb_typeof(v_item->'barcodes')='array' then array(select trim(x) from jsonb_array_elements_text(v_item->'barcodes') x where trim(x)<>'') else '{}' end;
   insert into public.inv_items(section,name,aliases,unit,category,active,brand) values(v_section,v_name,v_aliases,v_uom,v_category,true,v_brand) returning id into v_legacy_id;
   insert into public.inv_v2_items(legacy_item_id,section,name,name_normalized,aliases,category,base_uom,count_mode,default_pack_size,no_barcode,brand) values(v_legacy_id,v_section,v_name,v_norm,v_aliases,v_category,v_uom,v_mode,v_pack,v_no_barcode,v_brand) returning id into v_id;
   foreach b in array coalesce(v_barcodes,'{}') loop insert into public.inv_v2_item_barcodes(barcode,item_id) values(b,v_id);insert into public.inv_item_barcodes(barcode,item_id) values(b,v_legacy_id);end loop;
   v_count:=v_count+1;
   insert into public.inv_v2_audit_log(action,actor,item_id,import_id,new_data) values('create','admin',v_id,v_import_id,jsonb_build_object('section',v_section,'name',v_name,'category',v_category,'base_uom',v_uom,'count_mode',v_mode,'default_pack_size',v_pack,'no_barcode',v_no_barcode,'barcodes',v_barcodes,'aliases',v_aliases,'brand',v_brand));
  end loop;
  insert into public.inv_v2_audit_log(action,actor,import_id,result,new_data) values('import','admin',v_import_id,'success',jsonb_build_object('rows',jsonb_array_length(v_items),'added',v_count));
  return jsonb_build_object('ok',true,'import_id',v_import_id,'added',v_count,'skipped',0,'errors','[]'::jsonb);
 end if;

 if v_op='deactivate' then
  if p_item_id is null then raise exception 'Item id is required'; end if;
  select to_jsonb(x),x.legacy_item_id into v_old,v_legacy_id from public.inv_v2_items x where x.id=p_item_id;
  if v_old is null then raise exception 'Item not found'; end if;
  update public.inv_v2_items set active=false,updated_at=now() where id=p_item_id;update public.inv_items set active=false where id=v_legacy_id;
  insert into public.inv_v2_audit_log(action,actor,item_id,old_data,new_data) values('deactivate','admin',p_item_id,v_old,(select to_jsonb(x) from public.inv_v2_items x where x.id=p_item_id));
  return jsonb_build_object('ok',true,'item_id',p_item_id,'active',false);
 end if;

 if v_op not in ('create','update') then raise exception 'Invalid operation'; end if;
 v_section:=public.inv_v2_normalize_text(p_payload->>'section');v_name:=public.inv_v2_normalize_text(p_payload->>'name');v_norm:=lower(v_name);
 v_category:=public.inv_v2_normalize_text(p_payload->>'category');v_uom:=public.inv_v2_normalize_text(p_payload->>'base_uom');v_mode:=lower(public.inv_v2_normalize_text(p_payload->>'count_mode'));
 v_pack:=nullif(trim(p_payload->>'default_pack_size'),'')::numeric;v_no_barcode:=coalesce((p_payload->>'no_barcode')::boolean,false);v_brand:=nullif(public.inv_v2_normalize_text(p_payload->>'brand'),'');
 v_aliases:=case when jsonb_typeof(p_payload->'aliases')='array' then array(select public.inv_v2_normalize_text(x) from jsonb_array_elements_text(p_payload->'aliases') x where public.inv_v2_normalize_text(x)<>'') else '{}' end;
 v_barcodes:=case when jsonb_typeof(p_payload->'barcodes')='array' then array(select trim(x) from jsonb_array_elements_text(p_payload->'barcodes') x where trim(x)<>'') else '{}' end;
 if v_section not in ('restaurant','vegetable') then raise exception 'Invalid section';end if;if v_name='' then raise exception 'Item name is required';end if;if v_category='' then raise exception 'Category is required';end if;if v_uom not in ('kg','L','pcs') then raise exception 'Invalid base UOM';end if;if v_mode not in ('unit','packet') then raise exception 'Invalid count mode';end if;
 if v_mode='packet' and (v_pack is null or v_pack<=0) then raise exception 'Default pack size is required and must be > 0 for packet mode';end if;
 if v_no_barcode=false and coalesce(array_length(v_barcodes,1),0)=0 then raise exception 'Barcode is required unless No barcode is TRUE';end if;
 if v_no_barcode=true and coalesce(array_length(v_barcodes,1),0)>0 then raise exception 'Barcode must be empty when No barcode is TRUE';end if;
 if exists(select 1 from public.inv_v2_items where section=v_section and lower(name_normalized)=v_norm and id<>coalesce(p_item_id,'00000000-0000-0000-0000-000000000000')) or exists(select 1 from public.inv_items where section=v_section and lower(public.inv_v2_normalize_text(name))=v_norm and id<>coalesce((select legacy_item_id from public.inv_v2_items where id=p_item_id),'00000000-0000-0000-0000-000000000000')) then raise exception 'Duplicate item name in this section';end if;
 foreach b in array coalesce(v_barcodes,'{}') loop
  if not public.inv_v2_barcode_valid(b) then raise exception 'Invalid barcode check digit: %',b;end if;
  if exists(select 1 from public.inv_v2_item_barcodes where barcode=b and item_id<>coalesce(p_item_id,'00000000-0000-0000-0000-000000000000')) then raise exception 'Barcode already linked: %',b;end if;
  if exists(select 1 from public.inv_item_barcodes where barcode=b and item_id<>coalesce((select legacy_item_id from public.inv_v2_items where id=p_item_id),'00000000-0000-0000-0000-000000000000')) then raise exception 'Barcode already linked in legacy inventory: %',b;end if;
 end loop;
 if v_op='create' then
  insert into public.inv_items(section,name,aliases,unit,category,active,brand) values(v_section,v_name,v_aliases,v_uom,v_category,true,v_brand) returning id into v_legacy_id;
  insert into public.inv_v2_items(legacy_item_id,section,name,name_normalized,aliases,category,base_uom,count_mode,default_pack_size,no_barcode,brand) values(v_legacy_id,v_section,v_name,v_norm,v_aliases,v_category,v_uom,v_mode,v_pack,v_no_barcode,v_brand) returning id into v_id;
 else
  v_id:=p_item_id;select legacy_item_id,to_jsonb(x) into v_legacy_id,v_old from public.inv_v2_items x where x.id=v_id;if v_legacy_id is null then raise exception 'Item not found';end if;
  update public.inv_items set section=v_section,name=v_name,aliases=v_aliases,unit=v_uom,category=v_category,brand=v_brand,active=true where id=v_legacy_id;
  update public.inv_v2_items set section=v_section,name=v_name,name_normalized=v_norm,aliases=v_aliases,category=v_category,base_uom=v_uom,count_mode=v_mode,default_pack_size=v_pack,no_barcode=v_no_barcode,brand=v_brand,active=true,updated_at=now() where id=v_id;
  delete from public.inv_v2_item_barcodes where item_id=v_id;delete from public.inv_item_barcodes where item_id=v_legacy_id;
 end if;
 foreach b in array coalesce(v_barcodes,'{}') loop insert into public.inv_v2_item_barcodes(barcode,item_id) values(b,v_id);insert into public.inv_item_barcodes(barcode,item_id) values(b,coalesce(v_legacy_id,(select legacy_item_id from public.inv_v2_items where id=v_id)));end loop;
 select to_jsonb(x) into v_new from public.inv_v2_items x where x.id=v_id;
 insert into public.inv_v2_audit_log(action,actor,item_id,import_id,old_data,new_data) values(v_op,'admin',v_id,p_import_id,v_old,v_new);
 return jsonb_build_object('ok',true,'item_id',v_id,'legacy_item_id',v_legacy_id,'import_id',p_import_id);
exception when others then
 insert into public.inv_v2_audit_log(action,actor,item_id,import_id,result,new_data) values(case when v_op='batch_create' then 'import' else v_op end,'admin',coalesce(v_id,p_item_id),v_import_id,'error',jsonb_build_object('message',sqlerrm));
 raise;
end;$fn$;

create or replace function public.inv_v2_get_items(p_session_token text,p_section text default 'restaurant')
returns table(id uuid,legacy_item_id uuid,section text,name text,aliases text[],category text,base_uom text,count_mode text,default_pack_size numeric,no_barcode boolean,brand text,active boolean,barcodes text[])
language plpgsql security definer set search_path=''
as $fn$
begin
 if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized';end if;
 return query select i.id,i.legacy_item_id,i.section,i.name,i.aliases,i.category,i.base_uom,i.count_mode,i.default_pack_size,i.no_barcode,i.brand,i.active,
 coalesce(array_agg(b.barcode order by b.barcode) filter(where b.barcode is not null),'{}'::text[])
 from public.inv_v2_items i left join public.inv_v2_item_barcodes b on b.item_id=i.id where i.section=p_section group by i.id order by i.category,i.name;
end;$fn$;

revoke all on function public.inv_v2_normalize_text(text),public.inv_v2_barcode_valid(text),public.inv_v2_save_item(text,uuid,jsonb,uuid),public.inv_v2_get_items(text,text) from public,anon,authenticated;
grant execute on function public.inv_v2_save_item(text,uuid,jsonb,uuid),public.inv_v2_get_items(text,text) to anon,authenticated;
-- END OF PART 1/1