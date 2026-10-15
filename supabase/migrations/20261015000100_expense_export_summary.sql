-- Slice 2b export summary function. REVIEW ONLY: do not apply without separate approval.
-- Uses the existing expense_balance_summary as the sole source for overall balance due.
-- All amounts are returned as integer paise strings; no floating-point output.
create function public.expense_export_summary(
  p_employee_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_category_id uuid default null,
  p_status text default null,
  p_reason_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee_name text;
  v_total_count bigint;
  v_total_paise numeric;
  v_expenses_paise numeric;
  v_payments_paise numeric;
  v_balance_paise numeric;
  v_categories jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_generated_at text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30';
  v_search text;
begin
  if p_employee_id is null then
    raise exception using message = 'INVALID_EMPLOYEE: Employee is required';
  end if;
  if (p_from_date is not null and not isfinite(p_from_date))
     or (p_to_date is not null and not isfinite(p_to_date))
     or (p_from_date is not null and p_to_date is not null and p_from_date > p_to_date) then
    raise exception using message = 'INVALID_DATE_RANGE: Choose a valid date range';
  end if;
  if p_status is not null and p_status not in ('unclaimed', 'claimed') then
    raise exception using message = 'INVALID_STATUS: Choose unclaimed or claimed';
  end if;
  if p_reason_search is not null and length(p_reason_search) > 200 then
    raise exception using message = 'INVALID_REASON_SEARCH: Search must be 200 characters or fewer';
  end if;

  select e.name into v_employee_name
  from public.expense_employees e
  where e.id = p_employee_id and e.active;
  if not found then
    raise exception using message = 'INVALID_EMPLOYEE: Active employee not found';
  end if;

  -- Same filter semantics as list_expenses: active rows, inclusive dates,
  -- optional category/status, and literal substring search with \, %, _ escaped.
  v_search := case when coalesce(p_reason_search, '') = '' then null else
    replace(replace(replace(p_reason_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')
  end;

  select count(*) into v_total_count
  from public.expenses e
  where e.employee_id = p_employee_id
    and e.deleted_at is null
    and (p_from_date is null or e.expense_date >= p_from_date)
    and (p_to_date is null or e.expense_date <= p_to_date)
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_status is null
      or (p_status = 'unclaimed' and e.claim_id is null)
      or (p_status = 'claimed' and e.claim_id is not null))
    and (v_search is null or e.reason ilike ('%' || v_search || '%') escape E'\\');

  if v_total_count > 20000 then
    raise exception using message = 'EXPORT_ROW_LIMIT_EXCEEDED: More than 20,000 matching expenses. Narrow the date range or filters and try again';
  end if;

  select coalesce(sum((e.amount * 100)::bigint), 0)
    into v_total_paise
  from public.expenses e
  where e.employee_id = p_employee_id
    and e.deleted_at is null
    and (p_from_date is null or e.expense_date >= p_from_date)
    and (p_to_date is null or e.expense_date <= p_to_date)
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_status is null
      or (p_status = 'unclaimed' and e.claim_id is null)
      or (p_status = 'claimed' and e.claim_id is not null))
    and (v_search is null or e.reason ilike ('%' || v_search || '%') escape E'\\');

  -- Include every category, active or inactive, including zero-total categories.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category_id', c.id,
      'category', c.name,
      'sort_order', c.sort_order,
      'total_paise', coalesce(x.total_paise, 0)::text,
      'count', coalesce(x.row_count, 0)
    ) order by c.sort_order, c.name, c.id
  ), '[]'::jsonb)
  into v_categories
  from public.expense_categories c
  left join (
    select e.category_id,
      sum((e.amount * 100)::bigint) total_paise,
      count(*) row_count
    from public.expenses e
    where e.employee_id = p_employee_id
      and e.deleted_at is null
      and (p_from_date is null or e.expense_date >= p_from_date)
      and (p_to_date is null or e.expense_date <= p_to_date)
      and (p_category_id is null or e.category_id = p_category_id)
      and (p_status is null
        or (p_status = 'unclaimed' and e.claim_id is null)
        or (p_status = 'claimed' and e.claim_id is not null))
      and (v_search is null or e.reason ilike ('%' || v_search || '%') escape E'\\')
    group by e.category_id
  ) x on x.category_id = c.id;

  -- Overall expenses include every active expense for this employee, independent
  -- of the period/category/status/search filters used for the export section.
  select coalesce(sum((e.amount * 100)::bigint), 0)
    into v_expenses_paise
  from public.expenses e
  where e.employee_id = p_employee_id and e.deleted_at is null;

  -- Overall payments are summed from expense_payments. Overall balance due has
  -- one source only: the employee summary row in expense_balance_summary.
  select coalesce(sum((p.amount * 100)::bigint), 0)
    into v_payments_paise
  from public.expense_payments p
  where p.employee_id = p_employee_id;

  select (b.total_due * 100)::bigint
    into v_balance_paise
  from public.expense_balance_summary b
  where b.employee_id = p_employee_id and b.claim_id is null;

  if v_balance_paise is null then
    raise exception using message = 'BALANCE_SUMMARY_UNAVAILABLE: Employee balance summary row is missing';
  end if;

  return jsonb_build_object(
    'employee_name', v_employee_name,
    'period_from', p_from_date,
    'period_to', p_to_date,
    'generated_at', v_generated_at,
    'overall_as_of_date', v_today,
    'total_count', v_total_count,
    'total_paise', v_total_paise::text,
    'category_totals', v_categories,
    'overall_expenses_paise', v_expenses_paise::text,
    'overall_payments_received_paise', v_payments_paise::text,
    'overall_balance_due_paise', v_balance_paise::text
  );
end
$function$;

revoke all on function public.expense_export_summary(uuid, date, date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.expense_export_summary(uuid, date, date, uuid, text, text) to service_role;
