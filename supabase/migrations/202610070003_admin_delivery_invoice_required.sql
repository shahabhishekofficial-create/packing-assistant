create or replace function public.admin_approve_outlet_delivered(
 p_admin_session text,p_order_id uuid,p_outlet_id uuid,
 p_reason text default 'Admin approval after delivery session cutoff',
 p_invoice_number text default null,p_invoice_path text default null
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare v_cutoff timestamptz;v_order public.orders;v_outlet public.outlets;v_rec public.delivery_records;v_driver_id uuid;v_now timestamptz:=now();v_ledger_id uuid;v_old_status text;v_old_state text;v_old_delivered_at timestamptz;
begin
 if not public.verify_admin_session(coalesce(p_admin_session,'')) then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
 if coalesce(trim(p_invoice_number),'') !~ '^[0-9]+$' then return jsonb_build_object('ok',false,'message','Invoice number is required and must be numeric'); end if;
 if coalesce(trim(p_invoice_path),'')='' then return jsonb_build_object('ok',false,'message','Invoice image is required'); end if;
 if not exists(select 1 from storage.objects so where so.bucket_id='delivery-invoices' and so.name=trim(p_invoice_path)) then return jsonb_build_object('ok',false,'message','Invoice image upload could not be verified'); end if;
 select * into v_order from public.orders where id=p_order_id;if not found then return jsonb_build_object('ok',false,'message','Order not found');end if;
 v_cutoff=((v_order.created_at at time zone 'Asia/Kolkata')::date+interval '1 day'+interval '12 hours') at time zone 'Asia/Kolkata';
 -- Admin may complete a delivery at any time when the driver cannot do so. The 12 PM cutoff only locks the driver workflow.
 select * into v_outlet from public.outlets where id=p_outlet_id and order_id=p_order_id;if not found then return jsonb_build_object('ok',false,'message','Outlet not found in this order');end if;
 if lower(coalesce(v_outlet.status,''))<>'completed' then return jsonb_build_object('ok',false,'message','Outlet packing is not completed');end if;
 select * into v_rec from public.delivery_records where order_id=p_order_id and outlet_id=p_outlet_id for update;
 if found then
  v_old_status=v_rec.status;v_old_state=v_rec.delivery_state;v_old_delivered_at=v_rec.delivered_at;
  update public.delivery_records set status='delivered',delivered_at=coalesce(delivered_at,v_now),delivery_state='DELIVERED',state_version=coalesce(state_version,0)+1,last_action_at=v_now,updated_at=v_now,invoice_number=trim(p_invoice_number),invoice_path=trim(p_invoice_path),invoice_uploaded_at=coalesce(invoice_uploaded_at,v_now),last_error_code=null,last_error_message=null where id=v_rec.id returning * into v_rec;
 else
  insert into public.delivery_records(order_id,outlet_id,driver_id,driver,status,delivery_charge,delivery_state,delivered_at,last_action_at,updated_at,invoice_number,invoice_path,invoice_uploaded_at) values(p_order_id,p_outlet_id,v_outlet.driver_id,v_outlet.driver,'delivered',coalesce(v_outlet.delivery_charge,0),'DELIVERED',v_now,v_now,v_now,trim(p_invoice_number),trim(p_invoice_path),v_now) returning * into v_rec;
  v_old_status='pending';v_old_state=null;v_old_delivered_at=null;
 end if;
 v_driver_id=v_rec.driver_id;
 if v_driver_id is not null then
  insert into public.driver_ledger_entries(driver_id,delivery_record_id,entry_type,amount,reference_key,metadata,created_at) values(v_driver_id,v_rec.id,'DELIVERY_EARNING',coalesce(v_rec.delivery_charge,0),'delivery:'||v_rec.id::text,jsonb_build_object('order_id',p_order_id,'outlet_id',p_outlet_id,'admin_approved',true,'reason',coalesce(nullif(trim(p_reason),''),'Admin approval after delivery session cutoff')),v_now) on conflict(reference_key) do nothing returning id into v_ledger_id;
 end if;
 insert into public.operations_audit_v1(table_name,operation,record_id,actor,old_data,new_data) values('delivery_records','UPDATE',v_rec.id::text,'ADMIN',jsonb_build_object('status',v_old_status,'delivery_state',v_old_state,'delivered_at',v_old_delivered_at),jsonb_build_object('status','delivered','delivery_state','DELIVERED','order_id',p_order_id,'outlet_id',p_outlet_id,'cutoff_at',v_cutoff,'invoice_number',trim(p_invoice_number),'invoice_path',trim(p_invoice_path),'reason',coalesce(nullif(trim(p_reason),''),'Admin approval after delivery session cutoff')));
 return jsonb_build_object('ok',true,'delivery_id',v_rec.id,'delivery_state','DELIVERED','delivered_at',v_rec.delivered_at,'cutoff_at',v_cutoff,'invoice_number',v_rec.invoice_number,'invoice_path',v_rec.invoice_path,'ledger_created',v_ledger_id is not null);
end;$function$;
revoke execute on function public.admin_approve_outlet_delivered(text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_approve_outlet_delivered(text,uuid,uuid,text,text,text) to service_role;