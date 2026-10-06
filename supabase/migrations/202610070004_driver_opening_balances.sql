create table if not exists public.driver_opening_balances(
 driver_id uuid primary key references public.driver_accounts(id) on delete cascade,
 amount numeric(12,2) not null default 0 check(amount>=0),
 as_of_date timestamptz not null default now(),
 note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.driver_opening_balances enable row level security;
revoke all on public.driver_opening_balances from anon,authenticated;
grant all on public.driver_opening_balances to service_role;

create or replace function public.admin_set_driver_opening_balance(p_session_token text,p_driver_id uuid,p_amount numeric,p_as_of_date timestamptz,p_note text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_old numeric;
begin
 if not public.verify_admin_session(p_session_token) then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
 if p_amount<0 then return jsonb_build_object('ok',false,'message','Opening balance cannot be negative'); end if;
 if not exists(select 1 from public.driver_accounts where id=p_driver_id and active=true) then return jsonb_build_object('ok',false,'message','Driver not found'); end if;
 select amount into v_old from public.driver_opening_balances where driver_id=p_driver_id;
 insert into public.driver_opening_balances(driver_id,amount,as_of_date,note,updated_at) values(p_driver_id,p_amount,coalesce(p_as_of_date,now()),coalesce(p_note,''),now())
 on conflict(driver_id) do update set amount=excluded.amount,as_of_date=excluded.as_of_date,note=excluded.note,updated_at=now();
 insert into public.operations_audit_v1(table_name,operation,record_id,actor,old_data,new_data) values('driver_opening_balances',case when v_old is null then 'INSERT' else 'UPDATE' end,p_driver_id::text,'ADMIN',jsonb_build_object('amount',v_old),jsonb_build_object('amount',p_amount,'as_of_date',coalesce(p_as_of_date,now()),'note',coalesce(p_note,'')));
 return jsonb_build_object('ok',true,'driver_id',p_driver_id,'amount',p_amount);
end;$function$;
revoke execute on function public.admin_set_driver_opening_balance(text,uuid,numeric,timestamptz,text) from public,anon,authenticated;
grant execute on function public.admin_set_driver_opening_balance(text,uuid,numeric,timestamptz,text) to service_role;

create or replace function public.admin_driver_payment_ledger_session(p_session_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_rows jsonb;
begin
 if not public.verify_admin_session(p_session_token) then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('driver_id',d.id,'driver_name',d.driver_name,'opening_balance',coalesce(ob.amount,0),'opening_balance_date',ob.as_of_date,'opening_balance_note',coalesce(ob.note,''),'earned',coalesce(e.earned,0),'paid',coalesce(p.paid,0),'total_due',coalesce(ob.amount,0)+coalesce(e.earned,0),'balance',greatest(coalesce(ob.amount,0)+coalesce(e.earned,0)-coalesce(p.paid,0),0),'overpaid',greatest(coalesce(p.paid,0)-coalesce(ob.amount,0)-coalesce(e.earned,0),0),'payments',coalesce(p.rows,'[]'::jsonb)) order by d.driver_name),'[]'::jsonb) into v_rows
 from public.driver_accounts d left join public.driver_opening_balances ob on ob.driver_id=d.id
 left join (select driver_id,sum(delivery_charge)::numeric(12,2) earned from public.delivery_records where status='delivered' or invoice_path is not null group by driver_id) e on e.driver_id=d.id
 left join (select driver_id,sum(amount)::numeric(12,2) paid,jsonb_agg(jsonb_build_object('id',id,'amount',amount,'paid_at',paid_at,'note',coalesce(note,''),'payment_mode',coalesce(payment_mode,''),'reference_number',coalesce(reference_number,''),'screenshot_path',screenshot_path,'confirmed_at',confirmed_at) order by paid_at desc) rows from public.driver_payments group by driver_id) p on p.driver_id=d.id
 where d.active=true;
 return jsonb_build_object('ok',true,'drivers',v_rows);
end;$function$;