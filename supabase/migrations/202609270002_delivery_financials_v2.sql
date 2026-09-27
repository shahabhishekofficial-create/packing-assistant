create or replace function public.admin_delivery_financials_v2(p_admin_session text,p_from_date date default null,p_to_date date default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_ok boolean;v_from timestamptz;v_to timestamptz;
begin
 select public.verify_admin_session(p_admin_session) into v_ok;
 if coalesce(v_ok,false) is not true then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
 v_from:=case when p_from_date is null then null else p_from_date::timestamp at time zone 'Asia/Kolkata' end;
 v_to:=case when p_to_date is null then null else ((p_to_date+1)::timestamp at time zone 'Asia/Kolkata') end;
 return jsonb_build_object('ok',true,'rows',coalesce((
  select jsonb_agg(jsonb_build_object('driver_id',a.id,'earned_all',coalesce(e.all_earned,0),'earned_period',coalesce(e.period_earned,0),'paid_all',coalesce(p.all_paid,0),'paid_period',coalesce(p.period_paid,0)) order by a.driver_name)
  from public.driver_accounts a
  left join (select driver_id,sum(amount) all_earned,sum(amount) filter(where v_from is null or created_at>=v_from and (v_to is null or created_at<v_to)) period_earned from public.driver_ledger_entries where entry_type='DELIVERY_EARNING' group by driver_id) e on e.driver_id=a.id
  left join (select driver_id,sum(amount) all_paid,sum(amount) filter(where v_from is null or paid_at>=v_from and (v_to is null or paid_at<v_to)) period_paid from public.driver_payments group by driver_id) p on p.driver_id=a.id
  where a.active=true
 ),'[]'::jsonb));
end $$;
revoke all on function public.admin_delivery_financials_v2(text,date,date) from public,anon,authenticated;
grant execute on function public.admin_delivery_financials_v2(text,date,date) to service_role;
alter table public.delivery_records drop constraint if exists delivery_records_order_outlet_unique;
drop index if exists public.delivery_records_order_outlet_uidx;
create index if not exists driver_payments_confirmed_by_driver_idx on public.driver_payments(confirmed_by_driver_id);
create index if not exists driver_sessions_driver_idx on public.driver_sessions(driver_id);