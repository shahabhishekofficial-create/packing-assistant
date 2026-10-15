-- Slice 2b export summary rollback. Drops only the function introduced by this migration.
begin;
drop function if exists public.expense_export_summary(uuid, date, date, uuid, text, text);
commit;
