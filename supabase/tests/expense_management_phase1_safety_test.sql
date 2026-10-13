-- Safety test script: DO NOT RUN until the user approves and the migration is applied.
-- Run as database owner in Supabase SQL Editor. All fixture changes are rolled back.
begin;
do $$
declare v_emp uuid; v_cat uuid; v_exp uuid; v_outside uuid; v_claim uuid; v_pay uuid; v_failed boolean; v_amt numeric; v_role text; v_fn text; v_acl text; v_public_exec boolean;
begin
 insert into public.expense_employees(name,is_default) values('__TEST_EMPLOYEE__',false) returning id into v_emp;
 select id into v_cat from public.expense_categories where name='Other' limit 1;
 insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(v_emp,date '2026-01-10',100,v_cat,'locked test') returning id into v_exp;
 insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(v_emp,date '2026-01-15',25,v_cat,'outside range test') returning id into v_outside;
 v_claim:=public.expense_create_claim(v_emp,date '2026-01-01',date '2026-01-12');

 -- 1. Claimed expense edits are blocked.
 v_failed:=false; begin update public.expenses set amount=101 where id=v_exp; exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'FAIL: locked expense edit allowed'; end if;

 -- 2. An out-of-range expense cannot be linked to the claim.
 v_failed:=false; begin update public.expenses e set claim_id=v_claim where e.id=v_outside; exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'FAIL: out-of-range expense accepted'; end if;

 -- 3. Linked payment blocks reopening.
 insert into public.expense_payments(employee_id,claim_id,payment_date,amount,mode) values(v_emp,v_claim,date '2026-01-20',10,'Bank') returning id into v_pay;
 v_failed:=false; begin perform public.expense_reopen_claim(v_claim); exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'FAIL: claim reopened while payment linked'; end if;
 delete from public.expense_payments where id=v_pay;

 -- 4. Reopening marks claim first and releases its expenses to Unclaimed.
 perform public.expense_reopen_claim(v_claim);
 if exists(select 1 from public.expenses where id=v_exp and claim_id is not null) then raise exception 'FAIL: reopened expense not Unclaimed'; end if;
 if not exists(select 1 from public.expense_claims where id=v_claim and reopened_at is not null) then raise exception 'FAIL: claim not marked reopened'; end if;

 -- 5. Zero and negative amounts are rejected.
 foreach v_amt in array array[0::numeric,-1::numeric] loop
  v_failed:=false; begin insert into public.expenses(employee_id,expense_date,amount,category_id,reason) values(v_emp,date '2026-01-10',v_amt,v_cat,'invalid amount test'); exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'FAIL: invalid amount % accepted',v_amt; end if;
 end loop;

 -- 6. No EXECUTE grants to anon/authenticated; PUBLIC must have no explicit EXECUTE grant.
 foreach v_fn in array array['public.expense_create_claim(uuid,date,date)','public.expense_reopen_claim(uuid)'] loop
   if has_function_privilege('anon',v_fn,'EXECUTE') then raise exception 'FAIL: anon can execute %',v_fn; end if;
   if has_function_privilege('authenticated',v_fn,'EXECUTE') then raise exception 'FAIL: authenticated can execute %',v_fn; end if;
   select exists(
     select 1 from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     where p.oid=to_regprocedure(v_fn) and a.grantee=0 and a.privilege_type='EXECUTE'
   ) into v_public_exec;
   if v_public_exec then raise exception 'FAIL: PUBLIC can execute %',v_fn; end if;
 end loop;
end $$;

-- 7. Make a real SELECT attempt as anon; success is a test failure.
set local role anon;
do $$
declare v_failed boolean:=false;
begin
 begin
   perform count(*) from public.expenses;
 exception when insufficient_privilege then
   v_failed:=true;
 end;
 if not v_failed then raise exception 'FAIL: anon SELECT from public.expenses succeeded'; end if;
 raise notice 'PASS: anon SELECT from public.expenses denied with permission denied';
end $$;
reset role;

-- 8. Verify the public-key roles do not have direct SELECT privileges on expense tables/view.
do $$
declare v_role text; v_table text;
begin
 foreach v_role in array array['anon','authenticated'] loop
  foreach v_table in array array['expense_employees','expense_categories','expense_claims','expenses','expense_payments','expense_balance_summary'] loop
   if has_table_privilege(v_role,'public.'||v_table,'SELECT') then raise exception 'FAIL: role % can SELECT public.%',v_role,v_table; end if;
  end loop;
 end loop;
 raise notice 'PASS: expense safety checks completed';
end $$;
rollback;
