create extension if not exists pgcrypto;

create table if not exists public.admin_settings (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;

create or replace function public.verify_admin_password(p_password text)
returns boolean
language sql
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.admin_settings
    where id=true and password_hash=crypt(p_password,password_hash)
  );
$$;

create or replace function public.change_admin_password(p_current_password text,p_new_password text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if length(coalesce(p_new_password,'')) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;
  if not exists(
    select 1 from public.admin_settings
    where id=true and password_hash=crypt(p_current_password,password_hash)
  ) then
    raise exception 'Current password is incorrect';
  end if;
  update public.admin_settings
  set password_hash=crypt(p_new_password,gen_salt('bf',12)),updated_at=now()
  where id=true;
  return true;
end;
$$;

revoke all on table public.admin_settings from anon, authenticated;
grant execute on function public.verify_admin_password(text) to anon, authenticated;
grant execute on function public.change_admin_password(text,text) to anon, authenticated;

-- Replace INITIAL_ADMIN_PASSWORD with your current Admin password once, then run:
insert into public.admin_settings(id,password_hash)
values(true,crypt('INITIAL_ADMIN_PASSWORD',gen_salt('bf',12)))
on conflict(id) do nothing;