-- Expense Management Phase 1 schema (review only; NOT applied).
-- Creates new expense_* tables only. No existing table/RPC/function is modified.
begin;

create table public.expense_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index expense_employees_one_default_idx
  on public.expense_employees (is_default) where is_default;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.expense_employees(id) on delete restrict,
  claim_number bigint generated always as identity unique,
  from_date date not null,
  to_date date not null,
  created_at timestamptz not null default now(),
  reopened_at timestamptz,
  check (to_date >= from_date)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.expense_employees(id) on delete restrict,
  expense_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  notes text,
  claim_id uuid references public.expense_claims(id) on delete restrict,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_employee_date_idx on public.expenses(employee_id, expense_date desc) where deleted_at is null;
create index expenses_claim_idx on public.expenses(claim_id) where claim_id is not null;
create index expenses_category_idx on public.expenses(category_id) where deleted_at is null;

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.expense_employees(id) on delete restrict,
  claim_id uuid references public.expense_claims(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null check (mode in ('Bank','Cash','UPI','Other')),
  reference_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expense_payments_employee_date_idx on public.expense_payments(employee_id, payment_date desc);
create index expense_payments_claim_idx on public.expense_payments(claim_id) where claim_id is not null;

insert into public.expense_employees(name,is_default) values ('Me',true);
insert into public.expense_categories(name,sort_order) values
 ('LR',1),('Q Com Transport',2),('Local Purchase',3),('Packaging Material',4),
 ('HORECA Transport',5),('Other Transport',6),('Other',7);

-- A claimed expense cannot be changed or soft-deleted until its claim is reopened.
-- A claim can only contain active, unclaimed expenses in its employee/date range.
create or replace function public.expense_guard_expense_claim()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare c public.expense_claims%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.claim_id is not null and exists (
      select 1 from public.expense_claims x where x.id=old.claim_id and x.reopened_at is null
    ) then raise exception 'Claimed expense is locked; reopen its claim first'; end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.claim_id is not null
     and (new.employee_id is distinct from old.employee_id
       or new.expense_date is distinct from old.expense_date
       or new.amount is distinct from old.amount
       or new.category_id is distinct from old.category_id
       or new.reason is distinct from old.reason
       or new.notes is distinct from old.notes
       or new.deleted_at is distinct from old.deleted_at
       or new.claim_id is distinct from old.claim_id) then
    if exists (select 1 from public.expense_claims x where x.id=old.claim_id and x.reopened_at is null) then
      raise exception 'Claimed expense is locked; reopen its claim first';
    end if;
  end if;

  if new.claim_id is not null then
    select * into c from public.expense_claims where id=new.claim_id for update;
    if not found then raise exception 'Claim not found'; end if;
    if c.reopened_at is not null then raise exception 'Cannot attach expenses to a reopened claim'; end if;
    if c.employee_id <> new.employee_id then raise exception 'Expense and claim employee must match'; end if;
    if new.expense_date < c.from_date or new.expense_date > c.to_date then raise exception 'Expense date is outside claim range'; end if;
    if new.deleted_at is not null then raise exception 'Deleted expenses cannot be claimed'; end if;
    if tg_op = 'UPDATE' and old.claim_id is not null and old.claim_id <> new.claim_id then
      raise exception 'Remove an expense from its claim only by reopening the claim first';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger expense_guard_expense_claim_trg
before insert or update or delete on public.expenses
for each row execute function public.expense_guard_expense_claim();

-- Payments must belong to the same employee as a linked claim.
-- Reopening a claim is blocked while any payments remain linked.
create or replace function public.expense_guard_payment_claim()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare c public.expense_claims%rowtype;
begin
  if new.claim_id is not null then
    select * into c from public.expense_claims where id=new.claim_id for update;
    if not found then raise exception 'Claim not found'; end if;
    if c.employee_id <> new.employee_id then raise exception 'Payment and claim employee must match'; end if;
    if c.reopened_at is not null then raise exception 'Cannot link payment to a reopened claim'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger expense_guard_payment_claim_trg
before insert or update on public.expense_payments
for each row execute function public.expense_guard_payment_claim();

create or replace function public.expense_guard_claim_reopen()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.reopened_at is null and new.reopened_at is not null
     and exists (select 1 from public.expense_payments p where p.claim_id=old.id) then
    raise exception 'Unlink or remove payments before reopening this claim';
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.from_date is distinct from old.from_date
     or new.to_date is distinct from old.to_date
     or new.claim_number is distinct from old.claim_number then
    raise exception 'Claim identity and date range cannot be edited';
  end if;
  return new;
end $$;
create trigger expense_guard_claim_reopen_trg
before update on public.expense_claims
for each row execute function public.expense_guard_claim_reopen();

-- No browser/public role can access these tables directly. The future expense-api
-- must validate the Admin session before using its server-side service-role client.
alter table public.expense_employees enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
revoke all on public.expense_employees from public, anon, authenticated;
revoke all on public.expense_categories from public, anon, authenticated;
revoke all on public.expense_claims from public, anon, authenticated;
revoke all on public.expenses from public, anon, authenticated;
revoke all on public.expense_payments from public, anon, authenticated;
grant select, insert, update, delete on public.expense_employees to service_role;
grant select, insert, update, delete on public.expense_categories to service_role;
grant select, insert, update, delete on public.expense_claims to service_role;
grant select, insert, update, delete on public.expenses to service_role;
grant select, insert, update, delete on public.expense_payments to service_role;

commit;
