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
  v_hand_total_count bigint;
  v_hand_total_paise numeric;
  v_overall_expenses_paise numeric;
  v_overall_payments_paise numeric;
  v_overall_balance_paise numeric;
  v_pos_a bigint;
  v_pos_b bigint;
  v_pos_inactive bigint;
  v_error_hit boolean;
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
         (v_employee, date '2026-01-11', 5.66, v_cat_b, 'synthetic second 50%_reason');

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
      and x->>'sort_order' = '903'
  ) then
    raise exception 'FAIL: inactive zero-total category or sort_order was omitted';
  end if;

  -- Category output must retain the declared sort_order, including inactive categories.
  select ordinality into v_pos_a
  from jsonb_array_elements(v_summary->'category_totals') with ordinality x
  where x->>'category_id' = v_cat_a::text and x->>'sort_order' = '901';
  select ordinality into v_pos_b
  from jsonb_array_elements(v_summary->'category_totals') with ordinality x
  where x->>'category_id' = v_cat_b::text and x->>'sort_order' = '902';
  select ordinality into v_pos_inactive
  from jsonb_array_elements(v_summary->'category_totals') with ordinality x
  where x->>'category_id' = v_cat_inactive::text and x->>'sort_order' = '903';
  if v_pos_a is null or v_pos_b is null or v_pos_inactive is null
     or not (v_pos_a < v_pos_b and v_pos_b < v_pos_inactive) then
    raise exception 'FAIL: categories are not ordered by sort_order';
  end if;

  -- Independent hand-written query against synthetic rows, not the function's internals.
  select count(*), coalesce(sum((e.amount * 100)::bigint), 0)
    into v_hand_total_count, v_hand_total_paise
  from public.expenses e
  where e.employee_id = v_employee
    and e.deleted_at is null
    and e.expense_date between date '2026-01-01' and date '2026-01-31'
    and e.category_id = v_cat_a
    and e.claim_id is null
    and e.reason ilike ('%' ||
      replace(replace(replace('100%_slash\', E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')
      || '%') escape E'\\';
  if v_hand_total_count <> 1 or v_hand_total_paise <> 1234
     or (v_summary->>'total_count')::bigint <> v_hand_total_count
     or (v_summary->>'total_paise')::numeric <> v_hand_total_paise then
    raise exception 'FAIL: function result differs from independent synthetic-row query';
  end if;

  -- Verify overall arithmetic using an independent sum of all active synthetic expenses.
  select coalesce(sum((e.amount * 100)::bigint), 0)
    into v_overall_expenses_paise
  from public.expenses e
  where e.employee_id = v_employee and e.deleted_at is null;
  select coalesce(sum((p.amount * 100)::bigint), 0)
    into v_overall_payments_paise
  from public.expense_payments p
  where p.employee_id = v_employee;
  v_overall_balance_paise := (v_summary->>'overall_balance_due_paise')::numeric;
  if (v_summary->>'overall_expenses_paise')::numeric <> v_overall_expenses_paise
     or (v_summary->>'overall_payments_received_paise')::numeric <> v_overall_payments_paise
     or v_overall_expenses_paise - v_overall_payments_paise <> v_overall_balance_paise
     or v_overall_expenses_paise <> 2700
     or v_overall_payments_paise <> 200
     or v_overall_balance_paise <> 2500 then
    raise exception 'FAIL: overall expenses minus payments does not equal balance due';
  end if;

  if v_summary->>'employee_name' <> 'SYNTHETIC EXPORT TEST ONLY'
     or v_summary->>'generated_at' is null
     or v_summary->>'overall_as_of_date' is null then
    raise exception 'FAIL: summary metadata incorrect';
  end if;

  -- Invalid-input contract: each expected validation error must be returned.
  v_error_hit := false;
  begin
    perform public.expense_export_summary(null, null, null, null, null, null);
  exception when others then
    if sqlerrm like 'INVALID_EMPLOYEE:%' then v_error_hit := true; else raise; end if;
  end;
  if not v_error_hit then raise exception 'FAIL: null employee was accepted'; end if;

  v_error_hit := false;
  begin
    perform public.expense_export_summary(v_employee, date '2026-02-02', date '2026-02-01', null, null, null);
  exception when others then
    if sqlerrm like 'INVALID_DATE_RANGE:%' then v_error_hit := true; else raise; end if;
  end;
  if not v_error_hit then raise exception 'FAIL: invalid date range was accepted'; end if;

  v_error_hit := false;
  begin
    perform public.expense_export_summary(v_employee, null, null, null, 'invalid-status', null);
  exception when others then
    if sqlerrm like 'INVALID_STATUS:%' then v_error_hit := true; else raise; end if;
  end;
  if not v_error_hit then raise exception 'FAIL: invalid status was accepted'; end if;

  v_error_hit := false;
  begin
    perform public.expense_export_summary(v_employee, null, null, null, null, repeat('x', 201));
  exception when others then
    if sqlerrm like 'INVALID_REASON_SEARCH:%' then v_error_hit := true; else raise; end if;
  end;
  if not v_error_hit then raise exception 'FAIL: overlong reason search was accepted'; end if;

  v_error_hit := false;
  begin
    perform public.expense_export_summary(gen_random_uuid(), null, null, null, null, null);
  exception when others then
    if sqlerrm like 'INVALID_EMPLOYEE:%' then v_error_hit := true; else raise; end if;
  end;
  if not v_error_hit then raise exception 'FAIL: unknown employee was accepted'; end if;

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

  raise notice 'PASS: synthetic independent-query parity, wildcard escaping, category sort_order, invalid inputs, overall balance arithmetic, and row cap';
end
$test$;

rollback;
