-- Inventory staff administration: read status + revoke active sessions.
-- Does not change existing staff login semantics.
create or replace function public.inv_admin_get_inventory_staff(p_admin_token text)
returns table(
  staff_id uuid,
  name text,
  active boolean,
  failed_attempts integer,
  locked_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.inv_require_admin(p_admin_token) then
    raise exception 'Unauthorized';
  end if;

  return query
  select u.id,u.name,u.active,u.failed_attempts,u.locked_until,u.created_at,u.updated_at
  from public.inv_staff_users u
  order by u.active desc, u.name asc;
end
$function$;

create or replace function public.inv_admin_revoke_staff_sessions(
  p_admin_token text,
  p_staff_id uuid
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_count integer;
begin
  if not public.inv_require_admin(p_admin_token) then
    raise exception 'Unauthorized';
  end if;

  delete from public.inv_staff_sessions
  where staff_id=p_staff_id;
  get diagnostics v_count=row_count;

  insert into public.team_credential_audit(member_type,member_id,action,details)
  values('warehouse_staff',p_staff_id,'sessions_revoked',
         jsonb_build_object('session_count',v_count));

  return v_count;
end
$function$;

revoke all on function public.inv_admin_get_inventory_staff(text) from public;
grant execute on function public.inv_admin_get_inventory_staff(text) to anon, authenticated;
revoke all on function public.inv_admin_revoke_staff_sessions(text,uuid) from public;
grant execute on function public.inv_admin_revoke_staff_sessions(text,uuid) to anon, authenticated;
