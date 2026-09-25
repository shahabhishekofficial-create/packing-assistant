-- Inventory V2: Admin Item Master lookup/import support
-- Additive only. Existing inv_* tables, legacy RPCs and inv_stock_counts.qty are not altered or dropped.

create table if not exists public.inv_v2_item_meta (
  item_id uuid primary key references public.inv_items(id) on delete cascade,
  count_mode text not null default 'unit' check (count_mode in ('unit','packet')),
  default_pack_size numeric null check (default_pack_size is null or default_pack_size > 0),
  no_barcode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inv_barcode_lookup_cache (
  barcode text primary key,
  source text not null default 'open_food_facts',
  fetched_at timestamptz not null default now(),
  found boolean not null default false,
  raw_response jsonb,
  fetched_by text not null default 'admin',
  image_url text
);

create table if not exists public.inv_v2_audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  item_id uuid null,
  import_id uuid null,
  barcode text null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.inv_v2_item_meta enable row level security;
alter table public.inv_barcode_lookup_cache enable row level security;
alter table public.inv_v2_audit_log enable row level security;

revoke all on public.inv_v2_item_meta from public, anon, authenticated;
revoke all on public.inv_barcode_lookup_cache from public, anon, authenticated;
revoke all on public.inv_v2_audit_log from public, anon, authenticated;

create index if not exists inv_v2_item_meta_count_mode_idx on public.inv_v2_item_meta(count_mode);
create index if not exists inv_v2_audit_log_item_idx on public.inv_v2_audit_log(item_id, created_at desc);
create index if not exists inv_v2_audit_log_import_idx on public.inv_v2_audit_log(import_id, created_at desc);

create or replace function public.inv_v2_normalize_text(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(regexp_replace(trim(coalesce(p_text,'')), '\\s+', ' ', 'g'), '');
$$;

create or replace function public.inv_v2_barcode_valid(p_barcode text)
returns boolean
language plpgsql
immutable
set search_path to ''
as $$
declare
  v text := trim(coalesce(p_barcode,''));
  n int;
  i int;
  s int := 0;
  digit int;
begin
  if v !~ '^[0-9]+$' then return false; end if;
  n := length(v);
  if n not in (8,12,13) then return false; end if;
  for i in 1..n-1 loop
    digit := substr(v,i,1)::int;
    if ((n-i) % 2) = 1 then s := s + digit * 3; else s := s + digit; end if;
  end loop;
  return ((10 - (s % 10)) % 10) = substr(v,n,1)::int;
end;
$$;

create or replace function public.inv_v2_save_item(
  p_session_token text,
  p_item_id uuid,
  p_payload jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_operation text := lower(trim(coalesce(p_payload->>'operation','create')));
  v_section text := public.inv_v2_normalize_text(p_payload->>'section');
  v_name text := public.inv_v2_normalize_text(p_payload->>'name');
  v_category text := public.inv_v2_normalize_text(p_payload->>'category');
  v_base_uom text := public.inv_v2_normalize_text(p_payload->>'base_uom');
  v_count_mode text := lower(public.inv_v2_normalize_text(p_payload->>'count_mode'));
  v_pack numeric := nullif(p_payload->>'default_pack_size','')::numeric;
  v_no_barcode boolean := coalesce((p_payload->>'no_barcode')::boolean,false);
  v_aliases text[] := coalesce(array(
    select public.inv_v2_normalize_text(value)
    from jsonb_array_elements_text(coalesce(p_payload->'aliases','[]'::jsonb)) q(value)
    where public.inv_v2_normalize_text(value) is not null
  ), '{}'::text[]);
  v_brand text := public.inv_v2_normalize_text(p_payload->>'brand');
  v_barcodes text[] := coalesce(array(
    select public.inv_v2_normalize_text(value)
    from jsonb_array_elements_text(coalesce(p_payload->'barcodes','[]'::jsonb)) q(value)
    where public.inv_v2_normalize_text(value) is not null
  ), '{}'::text[]);
  v_item uuid;
  v_old jsonb;
  v_new jsonb;
  v_barcode text;
begin
  if not public.inv_require_admin(p_session_token) then
    insert into public.inv_v2_audit_log(action, details) values ('permission_denied', jsonb_build_object('operation',v_operation));
    raise exception 'Unauthorized';
  end if;

  if v_operation = 'deactivate' then
    if p_item_id is null then raise exception 'Item id is required'; end if;
    select to_jsonb(i) into v_old from public.inv_items i where i.id=p_item_id;
    if v_old is null then raise exception 'Item not found'; end if;
    update public.inv_items set active=false where id=p_item_id;
    insert into public.inv_v2_audit_log(action,item_id,import_id,details)
      values('deactivate',p_item_id,p_import_id,jsonb_build_object('old',v_old,'new',jsonb_build_object('active',false)));
    return jsonb_build_object('ok',true,'item_id',p_item_id,'action','deactivate');
  end if;

  if v_section not in ('restaurant','vegetable') then raise exception 'Section must be restaurant or vegetable'; end if;
  if v_name is null then raise exception 'Item name is required'; end if;
  if v_category is null then raise exception 'Category is required'; end if;
  if v_base_uom not in ('kg','L','pcs') then raise exception 'Base UOM must be kg, L or pcs'; end if;
  if v_count_mode not in ('unit','packet') then raise exception 'Count mode must be unit or packet'; end if;
  if v_count_mode='packet' and (v_pack is null or v_pack <= 0) then raise exception 'Default pack size is required and must be greater than 0 for packet mode'; end if;
  if v_count_mode='unit' then v_pack := null; end if;
  if v_no_barcode and cardinality(v_barcodes)>0 then raise exception 'No barcode cannot be combined with barcodes'; end if;
  if not v_no_barcode and cardinality(v_barcodes)=0 then raise exception 'Barcode is required unless no_barcode is TRUE'; end if;

  if exists(select 1 from public.inv_items i where i.section=v_section and lower(public.inv_v2_normalize_text(i.name))=lower(v_name) and i.id is distinct from p_item_id) then
    insert into public.inv_v2_audit_log(action,item_id,import_id,details) values('validation_failure',p_item_id,p_import_id,jsonb_build_object('reason','duplicate_name','name',v_name,'section',v_section));
    raise exception 'Duplicate item name in this section';
  end if;

  foreach v_barcode in array v_barcodes loop
    if not public.inv_v2_barcode_valid(v_barcode) then
      insert into public.inv_v2_audit_log(action,item_id,import_id,barcode,details) values('validation_failure',p_item_id,p_import_id,v_barcode,jsonb_build_object('reason','invalid_barcode'));
      raise exception 'Invalid barcode check digit: %',v_barcode;
    end if;
    if exists(select 1 from public.inv_item_barcodes b where b.barcode=v_barcode and b.item_id is distinct from p_item_id) then
      insert into public.inv_v2_audit_log(action,item_id,import_id,barcode,details) values('validation_failure',p_item_id,p_import_id,v_barcode,jsonb_build_object('reason','barcode_already_linked'));
      raise exception 'Barcode already linked: %',v_barcode;
    end if;
  end loop;

  if v_operation='update' then
    if p_item_id is null then raise exception 'Item id is required'; end if;
    select to_jsonb(i) into v_old from public.inv_items i where i.id=p_item_id;
    if v_old is null then raise exception 'Item not found'; end if;
    update public.inv_items
      set section=v_section,name=v_name,category=v_category,unit=v_base_uom,
          aliases=v_aliases,brand=v_brand,pack_size=v_pack,
          pack_uom=case when v_pack is null then null else v_base_uom end,
          base_qty_per_pack=v_pack
      where id=p_item_id;
    insert into public.inv_v2_item_meta(item_id,count_mode,default_pack_size,no_barcode)
      values(p_item_id,v_count_mode,v_pack,v_no_barcode)
      on conflict(item_id) do update set count_mode=excluded.count_mode,default_pack_size=excluded.default_pack_size,no_barcode=excluded.no_barcode,updated_at=now();
    delete from public.inv_item_barcodes where item_id=p_item_id;
    foreach v_barcode in array v_barcodes loop
      insert into public.inv_item_barcodes(barcode,item_id) values(v_barcode,p_item_id);
    end loop;
    v_item:=p_item_id;
    v_new:=jsonb_build_object('section',v_section,'name',v_name,'category',v_category,'base_uom',v_base_uom,'count_mode',v_count_mode,'default_pack_size',v_pack,'barcodes',to_jsonb(v_barcodes),'no_barcode',v_no_barcode,'aliases',to_jsonb(v_aliases),'brand',v_brand);
    insert into public.inv_v2_audit_log(action,item_id,import_id,details) values('edit',v_item,p_import_id,jsonb_build_object('old',v_old,'new',v_new));
    return jsonb_build_object('ok',true,'item_id',v_item,'action','update');
  end if;

  if v_operation<>'create' then raise exception 'Unsupported operation'; end if;
  insert into public.inv_items(section,name,aliases,unit,category,brand,pack_size,pack_uom,base_qty_per_pack)
    values(v_section,v_name,v_aliases,v_base_uom,v_category,v_brand,v_pack,case when v_pack is null then null else v_base_uom end,v_pack)
    returning id into v_item;
  insert into public.inv_v2_item_meta(item_id,count_mode,default_pack_size,no_barcode)
    values(v_item,v_count_mode,v_pack,v_no_barcode);
  foreach v_barcode in array v_barcodes loop
    insert into public.inv_item_barcodes(barcode,item_id) values(v_barcode,v_item);
  end loop;
  v_new:=jsonb_build_object('section',v_section,'name',v_name,'category',v_category,'base_uom',v_base_uom,'count_mode',v_count_mode,'default_pack_size',v_pack,'barcodes',to_jsonb(v_barcodes),'no_barcode',v_no_barcode,'aliases',to_jsonb(v_aliases),'brand',v_brand);
  insert into public.inv_v2_audit_log(action,item_id,import_id,details) values('add',v_item,p_import_id,jsonb_build_object('new',v_new));
  return jsonb_build_object('ok',true,'item_id',v_item,'action','create');
exception when others then
  if sqlstate not in ('P0001','23505','23514') then
    insert into public.inv_v2_audit_log(action,item_id,import_id,details) values('error',p_item_id,p_import_id,jsonb_build_object('operation',v_operation,'message',sqlerrm));
  end if;
  raise;
end;
$$;

create or replace function public.inv_v2_get_items(p_session_token text, p_section text default 'restaurant')
returns table(
 id uuid, section text, name text, aliases text[], base_uom text, category text,
 active boolean, barcodes text[], brand text, count_mode text, default_pack_size numeric, no_barcode boolean
)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
  return query
  select i.id,i.section,i.name,i.aliases,i.unit,i.category,i.active,
         coalesce(array_agg(b.barcode order by b.barcode) filter(where b.barcode is not null),'{}'::text[]),
         i.brand,coalesce(m.count_mode,case when i.pack_size is null then 'unit' else 'packet' end),
         coalesce(m.default_pack_size,i.pack_size),
         coalesce(m.no_barcode,not exists(select 1 from public.inv_item_barcodes bx where bx.item_id=i.id))
  from public.inv_items i
  left join public.inv_item_barcodes b on b.item_id=i.id
  left join public.inv_v2_item_meta m on m.item_id=i.id
  where i.section=p_section
  group by i.id,i.section,i.name,i.aliases,i.unit,i.category,i.active,i.brand,m.count_mode,m.default_pack_size,m.no_barcode,i.pack_size
  order by i.category,i.name;
end;
$$;

create or replace function public.inv_v2_lookup_linked(p_session_token text, p_barcode text)
returns table(item_id uuid,item_name text,active boolean)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.inv_require_admin(p_session_token) then raise exception 'Unauthorized'; end if;
  return query select i.id,i.name,i.active from public.inv_item_barcodes b join public.inv_items i on i.id=b.item_id where b.barcode=trim(p_barcode);
end;
$$;

revoke all on function public.inv_v2_save_item(text,uuid,jsonb,uuid) from public;
revoke all on function public.inv_v2_get_items(text,text) from public;
revoke all on function public.inv_v2_lookup_linked(text,text) from public;
grant execute on function public.inv_v2_save_item(text,uuid,jsonb,uuid) to anon, authenticated;
grant execute on function public.inv_v2_get_items(text,text) to anon, authenticated;
grant execute on function public.inv_v2_lookup_linked(text,text) to anon, authenticated;

-- END OF PART 1/1
