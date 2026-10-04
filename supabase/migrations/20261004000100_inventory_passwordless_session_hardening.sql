-- Inventory passwordless guest-session hardening
-- Applied to production as 20261004000100_inventory_passwordless_session_hardening.
-- No employee login is used by the Inventory counting pages.

create or replace function public.inv_inventory_guest_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_staff uuid; v_token text; v_hash text;
begin
  select id into v_staff from public.inv_staff_users
  where lower(trim(login_name))='__inventory_guest__' and active=true limit 1;
  if v_staff is null then raise exception 'Inventory access is unavailable. Contact admin.'; end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_hash := encode(extensions.digest(v_token,'sha256'),'hex');
  insert into public.inv_staff_sessions(token_hash,staff_id,expires_at)
  values(v_hash,v_staff,now()+interval '12 hours');
  return jsonb_build_object('token',v_token,'staff_name','Warehouse Staff');
end;
$function$;

create or replace function public.inv_staff_start_session(
  p_staff_token text,p_section text,p_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_staff uuid; v_name text; v_id uuid; th text;
begin
  th=encode(extensions.digest(p_staff_token,'sha256'),'hex');
  select s.staff_id,u.name into v_staff,v_name
  from public.inv_staff_sessions s join public.inv_staff_users u on u.id=s.staff_id
  where s.token_hash=th and s.expires_at>now() and u.active=true;
  if v_staff is null then raise exception 'Staff session expired'; end if;
  if p_section not in ('restaurant','vegetable') then raise exception 'Invalid section'; end if;
  update public.inv_staff_sessions set last_seen_at=now() where token_hash=th;
  select id into v_id from public.inv_count_sessions
  where section=p_section and date=coalesce(p_date,current_date)
    and status='open' and counted_by=v_name
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.inv_count_sessions(section,date,counted_by)
  values(p_section,coalesce(p_date,current_date),v_name) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.inv_veg_staff_save_count(
  p_staff_token text,p_session_id uuid,p_item_id uuid,p_grade text,
  p_weight_kg numeric,p_inward_date date default null,p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare th text; v_staff uuid; v_name text; v_status text; v_id uuid;
begin
  if p_grade not in ('A','B','DUMP') then raise exception 'Invalid grade'; end if;
  if p_weight_kg is null or p_weight_kg<0 then raise exception 'Weight must be zero or greater'; end if;
  if p_inward_date is not null then raise exception 'Inward date is not used in vegetable inventory counting'; end if;
  th=encode(extensions.digest(p_staff_token,'sha256'),'hex');
  select s.staff_id,u.name into v_staff,v_name from public.inv_staff_sessions s
  join public.inv_staff_users u on u.id=s.staff_id
  where s.token_hash=th and s.expires_at>now() and u.active;
  if v_staff is null then raise exception 'Staff session expired'; end if;
  select status into v_status from public.inv_vegetable_count_sessions where session_id=p_session_id;
  if v_status is null then raise exception 'Counting session not found'; end if;
  if v_status<>'open' then raise exception 'Counting session is already submitted'; end if;
  if not exists(select 1 from public.inv_vegetable_items where item_id=p_item_id and is_active)
    then raise exception 'Vegetable item not found'; end if;
  insert into public.inv_vegetable_counts(item_id,session_id,grade,weight_kg,inward_date,reason,counted_by)
  values(p_item_id,p_session_id,p_grade,p_weight_kg,null,nullif(trim(coalesce(p_reason,'')),''),v_staff)
  on conflict(session_id,item_id,grade) do update
  set weight_kg=excluded.weight_kg,inward_date=null,reason=excluded.reason,
      counted_by=excluded.counted_by,counted_at=now()
  returning count_id into v_id;
  update public.inv_staff_sessions set last_seen_at=now() where token_hash=th;
  return jsonb_build_object('count_id',v_id,'item_id',p_item_id,'grade',p_grade,
    'weight_kg',p_weight_kg,'counted_by',v_name);
end;
$function$;

revoke all on function public.inv_inventory_guest_session() from public;
grant execute on function public.inv_inventory_guest_session() to anon, authenticated;
revoke all on function public.inv_staff_start_session(text,text,date) from public;
grant execute on function public.inv_staff_start_session(text,text,date) to anon, authenticated;
revoke all on function public.inv_veg_staff_save_count(text,uuid,uuid,text,numeric,date,text) from public;
grant execute on function public.inv_veg_staff_save_count(text,uuid,uuid,text,numeric,date,text) to anon, authenticated;
