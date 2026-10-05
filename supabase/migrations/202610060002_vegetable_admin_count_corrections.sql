create table if not exists public.inv_vegetable_count_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inv_vegetable_counts(count_id),
  item_id uuid not null references public.inv_vegetable_items(item_id),
  grade text not null check (grade in ('A','B','DUMP')),
  weight_kg numeric not null check (weight_kg >= 0),
  reason text,
  corrected_by text not null default 'admin',
  corrected_at timestamptz not null default now(),
  unique(count_id)
);
alter table public.inv_vegetable_count_corrections enable row level security;
revoke all on public.inv_vegetable_count_corrections from anon, authenticated;
grant select,insert,update on public.inv_vegetable_count_corrections to service_role;

create or replace function public.inv_veg_admin_correct_count(
  p_admin_token text,p_count_id uuid,p_item_id uuid,p_grade text,p_weight_kg numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_session_id uuid; v_correction_id uuid;
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 if p_grade not in ('A','B','DUMP') then raise exception 'Invalid grade'; end if;
 if p_weight_kg is null or p_weight_kg<0 then raise exception 'Weight must be zero or greater'; end if;
 if not exists(select 1 from public.inv_vegetable_items where item_id=p_item_id) then raise exception 'Vegetable item not found'; end if;
 select session_id into v_session_id from public.inv_vegetable_counts where count_id=p_count_id;
 if v_session_id is null then raise exception 'Count entry not found'; end if;
 insert into public.inv_vegetable_count_corrections(count_id,item_id,grade,weight_kg,reason,corrected_by)
 values(p_count_id,p_item_id,p_grade,p_weight_kg,nullif(trim(coalesce(p_reason,'')),''),'admin')
 on conflict(count_id) do update set item_id=excluded.item_id,grade=excluded.grade,weight_kg=excluded.weight_kg,reason=excluded.reason,corrected_by='admin',corrected_at=now()
 returning correction_id into v_correction_id;
 return jsonb_build_object('correction_id',v_correction_id,'count_id',p_count_id,'session_id',v_session_id,'item_id',p_item_id,'grade',p_grade,'weight_kg',p_weight_kg);
end $$;

create or replace function public.inv_veg_admin_report(
 p_admin_token text,p_from date default null,p_to date default null,p_item_id uuid default null,p_grade text default null
) returns table(count_id uuid,session_id uuid,count_date date,item_id uuid,item_name text,grade text,weight_kg numeric,counted_by text,counted_at timestamptz,inward_date date,reason text)
language plpgsql security definer set search_path to '' as $$
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 return query select c.count_id,c.session_id,s.count_date,coalesce(cc.item_id,c.item_id),i.name_en,coalesce(cc.grade,c.grade),coalesce(cc.weight_kg,c.weight_kg),u.name,c.counted_at,c.inward_date,coalesce(cc.reason,c.reason)
 from public.inv_vegetable_counts c
 join public.inv_vegetable_count_sessions s on s.session_id=c.session_id
 join public.inv_staff_users u on u.id=c.counted_by
 left join public.inv_vegetable_count_corrections cc on cc.count_id=c.count_id
 join public.inv_vegetable_items i on i.item_id=coalesce(cc.item_id,c.item_id)
 where (p_from is null or s.count_date>=p_from) and (p_to is null or s.count_date<=p_to)
 and (p_item_id is null or coalesce(cc.item_id,c.item_id)=p_item_id)
 and (p_grade is null or coalesce(cc.grade,c.grade)=p_grade)
 order by s.count_date desc,c.counted_at desc;
end $$;
