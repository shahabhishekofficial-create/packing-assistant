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

## 2026-09-25 — Lookup connection completed

- Deployed Supabase Edge Function admin-item-lookup v4.
- Admin lookup now validates the custom admin session server-side, checks existing linked barcodes globally, reads the cache, and otherwise fetches Open Food Facts API v2.
- Lookup uses an 8-second timeout, a custom User-Agent, rate-limit handling and cached not-found/error results.
- Product data is returned directly to the Item Master form; the Admin never needs to open Open Food Facts.
- Added barcode preflight RPC inv_v2_lookup_linked and deployed its own additive migration.
- Updated Item Master asset version to 20260925-13.
- Security advisor still reports pre-existing project-wide SECURITY DEFINER/RLS findings; no existing module was changed to address those unrelated findings.

### Verification
- Database migration applied successfully.
- Unauthorized direct call to inv_v2_lookup_linked was rejected with Unauthorized.
- Edge Function is ACTIVE (v4).
- Live Open Food Facts request could not be exercised from this environment because outbound network/DNS is unavailable; therefore real barcode lookup from the deployed function still needs one authenticated browser test.

-- END OF PART 2/2

## 2026-09-25 — Admin lookup dialog fix

- Fixed a UI state bug where the top-level Fetch Details flow opened the Item dialog and then attempted to open it a second time after a successful lookup.
- Successful lookup now populates the already-open form without throwing InvalidStateError.

## 2026-09-25 — Vegetable Item Master separated

- Vegetable Item Master now has a separate workflow from Restaurant Item Master.
- Removed barcode lookup, Open Food Facts, pack size, aliases and brand from the vegetable UI.
- Vegetable setup uses only name, category and base UOM (kg/pcs); counting mode is fixed to Unit and no-barcode is enforced server-side.
- Restaurant workflow retains barcode lookup, Open Food Facts enrichment, packet configuration, aliases and brand.
- Vegetable Import/Download Template controls are hidden because vegetables are maintained as a controlled, limited master list rather than the restaurant packaged-goods workflow.
- Added versioned `inv_v2_save_item_v3` validation wrapper and kept the existing V2 save RPC unchanged.
