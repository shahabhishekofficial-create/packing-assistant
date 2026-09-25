-- Inventory Item Master V2 read-only verification tests.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='inv_v2_items') THEN RAISE EXCEPTION 'inv_v2_items missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='inv_v2_item_barcodes') THEN RAISE EXCEPTION 'inv_v2_item_barcodes missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='inv_v2_audit_log') THEN RAISE EXCEPTION 'inv_v2_audit_log missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='inv_barcode_lookup_cache') THEN RAISE EXCEPTION 'inv_barcode_lookup_cache missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inv_stock_counts' AND column_name='qty') THEN RAISE EXCEPTION 'legacy inv_stock_counts.qty missing'; END IF;
  IF public.inv_v2_barcode_valid('8076809571319') IS NOT TRUE THEN RAISE EXCEPTION 'known valid EAN failed'; END IF;
  IF public.inv_v2_barcode_valid('8076809571318') IS NOT FALSE THEN RAISE EXCEPTION 'bad check digit accepted'; END IF;
END $$;

SELECT 'required_v2_objects' AS test,
       (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('inv_v2_items','inv_v2_item_barcodes','inv_v2_audit_log','inv_barcode_lookup_cache')) AS object_count;

SELECT 'legacy_qty_type' AS test, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='inv_stock_counts' AND column_name='qty';

-- END OF PART 1/1
