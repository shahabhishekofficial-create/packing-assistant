create or replace function public.inv_admin_save_team_member(
 p_admin_token text,p_member_type text,p_member_id uuid,p_name text,p_login_name text,p_pin text,p_payment_password text
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare v_id uuid; v_name text; v_login text;
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 if p_member_type not in ('warehouse_staff','driver') then raise exception 'Invalid member type'; end if;
 v_name=trim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
 if v_name='' then raise exception 'Name is required'; end if;
 if p_pin is not null and p_pin<>'' and p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4–6 digits'; end if;
 if p_member_type='warehouse_staff' then
   if p_member_id is null and coalesce(p_pin,'')='' then raise exception 'PIN is required for a new staff member'; end if;
   if p_member_id is null then
     insert into public.inv_staff_users(name,pin_hash) values(v_name,extensions.crypt(p_pin,extensions.gen_salt('bf'))) returning id into v_id;
   else
     update public.inv_staff_users set name=v_name,updated_at=now(),
       pin_hash=case when coalesce(p_pin,'')='' then pin_hash else extensions.crypt(p_pin,extensions.gen_salt('bf')) end,
       failed_attempts=0,locked_until=null where id=p_member_id returning id into v_id;
     if v_id is null then raise exception 'Staff member not found'; end if;
     delete from public.inv_staff_sessions where staff_id=v_id;
   end if;
 else
   v_login=lower(trim(coalesce(p_login_name,'')));
   if v_login='' then raise exception 'Login name is required for a driver'; end if;
   if p_member_id is null and coalesce(p_pin,'')='' then raise exception 'PIN is required for a new driver'; end if;
   if p_member_id is null then
     insert into public.driver_accounts(driver_name,login_name,pin_hash,active,payment_password_hash)
     values(v_name,v_login,extensions.crypt(p_pin,extensions.gen_salt('bf')),true,
       case when coalesce(p_payment_password,'')<>'' then extensions.crypt(p_payment_password,extensions.gen_salt('bf')) else null end) returning id into v_id;
     insert into public.drivers(name,active) values(v_name,true) on conflict do nothing;
   else
     update public.driver_accounts set driver_name=v_name,login_name=v_login,
       pin_hash=case when coalesce(p_pin,'')='' then pin_hash else extensions.crypt(p_pin,extensions.gen_salt('bf')) end,
       payment_password_hash=case when coalesce(p_payment_password,'')='' then payment_password_hash else extensions.crypt(p_payment_password,extensions.gen_salt('bf')) end
       where id=p_member_id returning id into v_id;
     if v_id is null then raise exception 'Driver not found'; end if;
     update public.drivers set name=v_name,active=true where lower(trim(name))=lower(trim((select driver_name from public.driver_accounts where id=p_member_id)));
     insert into public.drivers(name,active) values(v_name,true) on conflict do nothing;
   end if;
 end if;
 insert into public.team_credential_audit(member_type,member_id,action,details)
 values(p_member_type,v_id,case when p_member_id is null then 'created' else 'updated' end,
   jsonb_build_object('name',v_name,'login_name',nullif(v_login,''),'pin_changed',coalesce(p_pin,'')<>'','payment_password_changed',coalesce(p_payment_password,'')<>''));
 return v_id;
exception when unique_violation then raise exception 'That name or login name is already in use';
end $function$;

create or replace function public.inv_admin_set_team_active(
 p_admin_token text,p_member_type text,p_member_id uuid,p_active boolean
) returns boolean
language plpgsql security definer set search_path=''
as $function$
declare v_name text;
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 if p_member_type='warehouse_staff' then
   update public.inv_staff_users set active=p_active,updated_at=now(),failed_attempts=0,locked_until=null where id=p_member_id;
   if not found then raise exception 'Team member not found'; end if;
   if not p_active then delete from public.inv_staff_sessions where staff_id=p_member_id; end if;
 elsif p_member_type='driver' then
   select driver_name into v_name from public.driver_accounts where id=p_member_id;
   if v_name is null then raise exception 'Team member not found'; end if;
   update public.driver_accounts set active=p_active where id=p_member_id;
   update public.drivers set active=p_active where lower(trim(name))=lower(trim(v_name));
 else raise exception 'Invalid member type'; end if;
 insert into public.team_credential_audit(member_type,member_id,action,details)
 values(p_member_type,p_member_id,case when p_active then 'activated' else 'deactivated' end,'{}'::jsonb);
 return p_active;
end $function$;