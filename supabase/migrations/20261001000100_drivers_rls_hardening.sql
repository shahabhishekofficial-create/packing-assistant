-- Driver directory security hardening
-- The browser reads only active driver names for assignment/dropdowns.
-- Direct writes are not a client capability; team management uses authenticated application RPCs.

alter table public.drivers enable row level security;

drop policy if exists "anon_authenticated_read_active_drivers" on public.drivers;
create policy "anon_authenticated_read_active_drivers"
on public.drivers
for select
to anon, authenticated
using (active = true);

revoke insert, update, delete, truncate, references, trigger
on table public.drivers
from anon, authenticated;
