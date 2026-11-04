-- Rollback for the Vegetable Inward v1 module.
-- This removes the module's own objects only. Nothing else in the database is
-- touched. Read VEGETABLE_INWARD.md before running it: the three tables hold the
-- inward records, so export them first if the module has been used.
begin;

drop function if exists public.veg_inward_summary(date, date, uuid, uuid);
drop function if exists public.veg_inward_items();

-- the entry table is protected against hard deletes, so the guard is removed
-- before the tables can be dropped
drop trigger if exists veg_inward_entries_no_delete on public.veg_inward_entries;
drop trigger if exists veg_inward_entries_touch on public.veg_inward_entries;

drop table if exists public.veg_inward_audit;
drop table if exists public.veg_inward_entries;
drop table if exists public.veg_inward_vendors;

drop function if exists public.veg_inward_whoami(text, text);
drop function if exists public.veg_inward_block_hard_delete();
drop function if exists public.veg_inward_touch_updated_at();

commit;
