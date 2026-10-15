-- Slice 2b export summary safety test.
-- Synthetic fixtures only. The transaction is always rolled back.
-- No real expense rows are selected, displayed, updated, or deleted.
begin;

do $test$
declare
  v_employee uuid := gen_random_uuid();
  v_cat_a uuid := gen_random_uuid();
  v_cat_b uuid := gen_random_uuid();
  v_cat_inactive uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_summary jsonb;
  v_list_count bigint;
  v_list_total_paise numeric;
  v_cap_hit boolean := false;
begin
  insert into public.expense_employees(id, name, is_default, active)
  values (v_employee, 'SYNTHETIC EXPORT TEST ONLY', false, true);
  insert into public.expense_categories(id, name, active, sort_order)
  values (v_cat_a, 'SYNTHETIC-A', true, 901),
         (v_cat_b, 'SYNTHETIC-B', true, 902),
         (v_cat_inactive, 'SYNTHETIC-INACTIVE', false, 903);

  insert into public.expenses(employee_id, expense_date, amount, category_id, reason)
  values (v_employee, date '2026-01-10', 12.34, v_cat_a, 'synthetic literal 100%_slash\sample'),
         (v_employee, date '2026-01-11', 5.66, v_cat_b, 'synthetic second reason');

  insert into public.expense_claims(id, employee_id, from_date, to_date)
  values (v_claim, v_employee, date '2026-01-12', date '2026-01-12');
  insert into public.expenses(employee_id, expense_date, amount, category_id, reason, claim_id)
  values (v_employee, date '2026-01-12', 9.00, v_cat_a, 'synthetic claimed reason', v_claim);

  insert into public.expense_payments(employee_id, payment_date, amount, mode)
  values (v_employee, date '2026-01-13', 2.00, 'Cash');

  -- Match list_expenses filters: dates, category, status, and escaped literal search.
  v_summary := public.expense_export_summary(
    v_employee, date '2026-01-01', date '2026-01-31', v_cat_a, 'unclaimed', '100%_slash\'
  );

  select count(*), coalesce(sum((e.amount * 100)::bigint), 0)
    into v_list_count, v_list_total_paise
  from public.expenses e
  where e.employee_id = v_employee
    and e.deleted_at is null
    and e.expense_date >= date '2026-01-01'
    and e.expense_date <= date '2026-01-31'
    and e.category_id = v_cat_a
    and e.claim_id is null
    and e.reason ilike ('%' ||
      replace(replace(replace('100%_slash\', E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')
      || '%') escape E'\\';

  if (v_summary->>'total_count')::bigint <> v_list_count
     or (v_summary->>'total_paise')::numeric <> v_list_total_paise then
    raise exception 'FAIL: export summary does not match list filter count/total';
  end if;

  if (v_summary->>'total_count')::bigint <> 1
     or (v_summary->>'total_paise')::numeric <> 1234 then
    raise exception 'FAIL: literal wildcard escaping or exact paise total';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_summary->'category_totals') x
    where x->>'category_id' = v_cat_inactive::text
      and x->>'total_paise' = '0'
  ) then
    raise exception 'FAIL: inactive zero-total category was omitted';
  end if;

  if v_summary->>'employee_name' <> 'SYNTHETIC EXPORT TEST ONLY'
     or v_summary->>'overall_payments_received_paise' <> '200'
     or v_summary->>'overall_balance_due_paise' <> '2500'
     or v_summary->>'generated_at' is null
     or v_summary->>'overall_as_of_date' is null then
    raise exception 'FAIL: summary metadata or overall figures incorrect';
  end if;

  -- Exercise the cap using synthetic rows only. The exception is expected.
  insert into public.expenses(employee_id, expense_date, amount, category_id, reason)
  select v_employee, date '2026-02-01', 0.01, v_cat_a, 'synthetic cap fixture ' || g::text
  from generate_series(1, 20001) g;

  begin
    perform public.expense_export_summary(v_employee, date '2026-02-01', date '2026-02-01', null, null, null);
  exception when others then
    if sqlerrm like 'EXPORT_ROW_LIMIT_EXCEEDED:%' then
      v_cap_hit := true;
    else
      raise;
    end if;
  end;

  if not v_cap_hit then raise exception 'FAIL: 20,000 row cap was not enforced'; end if;

  raise notice 'PASS: synthetic export summary, filter parity, exact paise, inactive categories, overall fields, and row cap';
end
$test$;

rollback;
