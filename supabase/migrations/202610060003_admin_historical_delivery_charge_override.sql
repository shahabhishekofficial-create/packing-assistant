create or replace function public.admin_adjust_delivery_charge(
  p_admin_session text,
  p_delivery_record_id uuid,
  p_new_charge numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ok boolean;
  v_rec public.delivery_records%rowtype;
  v_old_charge numeric;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_ledger_id uuid;
begin
  select public.verify_admin_session(p_admin_session) into v_ok;
  if coalesce(v_ok,false) is not true then
    return jsonb_build_object('ok',false,'message','Admin session expired');
  end if;
  if p_delivery_record_id is null then return jsonb_build_object('ok',false,'message','Delivery record is required'); end if;
  if p_new_charge is null or p_new_charge < 0 or p_new_charge > 1000000 then return jsonb_build_object('ok',false,'message','Delivery charge must be between ₹0 and ₹10,00,000'); end if;
  if v_reason is null then return jsonb_build_object('ok',false,'message','Reason is required for a historical charge change'); end if;

  select * into v_rec from public.delivery_records where id=p_delivery_record_id for update;
  if not found then return jsonb_build_object('ok',false,'message','Delivery record not found'); end if;
  v_old_charge := coalesce(v_rec.delivery_charge,0);

  update public.delivery_records
  set delivery_charge=round(p_new_charge,2),updated_at=now(),last_action_at=now()
  where id=p_delivery_record_id;

  update public.driver_ledger_entries
  set amount=round(p_new_charge,2),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('historical_charge_override',true,'previous_amount',v_old_charge,'override_reason',v_reason,'overridden_at',now())
  where delivery_record_id=p_delivery_record_id and entry_type='DELIVERY_EARNING';

  if found then
    select id into v_ledger_id from public.driver_ledger_entries
    where delivery_record_id=p_delivery_record_id and entry_type='DELIVERY_EARNING'
    order by created_at desc limit 1;
  elsif coalesce(v_rec.status,'')='delivered' or v_rec.invoice_path is not null then
    insert into public.driver_ledger_entries(driver_id,delivery_record_id,entry_type,amount,reference_key,metadata)
    values(v_rec.driver_id,p_delivery_record_id,'DELIVERY_EARNING',round(p_new_charge,2),'delivery:'||p_delivery_record_id::text,
      jsonb_build_object('historical_charge_override',true,'override_reason',v_reason))
    on conflict(reference_key) do update set amount=excluded.amount,metadata=public.driver_ledger_entries.metadata||excluded.metadata
    returning id into v_ledger_id;
  end if;

  insert into public.operations_audit_v1(table_name,operation,record_id,actor,old_data,new_data)
  values('delivery_records','UPDATE',p_delivery_record_id::text,'admin',
    jsonb_build_object('delivery_charge',v_old_charge,'driver_id',v_rec.driver_id,'outlet_id',v_rec.outlet_id,'order_id',v_rec.order_id),
    jsonb_build_object('delivery_charge',round(p_new_charge,2),'driver_id',v_rec.driver_id,'outlet_id',v_rec.outlet_id,'order_id',v_rec.order_id,'reason',v_reason,'historical_override',true,'driver_ledger_entry_id',v_ledger_id));

  return jsonb_build_object('ok',true,'delivery_record_id',p_delivery_record_id,'old_charge',v_old_charge,'new_charge',round(p_new_charge,2),'ledger_entry_id',v_ledger_id,'outlet_default_unchanged',true);
end;
$$;

revoke execute on function public.admin_adjust_delivery_charge(text,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_delivery_charge(text,uuid,numeric,text) to service_role;
