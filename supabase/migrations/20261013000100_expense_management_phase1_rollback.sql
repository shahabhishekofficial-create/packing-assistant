-- Expense Management Phase 1 rollback (review only; NOT executed).
-- DESTRUCTIVE: permanently removes all expense-module data and objects.
-- Use only after a separately verified backup and explicit approval.
begin;
drop view if exists public.expense_balance_summary;
drop trigger if exists expense_release_reopened_claim_trg on public.expense_claims;
drop trigger if exists expense_guard_expense_claim_trg on public.expenses;
drop trigger if exists expense_guard_payment_claim_trg on public.expense_payments;
drop trigger if exists expense_guard_claim_reopen_trg on public.expense_claims;
drop function if exists public.expense_release_reopened_claim();
drop function if exists public.expense_guard_expense_claim();
drop function if exists public.expense_guard_payment_claim();
drop function if exists public.expense_guard_claim_reopen();
drop function if exists public.expense_create_claim(uuid,date,date);
drop function if exists public.expense_reopen_claim(uuid);
drop table if exists public.expense_payments;
drop table if exists public.expenses;
drop table if exists public.expense_claims;
drop table if exists public.expense_categories;
drop table if exists public.expense_employees;
commit;
