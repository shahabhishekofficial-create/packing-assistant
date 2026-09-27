create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_record_id uuid not null references public.delivery_records(id) on delete cascade,
  order_id uuid not null,
  outlet_id uuid not null,
  driver_id uuid,
  event_type text not null,
  from_state text,
  to_state text,
  idempotency_key text,
  actor_type text not null default 'driver',
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists delivery_events_idempotency_key_uidx on public.delivery_events(idempotency_key) where idempotency_key is not null;
create index if not exists delivery_events_delivery_created_idx on public.delivery_events(delivery_record_id,created_at desc);
create index if not exists delivery_events_order_outlet_idx on public.delivery_events(order_id,outlet_id,created_at desc);
create table if not exists public.driver_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_accounts(id),
  delivery_record_id uuid references public.delivery_records(id) on delete set null,
  entry_type text not null,
  amount numeric not null default 0,
  reference_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists driver_ledger_driver_created_idx on public.driver_ledger_entries(driver_id,created_at desc);
create index if not exists driver_ledger_delivery_idx on public.driver_ledger_entries(delivery_record_id);
alter table public.delivery_records
  add column if not exists delivery_state text not null default 'READY_FOR_DELIVERY',
  add column if not exists state_version integer not null default 1,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists last_action_at timestamptz;
update public.delivery_records set delivery_state=case when lower(coalesce(status,''))='delivered' then 'DELIVERED' when invoice_path is not null then 'INVOICE_UPLOADED' when rejections_confirmed then 'REJECTION_CONFIRMED' else 'READY_FOR_DELIVERY' end where delivery_state is null or delivery_state='READY_FOR_DELIVERY';
create index if not exists delivery_records_state_updated_idx on public.delivery_records(delivery_state,updated_at desc);
create index if not exists delivery_records_driver_state_updated_idx on public.delivery_records(driver_id,delivery_state,updated_at desc);
create index if not exists delivery_records_order_outlet_updated_idx on public.delivery_records(order_id,outlet_id,updated_at desc);
alter table public.delivery_events enable row level security;
alter table public.driver_ledger_entries enable row level security;
revoke all on public.delivery_events from anon,authenticated;
revoke all on public.driver_ledger_entries from anon,authenticated;
create or replace function public.delivery_transition_v2(
 p_session_token text,p_order_id uuid,p_outlet_id uuid,p_action text,p_idempotency_key text default null,
 p_invoice_number text default null,p_invoice_path text default null,p_invoice_filename text default null,
 p_invoice_mime_type text default null,p_ocr_status text default null,p_ocr_result jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_hash text;v_driver_id uuid;v_driver_name text;v_rec public.delivery_records;v_from text;v_to text;v_event_id uuid;v_ledger_id uuid;v_now timestamptz:=now();v_charge numeric:=0;
begin
 if coalesce(trim(p_session_token),'')='' then return jsonb_build_object('ok',false,'message','Session expired'); end if;
 v_hash:=encode(extensions.digest(p_session_token,'sha256'),'hex');
 select da.id,da.driver_name into v_driver_id,v_driver_name from public.driver_accounts da join public.driver_sessions s on s.driver_id=da.id where s.token_hash=v_hash and s.expires_at>now() and da.active=true limit 1;
 if v_driver_id is null then return jsonb_build_object('ok',false,'message','Session expired'); end if;
 if p_idempotency_key is not null then
   select id into v_event_id from public.delivery_events where idempotency_key=p_idempotency_key limit 1;
   if v_event_id is not null then select * into v_rec from public.delivery_records where order_id=p_order_id and outlet_id=p_outlet_id and driver_id=v_driver_id limit 1; return jsonb_build_object('ok',true,'idempotent',true,'delivery_state',coalesce(v_rec.delivery_state,'DELIVERED'),'delivery_id',v_rec.id); end if;
 end if;
 select * into v_rec from public.delivery_records where order_id=p_order_id and outlet_id=p_outlet_id and driver_id=v_driver_id for update;
 if not found then
   select o.delivery_charge into v_charge from public.outlets o where o.id=p_outlet_id and o.order_id=p_order_id and o.driver_id=v_driver_id;
   if v_charge is null then return jsonb_build_object('ok',false,'message','Outlet is not assigned to this driver'); end if;
   insert into public.delivery_records(order_id,outlet_id,driver_id,driver,status,delivery_charge,delivery_state,last_action_at) values(p_order_id,p_outlet_id,v_driver_id,v_driver_name,'pending',v_charge,'READY_FOR_DELIVERY',v_now) on conflict(order_id,outlet_id) do update set driver_id=excluded.driver_id,driver=excluded.driver,updated_at=v_now;
   select * into v_rec from public.delivery_records where order_id=p_order_id and outlet_id=p_outlet_id for update;
 end if;
 v_from:=coalesce(v_rec.delivery_state,'READY_FOR_DELIVERY');
 if p_action='invoice_number_only' then
   if coalesce(p_invoice_number,'') !~ '^[0-9]+$' then return jsonb_build_object('ok',false,'message','Invoice number must be numeric'); end if;
   update public.delivery_records set invoice_number=p_invoice_number,delivery_state=case when delivery_state='DELIVERED' then delivery_state else 'INVOICE_NUMBER_CAPTURED' end,state_version=state_version+1,last_action_at=v_now,last_error_code=null,last_error_message=null,updated_at=v_now where id=v_rec.id returning * into v_rec;v_to:=v_rec.delivery_state;
 elsif p_action='invoice_uploaded' then
   if coalesce(p_invoice_number,'') !~ '^[0-9]+$' then return jsonb_build_object('ok',false,'message','Invoice number is required'); end if;
   if coalesce(p_invoice_path,'')='' then return jsonb_build_object('ok',false,'message','Invoice file is required'); end if;
   update public.delivery_records set invoice_number=p_invoice_number,invoice_path=p_invoice_path,invoice_filename=coalesce(p_invoice_filename,invoice_filename),invoice_mime_type=coalesce(p_invoice_mime_type,invoice_mime_type),invoice_uploaded_at=coalesce(invoice_uploaded_at,v_now),ocr_status=coalesce(p_ocr_status,ocr_status),ocr_result=coalesce(p_ocr_result,ocr_result),status='delivered',delivered_at=coalesce(delivered_at,v_now),delivery_state='DELIVERED',state_version=state_version+1,last_action_at=v_now,last_error_code=null,last_error_message=null,updated_at=v_now where id=v_rec.id returning * into v_rec;v_to:=v_rec.delivery_state;
 elsif p_action='mark_delivered' then
   if coalesce(v_rec.invoice_number,'') !~ '^[0-9]+$' then return jsonb_build_object('ok',false,'message','Enter the invoice number before marking delivered'); end if;
   if v_rec.invoice_path is null then return jsonb_build_object('ok',false,'message','Upload invoice image before marking delivered'); end if;
   update public.delivery_records set status='delivered',delivered_at=coalesce(delivered_at,v_now),delivery_state='DELIVERED',state_version=state_version+1,last_action_at=v_now,last_error_code=null,last_error_message=null,updated_at=v_now where id=v_rec.id returning * into v_rec;v_to:=v_rec.delivery_state;
 else return jsonb_build_object('ok',false,'message','Unsupported delivery action'); end if;
 insert into public.delivery_events(delivery_record_id,order_id,outlet_id,driver_id,event_type,from_state,to_state,idempotency_key,actor_type,actor_id,metadata,created_at) values(v_rec.id,p_order_id,p_outlet_id,v_driver_id,upper(p_action),v_from,v_to,p_idempotency_key,'driver',v_driver_id,jsonb_build_object('invoice_number',p_invoice_number),v_now) on conflict(idempotency_key) do nothing;
 if v_to='DELIVERED' then insert into public.driver_ledger_entries(driver_id,delivery_record_id,entry_type,amount,reference_key,metadata,created_at) values(v_driver_id,v_rec.id,'DELIVERY_EARNING',coalesce(v_rec.delivery_charge,0),'delivery:'||v_rec.id::text,jsonb_build_object('order_id',p_order_id,'outlet_id',p_outlet_id),v_now) on conflict(reference_key) do nothing returning id into v_ledger_id; end if;
 return jsonb_build_object('ok',true,'delivery_id',v_rec.id,'delivery_state',v_rec.delivery_state,'delivered_at',v_rec.delivered_at,'idempotent',false,'ledger_created',v_ledger_id is not null);
exception when unique_violation then
 select id into v_event_id from public.delivery_events where idempotency_key=p_idempotency_key limit 1;select * into v_rec from public.delivery_records where order_id=p_order_id and outlet_id=p_outlet_id limit 1;return jsonb_build_object('ok',true,'idempotent',true,'delivery_id',v_rec.id,'delivery_state',v_rec.delivery_state);
end $$;
revoke all on function public.delivery_transition_v2(text,uuid,uuid,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.delivery_transition_v2(text,uuid,uuid,text,text,text,text,text,text,text,jsonb) to service_role;