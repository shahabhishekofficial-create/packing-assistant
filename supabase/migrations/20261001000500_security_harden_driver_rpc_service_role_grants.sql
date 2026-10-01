-- Driver RPCs are server-side implementation details of driver-api.
-- Keep execution for service_role only.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like 'driver\_%' or p.proname like 'get\_driver\_%' or p.proname like 'save\_driver\_%')
  loop
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end $$;
