-- Remove legacy permissive policies left on drivers.
drop policy if exists drivers_insert on public.drivers;
drop policy if exists drivers_read on public.drivers;
revoke insert, update, delete, truncate, references, trigger on public.drivers from anon, authenticated;
