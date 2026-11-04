-- Vegetable Inward v1 — API helpers.
--
-- The edge function runs as service_role and cannot read the inventory staff
-- tables or the item table directly (those grants were hardened and are left
-- alone). These two new functions reuse the existing session model inside the
-- database instead of widening access on any existing object.

-- Who is calling: the admin session, or a staff session the same way
-- inv_staff_* RPCs already check it (sha256 token hash, expiry, active user).
create or replace function public.veg_inward_whoami(p_admin_token text, p_staff_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hash text;
  v_staff uuid;
  v_name text;
begin
  if coalesce(length(btrim(p_admin_token)), 0) >= 20 then
    if public.verify_admin_session(p_admin_token) then
      return jsonb_build_object('role', 'admin', 'actor', 'Admin');
    end if;
  end if;

  if coalesce(length(btrim(p_staff_token)), 0) > 0 then
    v_hash := encode(extensions.digest(p_staff_token, 'sha256'), 'hex');
    select s.staff_id, u.name into v_staff, v_name
    from public.inv_staff_sessions s
    join public.inv_staff_users u on u.id = s.staff_id
    where s.token_hash = v_hash
      and s.expires_at > now()
      and u.active = true
    limit 1;
    if v_staff is not null then
      update public.inv_staff_sessions set last_seen_at = now() where token_hash = v_hash;
      return jsonb_build_object('role', 'staff', 'actor', coalesce(nullif(btrim(v_name), ''), 'Staff'));
    end if;
  end if;

  return jsonb_build_object('role', null, 'actor', null);
end;
$function$;

-- The live vegetable item list, read-only, for the inward screens.
create or replace function public.veg_inward_items()
returns table (item_id uuid, name_en text, name_hi text, name_gu text)
language sql
stable
security definer
set search_path = ''
as $function$
  select i.item_id, i.name_en, i.name_hi, i.name_gu
  from public.inv_vegetable_items i
  where i.is_active
  order by i.name_en;
$function$;

revoke all on function public.veg_inward_whoami(text, text) from public;
revoke all on function public.veg_inward_whoami(text, text) from anon;
revoke all on function public.veg_inward_whoami(text, text) from authenticated;
grant execute on function public.veg_inward_whoami(text, text) to service_role;

revoke all on function public.veg_inward_items() from public;
revoke all on function public.veg_inward_items() from anon;
revoke all on function public.veg_inward_items() from authenticated;
grant execute on function public.veg_inward_items() to service_role;
