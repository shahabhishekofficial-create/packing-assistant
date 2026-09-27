-- Admin Operations Command Center audit read contract
-- The underlying operations_audit_v1 table remains append-only and directly inaccessible to browser roles.
create or replace function public.admin_get_operations_audit_v1(
  p_admin_session text,
  p_limit integer default 20
)
returns table(
  id bigint,
  table_name text,
  operation text,
  record_id text,
  actor text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_admin_session(p_admin_session) then
    raise exception 'Admin session expired';
  end if;

  return query
  select a.id,a.table_name,a.operation,a.record_id,a.actor,a.old_data,a.new_data,a.created_at
  from public.operations_audit_v1 a
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit,20),100));
end;
$$;

revoke all on function public.admin_get_operations_audit_v1(text, integer) from public;
revoke all on function public.admin_get_operations_audit_v1(text, integer) from anon, authenticated;
grant execute on function public.admin_get_operations_audit_v1(text, integer) to anon, authenticated;
