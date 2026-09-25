# Inventory Changelog

## 2026-09-25 — V2 Item Master / Barcode Lookup / Import
- Separated Admin Inventory from warehouse counting. Admin Item Master no longer exposes count-session controls.
- Simplified Admin Item Master UI into one workflow: select section → scan/type barcode → Fetch Details directly beside the barcode → review/edit fields → save.
- Added server-side `admin-item-lookup` Edge Function. It validates the existing Admin session, checks linked barcodes before lookup, calls only Open Food Facts API v2, uses a custom User-Agent, 8-second timeout, cache, rate-limit handling and audit logging.
- Open Food Facts data is returned into the form automatically; Admin does not visit the Open Food Facts website. Ambiguous quantities are left for Admin completion rather than guessed.
- Added additive `inv_v2_items`, `inv_v2_item_barcodes`, `inv_barcode_lookup_cache`, and `inv_v2_audit_log` structures.
- Added one shared versioned `inv_v2_save_item` RPC for create, edit, deactivate and atomic batch import. Server validation covers normalized names, section, UOM, count mode, packet size, barcode/no-barcode rules, EAN-8/UPC-A/EAN-13 check digits and duplicate names/barcodes.
- New items mirror into the existing legacy inventory references so existing warehouse counting continues to work. Legacy inventory count tables and legacy count RPCs were not dropped.
- Added XLSX/CSV template workflow with Items + Instructions sheets, text-safe barcode handling, example-row skipping, complete preview, row errors and error CSV. Imports are atomic: invalid batches are rejected before any item is written.
- Added Edit and Deactivate actions; items are never hard-deleted. Changes are audited.
- Files: `admin/inventory.html`, `admin/inventory.js`, `admin/inventory.css`, `supabase/functions/admin-item-lookup/index.ts`, `supabase/migrations/20260925060541_inv_v2_item_master_import_lookup.sql`, `supabase/migrations/20260925060541_inv_v2_item_master_import_lookup_rollback.sql`.
- Verification performed: migration present in Supabase, V2 tables have RLS enabled, intended RPC execute grants exist, barcode check-digit helper passes 8076809571319 and rejects altered/short values, Edge Function deployed as version 3.
- Open Food Facts documentation confirms v2 remains supported for backward compatibility, requires a custom User-Agent, applies read rate limits, and describes the data as community-supplied; attribution/compliance requirements should be followed for production use.
