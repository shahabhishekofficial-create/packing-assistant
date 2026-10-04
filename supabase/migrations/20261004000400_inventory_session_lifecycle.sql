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
    and status in ('open','submitted') and counted_by=v_name
  order by case when status='open' then 0 else 1 end,created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.inv_count_sessions(section,date,counted_by)
  values(p_section,coalesce(p_date,current_date),v_name) returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.inv_staff_start_session(text,text,date) from public;
grant execute on function public.inv_staff_start_session(text,text,date) to anon, authenticated;
