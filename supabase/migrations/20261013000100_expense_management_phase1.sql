-- Expense Management Phase 1 migration (review only; NOT applied).
-- New expense_* objects only; no existing tables/RPCs/functions modified.
begin;
create table public.expense_employees(id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name))>0),is_default boolean not null default false,active boolean not null default true,created_at timestamptz not null default now());
create unique index expense_employees_one_default_idx on public.expense_employees(is_default) where is_default;
create table public.expense_categories(id uuid primary key default gen_random_uuid(),name text not null unique check(length(btrim(name))>0),active boolean not null default true,sort_order integer not null default 0,created_at timestamptz not null default now());
create table public.expense_claims(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.expense_employees(id) on delete restrict,claim_number bigint generated always as identity unique,from_date date not null,to_date date not null,created_at timestamptz not null default now(),reopened_at timestamptz,check(to_date>=from_date));
create table public.expenses(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.expense_employees(id) on delete restrict,expense_date date not null default ((now() at time zone 'Asia/Kolkata')::date),amount numeric(14,2) not null check(amount>0),category_id uuid not null references public.expense_categories(id) on delete restrict,reason text not null check(length(btrim(reason))>0),notes text,claim_id uuid references public.expense_claims(id) on delete restrict,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index expenses_employee_date_idx on public.expenses(employee_id,expense_date desc) where deleted_at is null;
create index expenses_claim_idx on public.expenses(claim_id) where claim_id is not null;
create index expenses_category_idx on public.expenses(category_id) where deleted_at is null;
create table public.expense_payments(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.expense_employees(id) on delete restrict,claim_id uuid references public.expense_claims(id) on delete restrict,payment_date date not null default ((now() at time zone 'Asia/Kolkata')::date),amount numeric(14,2) not null check(amount>0),mode text not null check(mode in ('Bank','Cash','UPI','Other')),reference_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index expense_payments_employee_date_idx on public.expense_payments(employee_id,payment_date desc);
create index expense_payments_claim_idx on public.expense_payments(claim_id) where claim_id is not null;
insert into public.expense_employees(name,is_default) values('Me',true);
insert into public.expense_categories(name,sort_order) values('LR',1),('Q Com Transport',2),('Local Purchase',3),('Packaging Material',4),('HORECA Transport',5),('Other Transport',6),('Other',7);

create or replace function public.expense_guard_expense_claim() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.expense_claims%rowtype;
begin
 if tg_op='DELETE' then raise exception 'Hard deletion of expenses is prohibited; use soft delete'; end if;
 if old.claim_id is not null and (new.employee_id is distinct from old.employee_id or new.expense_date is distinct from old.expense_date or new.amount is distinct from old.amount or new.category_id is distinct from old.category_id or new.reason is distinct from old.reason or new.notes is distinct from old.notes or new.deleted_at is distinct from old.deleted_at or new.claim_id is distinct from old.claim_id) then
   if exists(select 1 from public.expense_claims x where x.id=old.claim_id and x.reopened_at is null) then raise exception 'Claimed expense is locked; reopen its claim first'; end if;
 end if;
 if new.claim_id is not null then
   select * into c from public.expense_claims where id=new.claim_id for update;
   if not found then raise exception 'Claim not found'; end if;
   if c.reopened_at is not null then raise exception 'Cannot attach expenses to a reopened claim'; end if;
   if c.employee_id<>new.employee_id then raise exception 'Expense and claim employee must match'; end if;
   if new.expense_date<c.from_date or new.expense_date>c.to_date then raise exception 'Expense date is outside claim range'; end if;
   if new.deleted_at is not null then raise exception 'Deleted expenses cannot be claimed'; end if;
   if tg_op='UPDATE' and old.claim_id is not null and old.claim_id<>new.claim_id then raise exception 'Remove an expense only by reopening its claim'; end if;
 end if;
 new.updated_at:=now(); return new;
end $$;
create trigger expense_guard_expense_claim_trg before insert or update or delete on public.expenses for each row execute function public.expense_guard_expense_claim();

create or replace function public.expense_guard_payment_claim() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.expense_claims%rowtype;
begin
 if new.claim_id is not null then
  select * into c from public.expense_claims where id=new.claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if c.employee_id<>new.employee_id then raise exception 'Payment and claim employee must match'; end if;
  if c.reopened_at is not null then raise exception 'Cannot link payment to a reopened claim'; end if;
 end if;
 new.updated_at:=now(); return new;
end $$;
create trigger expense_guard_payment_claim_trg before insert or update on public.expense_payments for each row execute function public.expense_guard_payment_claim();

create or replace function public.expense_guard_claim_reopen() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.reopened_at is not null and new.reopened_at is distinct from old.reopened_at then raise exception 'A reopened claim cannot be reclosed or reopened again'; end if;
 if old.reopened_at is null and new.reopened_at is not null and exists(select 1 from public.expense_payments p where p.claim_id=old.id) then raise exception 'Unlink or remove payments before reopening this claim'; end if;
 if new.employee_id is distinct from old.employee_id or new.from_date is distinct from old.from_date or new.to_date is distinct from old.to_date or new.claim_number is distinct from old.claim_number then raise exception 'Claim identity and date range cannot be edited'; end if;
 return new;
end $$;
create trigger expense_guard_claim_reopen_trg before update on public.expense_claims for each row execute function public.expense_guard_claim_reopen();

-- AFTER trigger: claim row is already marked reopened in this transaction, so the
-- expense guard sees reopened_at and allows claim_id to be cleared. Any error rolls back both.
create or replace function public.expense_release_reopened_claim() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.reopened_at is null and new.reopened_at is not null then update public.expenses set claim_id=null,updated_at=now() where claim_id=new.id; end if;
 return new;
end $$;
create trigger expense_release_reopened_claim_trg after update of reopened_at on public.expense_claims for each row execute function public.expense_release_reopened_claim();

-- Callable only by service_role; API must validate the Admin session before calling.
create or replace function public.expense_create_claim(p_employee_id uuid,p_from_date date,p_to_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare v_claim uuid; v_count integer;
begin
 if p_from_date is null or p_to_date is null or p_to_date<p_from_date then raise exception 'Invalid claim date range'; end if;
 if not exists(select 1 from public.expense_employees where id=p_employee_id and active) then raise exception 'Employee not found or inactive'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text,0));
 perform 1 from public.expenses e where e.employee_id=p_employee_id and e.deleted_at is null and e.claim_id is null and e.expense_date between p_from_date and p_to_date order by e.id for update;
 select count(*) into v_count from public.expenses e where e.employee_id=p_employee_id and e.deleted_at is null and e.claim_id is null and e.expense_date between p_from_date and p_to_date;
 if v_count=0 then raise exception 'Cannot create a claim with no eligible expenses'; end if;
 insert into public.expense_claims(employee_id,from_date,to_date) values(p_employee_id,p_from_date,p_to_date) returning id into v_claim;
 update public.expenses set claim_id=v_claim,updated_at=now() where employee_id=p_employee_id and deleted_at is null and claim_id is null and expense_date between p_from_date and p_to_date;
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'No eligible expenses remained to claim'; end if;
 return v_claim;
end $$;

create or replace function public.expense_reopen_claim(p_claim_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.expense_claims where id=p_claim_id for update;
 if not found then raise exception 'Claim not found'; end if;
 if exists(select 1 from public.expense_payments where claim_id=p_claim_id) then raise exception 'Unlink or remove payments before reopening this claim'; end if;
 if exists(select 1 from public.expense_claims where id=p_claim_id and reopened_at is not null) then raise exception 'Claim is already reopened'; end if;
 update public.expense_claims set reopened_at=now() where id=p_claim_id;
end $$;

-- Shared balance source: one employee summary row (claim_id NULL) and one row
-- per claim. Dashboard/Excel use summary rows; claims page uses claim-specific rows.
create or replace view public.expense_balance_summary as
with et as (select employee_id,sum(amount)::numeric(14,2) total_expenses from public.expenses where deleted_at is null group by employee_id),
pt as (select employee_id,sum(amount)::numeric(14,2) total_payments,coalesce(sum(amount) filter(where claim_id is null),0)::numeric(14,2) unallocated_payments from public.expense_payments group by employee_id),
ce as (select c.id claim_id,c.employee_id,c.claim_number,c.from_date,c.to_date,c.reopened_at,coalesce(sum(e.amount) filter(where e.deleted_at is null),0)::numeric(14,2) claim_expenses from public.expense_claims c left join public.expenses e on e.claim_id=c.id group by c.id),
cp as (select claim_id,sum(amount)::numeric(14,2) claim_payments from public.expense_payments where claim_id is not null group by claim_id),
tot as (select e.id employee_id,(coalesce(et.total_expenses,0)-coalesce(pt.total_payments,0))::numeric(14,2) total_due,coalesce(pt.unallocated_payments,0)::numeric(14,2) unallocated_payments from public.expense_employees e left join et on et.employee_id=e.id left join pt on pt.employee_id=e.id)
select t.employee_id,null::uuid claim_id,null::bigint claim_number,null::date from_date,null::date to_date,null::timestamptz reopened_at,t.total_due,null::numeric(14,2) claim_due,t.unallocated_payments from tot t
union all
select c.employee_id,c.claim_id,c.claim_number,c.from_date,c.to_date,c.reopened_at,t.total_due,(c.claim_expenses-coalesce(cp.claim_payments,0))::numeric(14,2) claim_due,t.unallocated_payments from ce c join tot t on t.employee_id=c.employee_id left join cp on cp.claim_id=c.claim_id;

alter table public.expense_employees enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
revoke all on public.expense_employees,public.expense_categories,public.expense_claims,public.expenses,public.expense_payments from public,anon,authenticated;
revoke all on public.expense_balance_summary from public,anon,authenticated;
grant select,insert,update on public.expense_employees to service_role;
grant select,insert,update on public.expense_categories to service_role;
grant select,insert,update on public.expense_claims to service_role;
grant select,insert,update on public.expenses to service_role;
grant select,insert,update,delete on public.expense_payments to service_role;
grant select on public.expense_balance_summary to service_role;
revoke all on function public.expense_guard_expense_claim() from public,anon,authenticated;
revoke all on function public.expense_guard_payment_claim() from public,anon,authenticated;
revoke all on function public.expense_guard_claim_reopen() from public,anon,authenticated;
revoke all on function public.expense_release_reopened_claim() from public,anon,authenticated;
revoke all on function public.expense_create_claim(uuid,date,date) from public,anon,authenticated;
revoke all on function public.expense_reopen_claim(uuid) from public,anon,authenticated;
grant execute on function public.expense_create_claim(uuid,date,date) to service_role;
grant execute on function public.expense_reopen_claim(uuid) to service_role;
commit;
