alter table public.inv_staff_users add column if not exists login_name text;
update public.inv_staff_users set login_name=lower(trim(name)) where coalesce(trim(login_name),'')='';
alter table public.inv_staff_users alter column login_name set not null;
create unique index if not exists inv_staff_users_login_name_uq on public.inv_staff_users (lower(trim(login_name)));

create or replace function public.inv_staff_login(p_name text,p_pin text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare u public.inv_staff_users; raw text; th text; v_login text;
begin
 v_login=lower(trim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g')));
 if v_login='' then raise exception 'Wrong User ID'; end if;
 select * into u from public.inv_staff_users where lower(trim(login_name))=v_login limit 1;
 if u.id is null then raise exception 'Wrong User ID'; end if;
 if not coalesce(u.active,false) then raise exception 'Account is inactive. Contact admin.'; end if;
 if u.locked_until is not null and u.locked_until>now() then raise exception 'Account locked. Try again after 15 minutes or contact admin.'; end if;
 if p_pin !~ '^[0-9]{4,6}$' or not extensions.crypt(p_pin,u.pin_hash)=u.pin_hash then
   update public.inv_staff_users set failed_attempts=least(failed_attempts+1,5),locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end,updated_at=now() where id=u.id;
   raise exception 'Wrong Password';
 end if;
 update public.inv_staff_users set failed_attempts=0,locked_until=null,updated_at=now() where id=u.id;
 raw=encode(extensions.gen_random_bytes(32),'hex'); th=encode(extensions.digest(raw,'sha256'),'hex');
 insert into public.inv_staff_sessions(token_hash,staff_id,expires_at) values(th,u.id,now()+interval '12 hours');
 return jsonb_build_object('token',raw,'staff_id',u.id,'staff_name',u.name,'expires_at',now()+interval '12 hours');
end $function$;

create or replace function public.inv_admin_save_team_member(p_admin_token text,p_member_type text,p_member_id uuid,p_name text,p_login_name text,p_pin text,p_payment_password text)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_id uuid; v_name text; v_login text;
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 if p_member_type not in ('warehouse_staff','driver') then raise exception 'Invalid member type'; end if;
 v_name=trim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
 if v_name='' then raise exception 'Name is required'; end if;
 if p_pin is not null and p_pin<>'' and p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4–6 digits'; end if;
 if p_member_type='warehouse_staff' then
   v_login=lower(trim(regexp_replace(coalesce(p_login_name,''),'[[:space:]]+',' ','g')));
   if v_login='' then raise exception 'Staff ID is required'; end if;
   if p_member_id is null and coalesce(p_pin,'')='' then raise exception 'PIN is required for a new staff member'; end if;
   if p_member_id is null then
     insert into public.inv_staff_users(name,login_name,pin_hash) values(v_name,v_login,extensions.crypt(p_pin,extensions.gen_salt('bf'))) returning id into v_id;
   else
     update public.inv_staff_users set name=v_name,login_name=v_login,updated_at=now(),pin_hash=case when coalesce(p_pin,'')='' then pin_hash else extensions.crypt(p_pin,extensions.gen_salt('bf')) end,failed_attempts=0,locked_until=null where id=p_member_id returning id into v_id;
     if v_id is null then raise exception 'Staff member not found'; end if;
     delete from public.inv_staff_sessions where staff_id=v_id;
   end if;
 else
   v_login=lower(trim(coalesce(p_login_name,'')));
   if v_login='' then raise exception 'Login name is required for a driver'; end if;
   if p_member_id is null and coalesce(p_pin,'')='' then raise exception 'PIN is required for a new driver'; end if;
   if p_member_id is null then
     insert into public.driver_accounts(driver_name,login_name,pin_hash,active,payment_password_hash) values(v_name,v_login,extensions.crypt(p_pin,extensions.gen_salt('bf')),true,case when coalesce(p_payment_password,'')<>'' then extensions.crypt(p_payment_password,extensions.gen_salt('bf')) else null end) returning id into v_id;
     insert into public.drivers(name,active) values(v_name,true) on conflict do nothing;
   else
     update public.driver_accounts set driver_name=v_name,login_name=v_login,pin_hash=case when coalesce(p_pin,'')='' then pin_hash else extensions.crypt(p_pin,extensions.gen_salt('bf')) end,payment_password_hash=case when coalesce(p_payment_password,'')='' then payment_password_hash else extensions.crypt(p_payment_password,extensions.gen_salt('bf')) end where id=p_member_id returning id into v_id;
     if v_id is null then raise exception 'Driver not found'; end if;
     update public.drivers set name=v_name,active=true where lower(trim(name))=lower(trim((select driver_name from public.driver_accounts where id=p_member_id)));
     insert into public.drivers(name,active) values(v_name,true) on conflict do nothing;
   end if;
 end if;
 insert into public.team_credential_audit(member_type,member_id,action,details) values(p_member_type,v_id,case when p_member_id is null then 'created' else 'updated' end,jsonb_build_object('name',v_name,'login_name',nullif(v_login,''),'pin_changed',coalesce(p_pin,'')<>'','payment_password_changed',coalesce(p_payment_password,'')<>''));
 return v_id;
exception when unique_violation then raise exception 'That name or login name is already in use';
end $function$;

create or replace function public.inv_admin_get_team(p_admin_token text)
returns table(member_type text,member_id uuid,name text,login_name text,active boolean,has_payment_password boolean,created_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
begin
 if not public.inv_require_admin(p_admin_token) then raise exception 'Unauthorized'; end if;
 return query
 select 'warehouse_staff'::text,u.id,u.name,u.login_name,u.active,false,u.created_at from public.inv_staff_users u
 union all
 select 'driver'::text,d.id,d.driver_name,d.login_name,d.active,(d.payment_password_hash is not null and d.payment_password_hash<>''),d.created_at from public.driver_accounts d
 order by 1,3;
end
$function$;