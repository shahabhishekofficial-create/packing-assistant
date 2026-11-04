-- Vegetable Inward v1 — synthetic acceptance test.
-- Synthetic names and fixtures only ("TEST VENDOR A", "TEST VENDOR B", "TEST ITEM").
-- The transaction is always rolled back: no real row is inserted, updated or removed.
begin;

do $test$
declare
  v_item uuid := gen_random_uuid();
  v_item_other uuid := gen_random_uuid();
  v_vendor_a uuid := gen_random_uuid();
  v_vendor_b uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid();
  v_e2 uuid := gen_random_uuid();
  v_e3 uuid := gen_random_uuid();
  v_e4 uuid := gen_random_uuid();
  v_trips bigint;
  v_total text;
  v_sorted text;
  v_a text;
  v_b text;
  v_d text;
  v_unacc text;
  v_pending text;
  v_a_pct text;
  v_b_pct text;
  v_d_pct text;
  v_kind text;
  v_vendor_id uuid;
  v_vendor_rows int;
  v_cap_hit boolean := false;
  v_delete_blocked boolean := false;
  v_sorted_above_total_blocked boolean := false;
  v_partial_grades_blocked boolean := false;
  v_duplicate_vendor_blocked boolean := false;
  v_bad_range_blocked boolean := false;
begin
  -- ---- fixtures ---------------------------------------------------------
  insert into public.inv_vegetable_items(item_id, name_en, name_hi, name_gu, base_uom, is_active, created_by)
  values (v_item, 'TEST ITEM', null, null, 'kg', true, 'TEST'),
         (v_item_other, 'TEST ITEM OTHER', null, null, 'kg', true, 'TEST');

  insert into public.veg_inward_vendors(id, name, active)
  values (v_vendor_a, 'TEST VENDOR A', true),
         (v_vendor_b, 'TEST VENDOR B', true);

  -- entry 1: 80 kg total, A 40 / B 30 / Dump 10 (sorted)
  insert into public.veg_inward_entries
    (id, item_id, vendor_id, received_at, total_g, a_g, b_g, dump_g, sorted_at, notes, entered_by)
  values
    (v_e1, v_item, v_vendor_a, timestamptz '2026-01-10 09:15:00+05:30', 80000, 40000, 30000, 10000,
     timestamptz '2026-01-10 11:00:00+05:30', 'TEST', 'TEST');

  select trips, total_g, sorted_g, a_g, b_g, dump_g, unaccounted_g, pending_g, a_pct, b_pct, dump_pct
    into v_trips, v_total, v_sorted, v_a, v_b, v_d, v_unacc, v_pending, v_a_pct, v_b_pct, v_d_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, v_vendor_a)
  where row_kind = 'vendor';

  if v_a_pct is distinct from '50.0' then raise exception 'FAIL: first entry A%% is %, expected 50.0', v_a_pct; end if;
  if v_b_pct is distinct from '37.5' then raise exception 'FAIL: first entry B%% is %, expected 37.5', v_b_pct; end if;
  if v_d_pct is distinct from '12.5' then raise exception 'FAIL: first entry Dump%% is %, expected 12.5', v_d_pct; end if;
  if v_total is distinct from '80000' then raise exception 'FAIL: first entry total is %, expected 80000', v_total; end if;
  if v_pending is distinct from '0' then raise exception 'FAIL: first entry pending is %, expected 0', v_pending; end if;

  -- entry 2: same vendor, same item, 20 kg total, A 10 / B 6 / Dump 4 (sorted)
  insert into public.veg_inward_entries
    (id, item_id, vendor_id, received_at, total_g, a_g, b_g, dump_g, sorted_at, notes, entered_by)
  values
    (v_e2, v_item, v_vendor_a, timestamptz '2026-01-10 15:40:00+05:30', 20000, 10000, 6000, 4000,
     timestamptz '2026-01-10 17:00:00+05:30', 'TEST', 'TEST');

  select trips, total_g, a_g, b_g, dump_g, a_pct, b_pct, dump_pct
    into v_trips, v_total, v_a, v_b, v_d, v_a_pct, v_b_pct, v_d_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, v_vendor_a)
  where row_kind = 'vendor';

  if v_trips <> 2 then raise exception 'FAIL: expected 2 trips, got %', v_trips; end if;
  if v_total is distinct from '100000' then raise exception 'FAIL: combined total is %, expected 100000', v_total; end if;
  if v_a_pct is distinct from '50.0' then raise exception 'FAIL: combined A%% is %, expected 50.0', v_a_pct; end if;
  if v_b_pct is distinct from '36.0' then raise exception 'FAIL: combined B%% is %, expected 36.0', v_b_pct; end if;
  if v_d_pct is distinct from '14.0' then raise exception 'FAIL: combined Dump%% is %, expected 14.0', v_d_pct; end if;

  -- entry 3: another vendor, same item, still pending sorting
  insert into public.veg_inward_entries
    (id, item_id, vendor_id, received_at, total_g, notes, entered_by)
  values
    (v_e3, v_item, v_vendor_b, timestamptz '2026-01-10 18:05:00+05:30', 30000, 'TEST', 'TEST');

  select count(*) into v_vendor_rows
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, null)
  where row_kind = 'vendor';
  if v_vendor_rows <> 2 then
    raise exception 'FAIL: two vendors of one item must stay separate, got % vendor rows', v_vendor_rows;
  end if;

  select total_g, sorted_g, pending_g, a_pct, b_pct, dump_pct
    into v_total, v_sorted, v_pending, v_a_pct, v_b_pct, v_d_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, v_vendor_b)
  where row_kind = 'vendor';

  if v_total is distinct from '30000' then raise exception 'FAIL: pending vendor total is %, expected 30000', v_total; end if;
  if v_sorted is distinct from '0' then raise exception 'FAIL: pending vendor sorted is %, expected 0', v_sorted; end if;
  if v_pending is distinct from '30000' then raise exception 'FAIL: pending vendor pending is %, expected 30000', v_pending; end if;
  if v_a_pct is not null or v_b_pct is not null or v_d_pct is not null then
    raise exception 'FAIL: a pending entry must not produce percentages, got % / % / %', v_a_pct, v_b_pct, v_d_pct;
  end if;

  -- entry 4: a third trip for vendor A, pending: it must not move the percentages
  insert into public.veg_inward_entries
    (id, item_id, vendor_id, received_at, total_g, notes, entered_by)
  values
    (v_e4, v_item, v_vendor_a, timestamptz '2026-01-10 19:20:00+05:30', 25000, 'TEST', 'TEST');

  select total_g, sorted_g, pending_g, a_pct, b_pct, dump_pct
    into v_total, v_sorted, v_pending, v_a_pct, v_b_pct, v_d_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, v_vendor_a)
  where row_kind = 'vendor';

  if v_total is distinct from '125000' then raise exception 'FAIL: vendor A total is %, expected 125000', v_total; end if;
  if v_sorted is distinct from '100000' then raise exception 'FAIL: vendor A sorted is %, expected 100000', v_sorted; end if;
  if v_pending is distinct from '25000' then raise exception 'FAIL: vendor A pending is %, expected 25000', v_pending; end if;
  if v_a_pct is distinct from '50.0' or v_b_pct is distinct from '36.0' or v_d_pct is distinct from '14.0' then
    raise exception 'FAIL: percentages moved after a pending trip: % / % / %', v_a_pct, v_b_pct, v_d_pct;
  end if;

  -- item subtotal (vendor A has 3 trips, vendor B has 1) and grand total
  select row_kind, trips, total_g, sorted_g, pending_g, a_pct
    into v_kind, v_trips, v_total, v_sorted, v_pending, v_a_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', v_item, null)
  where row_kind = 'item';
  if v_trips <> 4 then raise exception 'FAIL: item subtotal trips %, expected 4', v_trips; end if;
  if v_total is distinct from '155000' then raise exception 'FAIL: item subtotal total %, expected 155000', v_total; end if;
  if v_sorted is distinct from '100000' then raise exception 'FAIL: item subtotal sorted %, expected 100000', v_sorted; end if;
  if v_pending is distinct from '55000' then raise exception 'FAIL: item subtotal pending %, expected 55000', v_pending; end if;
  if v_a_pct is distinct from '50.0' then raise exception 'FAIL: item subtotal A%% is %, expected 50.0', v_a_pct; end if;

  select total_g, a_pct into v_total, v_a_pct
  from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', null, null)
  where row_kind = 'total';
  if v_total is distinct from '155000' then raise exception 'FAIL: grand total is %, expected 155000', v_total; end if;

  -- a date outside the range returns no detail rows
  select count(*) into v_vendor_rows
  from public.veg_inward_summary(date '2026-01-11', date '2026-01-12', null, null)
  where row_kind <> 'total';
  if v_vendor_rows <> 0 then raise exception 'FAIL: date filter returned % rows outside the period', v_vendor_rows; end if;

  -- ---- guards -----------------------------------------------------------
  begin
    delete from public.veg_inward_entries where id = v_e1;
  exception when others then
    if sqlerrm like 'DELETE_BLOCKED:%' then v_delete_blocked := true; else raise; end if;
  end;
  if not v_delete_blocked then raise exception 'FAIL: hard delete was not blocked'; end if;

  begin
    insert into public.veg_inward_entries
      (id, item_id, vendor_id, received_at, total_g, a_g, b_g, dump_g, sorted_at)
    values (gen_random_uuid(), v_item, v_vendor_a, now(), 10000, 8000, 5000, 0, now());
  exception when check_violation then v_sorted_above_total_blocked := true;
  end;
  if not v_sorted_above_total_blocked then raise exception 'FAIL: sorted above total was accepted'; end if;

  begin
    insert into public.veg_inward_entries
      (id, item_id, vendor_id, received_at, total_g, a_g)
    values (gen_random_uuid(), v_item, v_vendor_a, now(), 10000, 4000);
  exception when check_violation then v_partial_grades_blocked := true;
  end;
  if not v_partial_grades_blocked then raise exception 'FAIL: a partial grade set was accepted'; end if;

  begin
    insert into public.veg_inward_vendors(name) values ('  test vendor a  ');
  exception when unique_violation then v_duplicate_vendor_blocked := true;
  end;
  if not v_duplicate_vendor_blocked then raise exception 'FAIL: the vendor name key is not unique on lower(btrim(name))'; end if;

  begin
    perform public.veg_inward_summary(date '2026-01-12', date '2026-01-10', null, null);
  exception when others then
    if sqlerrm like 'INVALID_DATE_RANGE:%' then v_bad_range_blocked := true; else raise; end if;
  end;
  if not v_bad_range_blocked then raise exception 'FAIL: a reversed date range was accepted'; end if;

  -- ---- access -----------------------------------------------------------
  if has_table_privilege('anon', 'public.veg_inward_entries', 'select')
     or has_table_privilege('anon', 'public.veg_inward_vendors', 'select')
     or has_table_privilege('anon', 'public.veg_inward_audit', 'select') then
    raise exception 'FAIL: anon can select inward tables';
  end if;
  if has_table_privilege('authenticated', 'public.veg_inward_entries', 'select')
     or has_table_privilege('authenticated', 'public.veg_inward_vendors', 'select')
     or has_table_privilege('authenticated', 'public.veg_inward_audit', 'select') then
    raise exception 'FAIL: authenticated can select inward tables';
  end if;
  if has_function_privilege('anon', 'public.veg_inward_summary(date,date,uuid,uuid)', 'execute') then
    raise exception 'FAIL: anon can execute the summary';
  end if;
  if has_function_privilege('authenticated', 'public.veg_inward_summary(date,date,uuid,uuid)', 'execute') then
    raise exception 'FAIL: authenticated can execute the summary';
  end if;
  if not has_function_privilege('service_role', 'public.veg_inward_summary(date,date,uuid,uuid)', 'execute') then
    raise exception 'FAIL: service_role cannot execute the summary';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.veg_inward_entries'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.veg_inward_vendors'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.veg_inward_audit'::regclass) then
    raise exception 'FAIL: row level security is not enabled on every inward table';
  end if;

  raise notice 'PASS: percentages, aggregation, pending isolation, vendor separation, subtotals, guards and access';
end
$test$;

-- proof of the exact numbers the test asserted (rolled back with the rest)
select row_kind, item_name, vendor_name, trips, total_g, sorted_g, a_g, b_g, dump_g,
       pending_g, unaccounted_g, a_pct, b_pct, dump_pct
from public.veg_inward_summary(date '2026-01-10', date '2026-01-10', null, null)
order by (row_kind = 'total'), item_name, (row_kind = 'vendor') desc, vendor_name;

rollback;
