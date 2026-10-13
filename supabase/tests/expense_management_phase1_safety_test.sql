-- Safety test script: review only. DO NOT RUN until Step (b) is approved and migration applied.
-- Run as database owner in Supabase SQL Editor. All fixture changes are rolled back.
begin;
do $$
declare emp uuid; cat uuid; exp_id uuid; outside_id uuid; claim_id uuid; pay_id uuid; failed boolean; amt numeric;
begin
 insert into public.expense_employees(name,is_default) values('__TEST_EMPLOYEE__',false) returning id into emp;
 select id into cat from public.expense_categories where name='Other' limit 1;
 insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(emp,date '2026-01-10',100,cat,'locked test') returning id into exp_id;
 insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(emp,date '2026-01-15',25,cat,'outside range test') returning id into outside_id;
 claim_id:=public.expense_create_claim(emp,date '2026-01-01',date '2026-01-12');
 failed:=false; begin update public.expenses set amount=101 where id=exp_id; exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL: locked expense edit allowed'; end if;
 failed:=false; begin update public.expenses set claim_id=claim_id where id=outside_id; exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL: out-of-range expense accepted'; end if;
 insert into public.expense_payments(employee_id,claim_id,payment_date,amount,mode) values(emp,claim_id,date '2026-01-20',10,'Bank') returning id into pay_id;
 failed:=false; begin perform public.expense_reopen_claim(claim_id); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL: claim reopened while payment linked'; end if;
 delete from public.expense_payments where id=pay_id;
 perform public.expense_reopen_claim(claim_id);
 if exists(select 1 from public.expenses where id=exp_id and claim_id is not null) then raise exception 'FAIL: reopened expense not Unclaimed'; end if;
 if not exists(select 1 from public.expense_claims where id=claim_id and reopened_at is not null) then raise exception 'FAIL: claim not marked reopened'; end if;
 foreach amt in array array[0::numeric,-1::numeric] loop
  failed:=false; begin insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(emp,date '2026-01-10',amt,cat,'invalid amount test'); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'FAIL: invalid amount % accepted',amt; end if;
 end loop;
 -- Role checks must fail with insufficient_privilege; run this test as a DB owner.
 begin execute 'set local role anon'; execute 'select count(*) from public.expenses'; raise exception 'FAIL: anon read expenses'; exception when insufficient_privilege then null; end;
 begin execute 'set local role authenticated'; execute 'select count(*) from public.expense_claims'; raise exception 'FAIL: authenticated read claims'; exception when insufficient_privilege then null; end;
 execute 'reset role';
 begin execute 'set local role anon'; execute 'select count(*) from public.expense_balance_summary'; raise exception 'FAIL: anon read balance view'; exception when insufficient_privilege then null; end;
 execute 'reset role';
 raise notice 'PASS: safety checks completed';
end $$;
rollback;
