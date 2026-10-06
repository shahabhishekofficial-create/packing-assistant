-- Allow Admin and the assigned delivery partner to resolve a MISSING/PARTIAL item
-- after late stock is received, without changing the normal packing flow.
-- The function is server-side only; browser clients use driver-api.

create or replace function public.mark_exception_item_packed(
  p_order_id uuid,
  p_item_id uuid,
  p_admin_session text default null,
  p_driver_session text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_driver_id uuid;
  v_driver_name text;
  v_actor text;
  v_old_status text;
  v_old_packed numeric;
  v_old_missing numeric;
begin
  if p_order_id is null or p_item_id is null then
    return jsonb_build_object('ok',false,'message','Order and item are required');
  end if;
  select * into v_item from public.order_items where id=p_item_id and order_id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'message','Item not found'); end if;
  v_old_status:=upper(coalesce(v_item.status,'PENDING')); v_old_packed:=coalesce(v_item.packed_qty,0); v_old_missing:=coalesce(v_item.missing_qty,0);
  if v_old_status not in ('MISSING','PARTIAL') then return jsonb_build_object('ok',false,'message','Only Missing or Partial items can be marked as Packed'); end if;
  if public.verify_admin_session(coalesce(p_admin_session,'')) then
    v_actor:='ADMIN';
  else
    select da.id,da.driver_name into v_driver_id,v_driver_name
    from public.driver_accounts da join public.driver_sessions s on s.driver_id=da.id
    where s.token_hash=encode(extensions.digest(coalesce(p_driver_session,''),'sha256'),'hex') and s.expires_at>now() and da.active=true limit 1;
    if v_driver_id is null then return jsonb_build_object('ok',false,'message','Session expired'); end if;
    if not exists(select 1 from public.outlets o where o.id=v_item.outlet_id and o.order_id=p_order_id and (o.driver_id=v_driver_id or lower(trim(coalesce(o.driver,'')))=lower(trim(v_driver_name)))) then
      return jsonb_build_object('ok',false,'message','This item is not in an outlet assigned to your driver account');
    end if;
    v_actor:='DRIVER:'||v_driver_id::text;
  end if;
  update public.order_items set packed_qty=v_item.required_qty,missing_qty=0,status='packed',reason=null,completed_at=now(),updated_at=now() where id=p_item_id;
  insert into public.packing_events(order_id,outlet_id,item_id,device_id,action,required_qty,packed_qty,missing_qty,status,reason)
  values(p_order_id,v_item.outlet_id,p_item_id,v_actor,'EXCEPTION_MARKED_PACKED',v_item.required_qty,v_item.required_qty,0,'packed',null);
  insert into public.operations_audit_v1(table_name,operation,record_id,actor,old_data,new_data)
  values('order_items','UPDATE',p_item_id::text,v_actor,jsonb_build_object('status',v_old_status,'packed_qty',v_old_packed,'missing_qty',v_old_missing,'reason',v_item.reason),jsonb_build_object('status','PACKED','packed_qty',v_item.required_qty,'missing_qty',0,'reason',null,'order_id',p_order_id,'outlet_id',v_item.outlet_id,'exception_resolved',true));
  return jsonb_build_object('ok',true,'item_id',p_item_id,'order_id',p_order_id,'status','PACKED','packed_qty',v_item.required_qty,'missing_qty',0,'actor',v_actor);
end;
$$;
revoke all on function public.mark_exception_item_packed(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_exception_item_packed(uuid,uuid,text,text) to service_role;
