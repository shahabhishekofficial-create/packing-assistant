-- Rollback for 20261023000100_expense_claim_summary.sql.
-- Run only if the migration was applied and rollback is explicitly approved.
drop function if exists public.expense_claim_summary(uuid);
