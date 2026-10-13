-- Expense Management Phase 1 rollback (review only; NOT executed).
-- DESTRUCTIVE: permanently removes all expense module data. Use only before real data
-- is entered, or after a separately verified backup. Drops only new expense_* objects.
begin;
drop trigger if exists expense_guard_expense_claim_trg on public.expenses;
drop trigger if exists expense_guard_payment_claim_trg on public.expense_payments;
drop trigger if exists expense_guard_claim_reopen_trg on public.expense_claims;
drop function if exists public.expense_guard_expense_claim();
drop function if exists public.expense_guard_payment_claim();
drop function if exists public.expense_guard_claim_reopen();
drop table if exists public.expense_payments;
drop table if exists public.expenses;
drop table if exists public.expense_claims;
drop table if exists public.expense_categories;
drop table if exists public.expense_employees;
commit;
