-- Inventory security and counting hardening v1
-- Adds lockout/session revocation hardening, immutable audit records,
-- packet arithmetic invariants, and a staff session revoke RPC.

alter table public.inv_staff_users
  drop constraint if exists inv_staff_users_failed_attempts_chk;
alter table public.inv_staff_users
  add constraint inv_staff_users_failed_attempts_chk
  check (failed_attempts between 0 and 5);

alter table public.inv_staff_sessions enable row level security;
alter table public.inv_staff_users enable row level security;
revoke all on public.inv_staff_sessions, public.inv_staff_users from anon, authenticated, public;

create index if not exists inv_staff_sessions_token_hash_idx
  on public.inv_staff_sessions(token_hash);
create index if not exists inv_staff_sessions_staff_expires_idx
  on public.inv_staff_sessions(staff_id, expires_at desc);

create or replace function public.inv_staff_revoke_session(p_staff_token text)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare th text;
begin
  if coalesce(trim(p_staff_token),'')='' then return false; end if;
  th:=encode(extensions.digest(p_staff_token,'sha256'),'hex');
  update public.inv_staff_sessions set expires_at=least(expires_at,now())
  where token_hash=th;
  return found;
end $$;
revoke all on function public.inv_staff_revoke_session(text) from public, anon, authenticated;
grant execute on function public.inv_staff_revoke_session(text) to anon, authenticated;

create or replace function public.inv_staff_login(p_name text,p_pin text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u public.inv_staff_users; raw text; th text;
begin
  select * into u from public.inv_staff_users
  where lower(name)=lower(trim(p_name)) and active=true limit 1;
  if u.id is null then raise exception 'Invalid staff login'; end if;
  if u.locked_until is not null and u.locked_until>now() then
    raise exception 'Account temporarily locked';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' or not extensions.crypt(p_pin,u.pin_hash)=u.pin_hash then
    update public.inv_staff_users
      set failed_attempts=least(failed_attempts+1,5),
          locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end,
          updated_at=now()
      where id=u.id;
    raise exception 'Invalid staff login';
  end if;
  update public.inv_staff_users set failed_attempts=0,locked_until=null,updated_at=now() where id=u.id;
  raw=encode(extensions.gen_random_bytes(32),'hex');
  th=encode(extensions.digest(raw,'sha256'),'hex');
  insert into public.inv_staff_sessions(token_hash,staff_id,expires_at)
    values(th,u.id,now()+interval '12 hours');
  return jsonb_build_object('token',raw,'staff_id',u.id,'staff_name',u.name,'expires_at',now()+interval '12 hours');
end $$;
revoke all on function public.inv_staff_login(text,text) from public;
grant execute on function public.inv_staff_login(text,text) to anon,authenticated;

-- Packet arithmetic fields are optional for legacy/unit counts.
alter table public.inv_stock_counts
  add column if not exists sealed_qty numeric,
  add column if not exists open_qty numeric,
  add column if not exists pack_size_used numeric,
  add column if not exists total_base_qty numeric;

alter table public.inv_stock_counts
  drop constraint if exists inv_stock_counts_packet_math_chk;
alter table public.inv_stock_counts
  add constraint inv_stock_counts_packet_math_chk
  check (
    sealed_qty is null or open_qty is null or pack_size_used is null or total_base_qty is null
    or (
      sealed_qty >= 0 and open_qty >= 0 and pack_size_used > 0
      and total_base_qty = sealed_qty * pack_size_used + open_qty
    )
  );

-- Audit records must be append-only. The application RPCs retain INSERT capability
-- through SECURITY DEFINER, while direct UPDATE/DELETE/TRUNCATE attempts fail.
create or replace function public.inv_v2_audit_immutable()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  raise exception 'Inventory audit log is append-only';
end $$;

drop trigger if exists inv_v2_audit_immutable_trg on public.inv_v2_audit_log;
create trigger inv_v2_audit_immutable_trg
before update or delete on public.inv_v2_audit_log
for each row execute function public.inv_v2_audit_immutable();

revoke update, delete, truncate on public.inv_v2_audit_log from public, anon, authenticated;
revoke all on public.inv_v2_audit_log from public, anon, authenticated;

-- Revoke direct table access remains explicit defense-in-depth.
revoke all on public.inv_stock_counts from public, anon, authenticated;
