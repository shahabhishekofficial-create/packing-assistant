create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from anon, authenticated;

create or replace function public.create_admin_session(p_password text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_token text; v_hash text;
begin
  if not public.verify_admin_password(p_password) then return null; end if;
  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  delete from public.admin_sessions where expires_at < now();
  insert into public.admin_sessions(token_hash, expires_at) values(v_hash, now() + interval '1 hour');
  return v_token;
end;
$$;

create or replace function public.verify_admin_session(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_hash text; v_ok boolean;
begin
  if coalesce(length(trim(p_session_token)),0) < 20 then return false; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');
  select exists(select 1 from public.admin_sessions where token_hash=v_hash and expires_at > now()) into v_ok;
  if v_ok then update public.admin_sessions set last_seen_at=now(), expires_at=now()+interval '1 hour' where token_hash=v_hash; end if;
  return v_ok;
end;
$$;

create or replace function public.revoke_admin_session(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_hash text;
begin
  if coalesce(length(trim(p_session_token)),0) < 20 then return false; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');
  delete from public.admin_sessions where token_hash=v_hash;
  return true;
end;
$$;

create or replace function public.admin_driver_payment_ledger_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public.verify_admin_session(p_session_token) then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('driver_id',d.id,'driver_name',d.driver_name,'earned',coalesce(e.earned,0),'paid',coalesce(p.paid,0),'balance',greatest(coalesce(e.earned,0)-coalesce(p.paid,0),0),'overpaid',greatest(coalesce(p.paid,0)-coalesce(e.earned,0),0),'payments',coalesce(p.rows,'[]'::jsonb)) order by d.driver_name),'[]'::jsonb) into v_rows
  from public.driver_accounts d
  left join (select driver_id,sum(delivery_charge)::numeric(12,2) earned from public.delivery_records where status='delivered' group by driver_id) e on e.driver_id=d.id
  left join (select driver_id,sum(amount)::numeric(12,2) paid,jsonb_agg(jsonb_build_object('id',id,'amount',amount,'paid_at',paid_at,'note',coalesce(note,''),'screenshot_path',screenshot_path,'confirmed_at',confirmed_at) order by paid_at desc) rows from public.driver_payments group by driver_id) p on p.driver_id=d.id
  where d.active=true;
  return jsonb_build_object('ok',true,'drivers',v_rows);
end;
$$;

create or replace function public.admin_record_driver_payment_session(
 p_session_token text,p_driver_id uuid,p_amount numeric,p_paid_at timestamptz,p_note text,p_screenshot_path text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public.verify_admin_session(p_session_token) then return jsonb_build_object('ok',false,'message','Admin session expired'); end if;
  if p_amount<=0 then return jsonb_build_object('ok',false,'message','Payment amount must be positive'); end if;
  insert into public.driver_payments(driver_id,amount,paid_at,note,screenshot_path)
  values(p_driver_id,p_amount,coalesce(p_paid_at,now()),coalesce(p_note,''),p_screenshot_path)
  returning id into v_id;
  return jsonb_build_object('ok',true,'payment_id',v_id);
end;
$$;

grant execute on function public.create_admin_session(text) to anon, authenticated;
grant execute on function public.verify_admin_session(text) to anon, authenticated;
grant execute on function public.revoke_admin_session(text) to anon, authenticated;
grant execute on function public.admin_driver_payment_ledger_session(text) to anon, authenticated;
grant execute on function public.admin_record_driver_payment_session(text,uuid,numeric,timestamptz,text,text) to anon, authenticated;