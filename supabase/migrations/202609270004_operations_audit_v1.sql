-- Operations audit trail for mutable operational records.
create table if not exists public.operations_audit_v1(
 id bigint generated always as identity primary key,
 table_name text not null,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')),
 record_id text,
 actor text not null default 'system',
 old_data jsonb,
 new_data jsonb,
 created_at timestamptz not null default now()
);
alter table public.operations_audit_v1 enable row level security;
revoke all on public.operations_audit_v1 from public,anon,authenticated;
create or replace function public.operations_audit_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text:=coalesce(nullif(current_setting('app.actor',true),''),'system');
begin
 insert into public.operations_audit_v1(table_name,operation,record_id,actor,old_data,new_data)
 values(TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,TG_OP,case when TG_OP='DELETE' then to_jsonb(OLD)->>'id' else to_jsonb(NEW)->>'id' end,actor_name,case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end);
 return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
revoke all on function public.operations_audit_capture() from public,anon,authenticated;
drop trigger if exists operations_audit_outlets on public.outlets;
create trigger operations_audit_outlets after insert or update or delete on public.outlets for each row execute function public.operations_audit_capture();
drop trigger if exists operations_audit_order_items on public.order_items;
create trigger operations_audit_order_items after insert or update or delete on public.order_items for each row execute function public.operations_audit_capture();
drop trigger if exists operations_audit_driver_payments on public.driver_payments;
create trigger operations_audit_driver_payments after insert or update or delete on public.driver_payments for each row execute function public.operations_audit_capture();
create index if not exists operations_audit_v1_created_idx on public.operations_audit_v1(created_at desc);
create index if not exists operations_audit_v1_table_record_idx on public.operations_audit_v1(table_name,record_id,created_at desc);