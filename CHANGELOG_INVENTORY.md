# Inventory Changelog

## 2026-09-25 — V2 Item Master / Barcode Lookup / Import
- Admin inventory is now separated from warehouse counting. Admin sees Item Master only; counting is not exposed in the admin screen.
- Barcode scan is placed directly beside the Add Item workflow. Unknown scans expose Fetch Details immediately.
- Added server-side admin-item-lookup Edge Function. It validates the existing admin session, checks existing barcode links, uses Open Food Facts as the only lookup source, applies an 8-second timeout, sends a custom User-Agent, caches results, and logs lookup outcomes.
- Added additive V2 item metadata and audit tables. Existing inv_items, inv_item_barcodes, legacy count tables, and legacy RPCs are not dropped or edited.
- Added versioned item save/list RPCs with shared validation: section, normalized name, category, UOM, count mode, packet size, barcode/no-barcode rules, EAN-8/UPC-A/EAN-13 check digits, duplicate name, and duplicate barcode checks.
- New item saves mirror legacy inv_items/inv_item_barcodes records so existing warehouse counting can continue to use legacy inventory references.
- Added browser-generated XLSX template with Items and Instructions sheets, example-row skipping, row validation, preview, and error download.
- Files: admin/inventory.html, admin/inventory.js, admin/inventory.css, supabase/migrations/20260925120000_inv_v2_item_master_import_lookup.sql, supabase/functions/admin-item-lookup/index.ts.
- Verification: database schema/RPC migrations applied successfully and Edge Function deployed successfully. Open Food Facts documents custom User-Agent requirements, read rate limits, and community-data quality limitations. citeturn1view0turn1view1
- Rollback: supabase/migrations/20260925122000_inv_v2_item_master_import_lookup_rollback.sql.
