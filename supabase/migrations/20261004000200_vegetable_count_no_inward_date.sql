-- Vegetable in-hand counting does not use inward/receiving dates.
-- Keep the legacy column for compatibility, but remove the old DUMP=>inward_date requirement.
alter table public.inv_vegetable_counts
  drop constraint if exists inv_vegetable_dump_date_ck;
