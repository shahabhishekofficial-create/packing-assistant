-- Driver RPCs are server-side implementation details of the driver-api Edge Function.
-- Browser clients call the Edge Function, which uses service-role access.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like 'driver\_%' or p.proname like 'get\_driver\_%' or p.proname like 'save\_driver\_%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;
