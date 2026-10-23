-- Slice B1 synthetic-only test for expense_claim_summary.
-- Run only in a disposable test session after the migration is separately approved/applied.
-- All fixtures are synthetic and the transaction ends with ROLLBACK.
begin;

do $test$
declare
  v_employee uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_open_claim uuid := gen_random_uuid();
  v_paid_claim uuid := gen_random_uuid();
  v_reopened_claim uuid := gen_random_uuid();
  v_summary record;
  v_reopen_refused boolean := false;
begin
  insert into public.expense_employees(id, name, is_default, active)
  values (v_employee, 'SYNTHETIC CLAIM SUMMARY TEST ONLY', false, true);

  insert into public.expense_categories(id, name, active, sort_order)
  values (v_category, 'SYNTHETIC CLAIM SUMMARY CATEGORY', true, 990);

  insert into public.expense_claims(id, employee_id, from_date, to_date)
  values
    (v_open_claim, v_employee, date '2026-01-01', date '2026-01-02'),
    (v_paid_claim, v_employee, date '2026-01-03', date '2026-01-03'),
    (v_reopened_claim, v_employee, date '2026-01-04', date '2026-01-04');

  update public.expense_claims
  set reopened_at = now()
  where id = v_reopened_claim;

  insert into public.expenses(employee_id, expense_date, amount, category_id, reason, claim_id)
  values
    (v_employee, date '2026-01-01', 20.00, v_category, 'synthetic open A', v_open_claim),
    (v_employee, date '2026-01-02', 5.00, v_category, 'synthetic open B', v_open_claim),
    (v_employee, date '2026-01-03', 10.00, v_category, 'synthetic paid', v_paid_claim);

  insert into public.expense_payments(employee_id, claim_id, payment_date, amount, mode)
  values
    (v_employee, v_open_claim, date '2026-01-05', 5.00, 'Cash'),
    (v_employee, v_paid_claim, date '2026-01-06', 10.00, 'Bank');

  select * into v_summary
  from public.expense_claim_summary(v_employee)
  where claim_id = v_open_claim;

  if v_summary.claim_number is null
     or v_summary.period_from <> date '2026-01-01'
     or v_summary.period_to <> date '2026-01-02'
     or v_summary.expense_count <> 2
     or v_summary.claimed_paise <> '2500'
     or v_summary.received_paise <> '500'
     or v_summary.due_paise <> '2000'
     or v_summary.status <> 'Open' then
    raise exception 'FAIL: open claim summary totals/status incorrect';
  end if;

  select * into v_summary
  from public.expense_claim_summary(v_employee)
  where claim_id = v_paid_claim;

  if v_summary.expense_count <> 1
     or v_summary.claimed_paise <> '1000'
     or v_summary.received_paise <> '1000'
     or v_summary.due_paise <> '0'
     or v_summary.status <> 'Paid' then
    raise exception 'FAIL: paid claim summary totals/status incorrect';
  end if;

  select * into v_summary
  from public.expense_claim_summary(v_employee)
  where claim_id = v_reopened_claim;

  if v_summary.expense_count <> 0
     or v_summary.claimed_paise <> '0'
     or v_summary.received_paise <> '0'
     or v_summary.due_paise <> '0'
     or v_summary.status <> 'Reopened' then
    raise exception 'FAIL: reopened claim must never be labelled Paid';
  end if;

  begin
    perform public.expense_reopen_claim(v_paid_claim);
  exception when others then
    if sqlerrm = 'Unlink or remove payments before reopening this claim' then
      v_reopen_refused := true;
    else
      raise;
    end if;
  end;

  if not v_reopen_refused then
    raise exception 'FAIL: reopen was not refused while a payment remained linked';
  end if;

  if not has_function_privilege('service_role', 'public.expense_claim_summary(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.expense_claim_summary(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expense_claim_summary(uuid)', 'EXECUTE') then
    raise exception 'FAIL: function execute grants do not match service_role-only requirement';
  end if;

  raise notice 'PASS: exact paise totals, open/paid/reopened status, linked-payment reopen refusal, and execute grants';
end
$test$;

rollback;
