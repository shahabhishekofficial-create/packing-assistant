-- Slice B1: read-only per-claim summary. REVIEW ONLY; do not apply without separate approval.
-- Amounts are exact integer-paise strings; no floating-point arithmetic.
create or replace function public.expense_claim_summary(p_employee_id uuid)
returns table (
  claim_id uuid,
  claim_number bigint,
  period_from date,
  period_to date,
  expense_count bigint,
  claimed_paise text,
  received_paise text,
  due_paise text,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_employee_id is null then
    raise exception using message = 'INVALID_EMPLOYEE: Employee is required';
  end if;

  if not exists (
    select 1
    from public.expense_employees e
    where e.id = p_employee_id and e.active
  ) then
    raise exception using message = 'INVALID_EMPLOYEE: Active employee not found';
  end if;

  return query
  with claim_expenses as (
    select
      e.claim_id,
      count(*)::bigint as expense_count,
      sum((e.amount * 100)::bigint) as claimed_paise
    from public.expenses e
    where e.employee_id = p_employee_id
      and e.deleted_at is null
      and e.claim_id is not null
    group by e.claim_id
  ),
  claim_payments as (
    select
      p.claim_id,
      sum((p.amount * 100)::bigint) as received_paise
    from public.expense_payments p
    where p.employee_id = p_employee_id
      and p.claim_id is not null
    group by p.claim_id
  )
  select
    c.id,
    c.claim_number,
    c.from_date,
    c.to_date,
    coalesce(ce.expense_count, 0)::bigint,
    coalesce(ce.claimed_paise, 0)::text,
    coalesce(cp.received_paise, 0)::text,
    (coalesce(ce.claimed_paise, 0) - coalesce(cp.received_paise, 0))::text,
    case
      when c.reopened_at is not null then 'Reopened'
      when coalesce(ce.claimed_paise, 0) - coalesce(cp.received_paise, 0) <= 0 then 'Paid'
      else 'Open'
    end
  from public.expense_claims c
  left join claim_expenses ce on ce.claim_id = c.id
  left join claim_payments cp on cp.claim_id = c.id
  where c.employee_id = p_employee_id
  order by c.claim_number desc, c.id;

end
$function$;

revoke all on function public.expense_claim_summary(uuid) from public, anon, authenticated;
grant execute on function public.expense_claim_summary(uuid) to service_role;
