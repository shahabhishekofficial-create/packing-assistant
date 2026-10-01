create or replace function public.inv_veg_staff_get_submitted_report(p_staff_token text,p_session_id uuid)
returns table(count_date date,submitted_at timestamptz,staff_name text,name_en text,grade text,weight_kg numeric,reason text,counted_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare th text;v_staff uuid;v_status text;
begin
 th=encode(extensions.digest(p_staff_token,'sha256'),'hex');
 select staff_id into v_staff from public.inv_staff_sessions where token_hash=th and expires_at>now();
 if v_staff is null then raise exception 'Staff session expired'; end if;
 select s.status into v_status from public.inv_vegetable_count_sessions s where s.session_id=p_session_id;
 if v_status is null then raise exception 'Counting session not found'; end if;
 if v_status<>'submitted' then raise exception 'Counting session is not submitted'; end if;
 return query
 select s.count_date,s.submitted_at,u.name,i.name_en,c.grade,c.weight_kg,c.reason,c.counted_at
 from public.inv_vegetable_count_sessions s
 join public.inv_vegetable_counts c on c.session_id=s.session_id
 join public.inv_vegetable_items i on i.item_id=c.item_id
 join public.inv_staff_users u on u.id=c.counted_by
 where s.session_id=p_session_id
 order by i.name_en,case c.grade when 'A' then 1 when 'B' then 2 else 3 end;
end
$function$;
revoke execute on function public.inv_veg_staff_get_submitted_report(text,uuid) from public;
grant execute on function public.inv_veg_staff_get_submitted_report(text,uuid) to anon,authenticated;