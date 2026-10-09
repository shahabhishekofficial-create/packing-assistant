# PROJECT STATUS — Packing Assistant V2

_Last audited: 2026-10-10 (IST)_
_Repository: `shahabhishekofficial-create/packing-assistant`_
_Current branch: `main`_
_Current repository HEAD at completion of this audit: `dfa12f6bb1997274e82ec64b781660eb8628ecaf`_
_Current declared frontend build: `20261010-driverrefreshfix1`_

> **This is an honest state report, not a roadmap.**
>
> Status is based on the current GitHub `main` source, repository migration files, current Edge Function source, current service workers, recent Git history, the existing project audit/master records, and the implementation work recorded in this project.
>
> **Important verification boundary:** this audit environment cannot independently operate every production browser/device flow or inspect every live Supabase object with production credentials. Therefore a feature is not upgraded to “fully working” merely because code exists. Where production verification is not evidenced, the status is deliberately conservative.

---

# 1. EXECUTIVE STATE

## Overall

The project is **a substantial working multi-surface operations system, but not a cleanly finished production product**.

The core packing flow, driver delivery flow, admin operations, restaurant inventory, vegetable inventory, reporting, payments, and PWA infrastructure all exist in code. However, they have been built through many incremental fixes and migrations. The current system contains:

- a mature packing workflow;
- a separate admin PWA;
- a separate driver PWA;
- a separate warehouse/restaurant inventory counting surface;
- a separate vegetable inventory counting surface;
- admin inventory-master pages;
- a large monolithic shared packing/admin JavaScript file;
- a privileged Supabase Edge Function for driver operations;
- a layered Supabase schema with legacy + V2 inventory structures;
- many additive security, delivery, payment, and inventory migrations;
- aggressive service-worker/build-cache management;
- several areas that are UI-only or explicitly not implemented.

The biggest current risk is **not lack of features**. It is **system complexity and regression risk**.

The repository contains a large amount of recent October work, including repeated cache/build publication commits and repeated driver-flow fixes. That means the current state should be treated as a fragile integration point, not as a stable baseline.

## Current status by major surface

| Surface | Current status | Honest interpretation |
|---|---|---|
| Main Packing Assistant | **Partially working** | Core workflow is implemented and substantially complete in code, but current production behavior is not fully re-verified in this audit |
| Admin Operations Dashboard | **Partially working** | Large functional dashboard exists; many live KPIs/actions depend on multiple RPCs and delivery state |
| Admin Packing & Dispatch | **Partially working** | Packing overview, outlet selection and admin packing controls exist; recently modified |
| Delivery & Fleet | **Partially working** | Extensive functionality exists; many October fixes indicate this area has been actively fragile |
| Driver PWA | **Partially working** | Login, route, invoice, rejection, camera, delivery, ledger and payment features exist; recent fixes were substantial |
| Restaurant Inventory Admin | **Partially working** | Item master, barcode, lookup, template import, stock view, adjustments and exports exist |
| Restaurant Inventory Staff | **Partially working** | Staff counting, barcode/manual search, sessions, offline queue and exports exist; production end-to-end verification is incomplete |
| Vegetable Inventory Admin | **Partially working** | Master, translations, reports and count corrections exist |
| Vegetable Inventory Staff | **Partially working** | Passwordless/guest startup and counting flow exist; latest boot fix still required live verification |
| Reports & Analytics | **Partially working** | Historical reports and delivery/packing analytics exist, but several report paths are dependent on current schema/RPC state |
| Manage Team | **Partially working** | Driver/warehouse-staff credential management exists; UI is embedded in admin and depends on several credential/audit RPCs |
| Settings / Configuration | **Partially working** | App configuration RPC + local defaults + maintenance mode exist; not a complete general settings system |
| Purchase & Suppliers | **UI only / no backend** | Appears as an operational section/placeholder; no implemented supplier purchasing system was found |
| Employees & HR | **UI only / no backend** | Appears as a future/admin section; no complete employee/HR backend was found |
| PWA / update system | **Partially working** | Three service-worker surfaces + version/build guard exist; cache management is a recurring source of complexity |
| Operations Audit | **Partially working** | Audit table/RPCs exist and recent fixes addressed audit permissions/operations |
| Payment/Fleet ledger | **Partially working** | Opening balances, payouts, proof, confirmation and ledger exist; recently modified and therefore high-risk |
| OCR | **Partially working** | Tesseract-based invoice OCR exists and reports verification/mismatch to backend; accuracy/provider behavior is not independently certified |
| Documentation | **Partially working** | `PROJECT_MASTER.md` is useful but was stale relative to hundreds of later commits; this file is intended to become the current state report |

---

# 2. ARCHITECTURE — EVERY CURRENT SURFACE

## 2.1 Hosting and infrastructure

### Frontend hosting

All frontend surfaces are static files deployed through **GitHub Pages** from the repository `main` branch.

GitHub Actions workflow:

`.github/workflows/pages.yml`

The workflow:

1. checks out `main`;
2. runs JavaScript syntax checks;
3. runs Deno type/syntax validation for `driver-api`;
4. uploads the repository root as a Pages artifact;
5. deploys GitHub Pages.

A second workflow, `.github/workflows/validate-js.yml`, performs JavaScript and Edge Function checks on push/PR.

### Backend

Backend/database is **Supabase**.

Configured project:

- Supabase URL: `https://pbhkuofylhqcqmspubmb.supabase.co`
- project ref: `pbhkuofylhqcqmspubmb`
- region recorded by the existing project documentation: `ap-south-1`

The browser uses the Supabase publishable key from `config.js`.

Privileged driver operations are routed through:

`supabase/functions/driver-api/index.ts`

The Edge Function uses privileged server-side access and must remain the boundary for operations that require service-role privileges.

---

## 2.2 Surface: Main Packing Assistant

### Entry files

- `index.html`
- `app.js`
- `styles.css`
- `config.js`
- `update.js`
- root `sw.js`
- root `manifest.webmanifest`

### Business purpose

Warehouse packers import the latest restaurant order, open outlets on phones, and pack items while the application narrates product names/quantities.

### Communication

Browser → Supabase client → packing RPCs / Realtime / database.

The app also uses:

- Supabase Realtime for outlet/item changes;
- fallback polling;
- browser speech synthesis;
- localStorage for device/voice preferences;
- service worker for PWA behavior.

### Current implementation

Implemented code includes:

- dynamic Excel/CSV import;
- header detection;
- live order creation;
- multi-device order access;
- device identity;
- atomic outlet locking;
- PACKED / PARTIAL / MISSING;
- required = packed + missing validation;
- automatic outlet/order completion;
- packing event/audit behavior;
- narration rank;
- English product name + selectable quantity language;
- Hindi/Gujarati number narration;
- repeat narration;
- report download;
- historical reports;
- delivery/admin visibility.

### Current risk

`app.js` is approximately 156 KB and contains a very large number of responsibilities. It is one of the highest-regression-risk files in the project.

---

## 2.3 Surface: Admin PWA

### Entry files

- `admin.html`
- `admin/index.html`
- `admin/auth.js`
- `admin/team.js`
- `admin/sw.js`
- shared `app.js`
- shared/configuration assets

### Business purpose

Admin is the control center for packing, dispatch, delivery/fleet, inventory, reports, team management and configuration.

### Authentication

Admin authentication is session-based and uses Supabase RPCs including:

- `create_admin_session`
- `verify_admin_session`
- `revoke_admin_session`
- `verify_admin_password`
- `change_admin_password`

Admin session behavior is implemented in `admin/auth.js`.

---

## 2.4 Admin surface: Operations Dashboard / Command Center

### Current UI

`admin/index.html` contains:

- Operations Overview;
- attention/exception area;
- driver readiness;
- outlet attention;
- inventory pulse;
- delivery pulse;
- quick actions;
- driver payments/balances;
- driver dashboard;
- configuration;
- packing overview.

### Business purpose

Give management a single operational view of what is packed, pending, delivered, exceptional, financially outstanding, or needing attention.

### Status

**Partially working.**

The UI and substantial backend wiring exist, but this surface aggregates many independent systems. A failure in one RPC/config/session path can leave an individual panel empty even if the rest of the dashboard is operational.

---

## 2.5 Admin surface: Packing & Dispatch

### Files

Primarily:

- `admin/index.html`
- `app.js`

### Business purpose

Admin can inspect the current live order, see packing progress, choose outlets, configure outlet rank/driver/charge, and — after recent October work — perform admin item packing controls from the packing overview.

### Status

**Partially working.**

### Recent state

Recent commits explicitly added:

- admin item packing controls;
- admin mark-packed actions;
- packing overview refinements.

This means the area is actively changing and should not be considered frozen.

---

## 2.6 Admin surface: Delivery & Fleet

### Files

Primarily:

- `admin/index.html`
- `app.js`
- `admin/auth.js`
- `supabase/functions/driver-api/index.ts`
- delivery/financial migrations

### Business purpose

Manage drivers, routes, delivered outlets, exceptions, earnings, payouts, payment proof, balances and historical delivery transactions.

### Status

**Partially working / high risk.**

### Implemented capabilities

- driver dashboard;
- current route;
- live/unassigned workload;
- delivery exceptions;
- historical delivery transactions;
- driver balances;
- opening balances;
- single driver payout;
- bulk payout;
- payment proof;
- driver ledger;
- payment confirmation state;
- historical delivery charge adjustment;
- delivery invoice requirements;
- delivery event idempotency;
- admin delivery approval.

### Why not fully working

The Git history shows an unusually high concentration of fixes in this area on 2026-10-07:

- delivered outlet workflow lock;
- stale dialog fixes;
- rejection step gating;
- keeping outlet open between delivery steps;
- login recovery;
- logout recovery;
- camera startup/fallback;
- payment modal layout/scroll;
- payment proof persistence;
- driver balance/ledger changes;
- multiple cache/build republish operations.

The code is therefore extensive, but the area is demonstrably still under active stabilization.

---

# 3. DRIVER PWA

## Files

- `driver/index.html`
- `driver/driver.js`
- `driver/driver-ux-v2.js`
- `driver/driver-ux-v2.css`
- `driver/sw.js`
- `driver/manifest.json`
- `driver/manifest.webmanifest`
- shared `config.js`
- Supabase Edge Function `driver-api`

## Business purpose

Driver receives assigned outlets, follows the delivery workflow, uploads invoice evidence, records item-level rejection, uploads damage evidence, marks delivery, and manages payment ledger/confirmation.

## Current status

**Partially working.**

## Implemented

- login;
- logout;
- session recovery;
- assigned route;
- outlet cards;
- progressive dashboard loading;
- invoice number;
- invoice image/camera;
- invoice OCR;
- rejection workflow;
- MISSING/DAMAGE;
- damage photo;
- native camera fallback;
- rejection confirmation;
- delivery completion;
- earnings;
- ledger;
- payment password;
- payment confirmation.

## Current known risks

1. The driver surface has had many consecutive fixes in one day.
2. `driver.js` remains large.
3. `driver-ux-v2.js` is an additional behavior layer on top of `driver.js`.
4. Service-worker/cache/build versions have been repeatedly changed.
5. Camera behavior depends on browser/device permissions.
6. OCR depends on Tesseract.js and image quality.
7. Privileged actions depend on the `driver-api` Edge Function.
8. A successful login and a successful dashboard load are deliberately treated as separate states after a recent recovery fix.

### OCR reality

Invoice OCR is not a magical invoice-recognition service. The current client code invokes Tesseract.js in English mode, extracts numeric candidates, compares the entered invoice number, and sends the OCR result to the Edge Function.

Therefore:

- OCR is implemented;
- OCR mismatch detection is implemented;
- OCR accuracy is dependent on image quality/Tesseract/browser performance;
- it is not safe to describe OCR as 100% reliable.

---

# 4. WAREHOUSE / RESTAURANT INVENTORY STAFF SURFACE

## Files

- `inventory-count.html`
- `inventory-count.js`
- root `sw.js`
- `manifest.webmanifest`

## Business purpose

Warehouse staff count restaurant inventory by barcode or search, enter physical quantity, save counts, and export results.

## Implemented

- barcode scan;
- manual search;
- item selection;
- count entry;
- UOM/count-unit conversion;
- staff sessions;
- passwordless/guest path where configured;
- offline queue;
- retry/flush;
- Excel export;
- PDF export;
- report submission;
- session lifecycle.

## Status

**Partially working.**

The feature is substantially implemented, but the current audit does not have independent live staff-device verification for every path.

---

# 5. RESTAURANT INVENTORY ADMIN

## Files

- `admin/inventory.html`
- `admin/inventory.js`
- `admin/inventory.css`
- `admin/inventory-nav.js`
- `admin/inventory-sample.csv`

## Business purpose

Admin maintains the restaurant item master and monitors/adjusts stock.

## Implemented UI

- Restaurant Inventory;
- barcode scanner;
- available inventory;
- inventory changes;
- restaurant item list;
- import preview;
- change available quantity;
- add restaurant item;
- barcode lookup;
- categories;
- aliases;
- brand;
- shelf/rack;
- pack/count unit;
- no-barcode handling;
- stock PDF export;
- CSV/template download.

## Template import

The October 5 migration adds `inv_v2_import_restaurant_template_v1`.

The intended model is template-driven: item master contains packaging/counting attributes so staff does not repeatedly choose packing metadata during counting.

## Status

**Partially working.**

The backend contract exists and is more advanced than the older inventory documentation. It still depends on both legacy `inv_*` and `inv_v2_*` tables.

---

# 6. VEGETABLE INVENTORY — ADMIN

## Files

- `admin/vegetable-inventory.html`
- `admin/vegetable-inventory.js`
- `admin/vegetable-inventory.css`

## Business purpose

Admin manages vegetable item names/translations, active state, count reports and corrections. Admin does not perform the normal warehouse count.

## Implemented

- vegetable master;
- English/Hindi/Gujarati names;
- activate/deactivate;
- CSV import/export;
- report filters;
- grade filters;
- session filters;
- count correction;
- correction reason;
- report export.

## Status

**Partially working.**

A recent boot fix addressed the Vegetable Inventory startup/null-element problem, but the project audit record explicitly says production browser verification was still pending for that optimization item.

---

# 7. VEGETABLE INVENTORY — WAREHOUSE STAFF

## Files

- `vegetable-inventory.html`
- `vegetable-inventory.js`
- `vegetable-inventory.css`

## Business purpose

Warehouse staff counts in-hand vegetables. This is a counting module, not an inward/GRN receiving module.

## Implemented

- passwordless/guest startup;
- vegetable item list;
- English/Hindi/Gujarati readability;
- item search;
- grade selection;
- weight entry;
- count session;
- submitted report;
- PDF report;
- share/export flow.

## Important scope

The intended scope is **in-hand inventory counting only**.

Inward/GRN receiving is not part of this module.

## Status

**Partially working.**

The latest known boot fix:

- added DOM preflight;
- removed stale-session startup branching;
- consolidated guest-session startup;
- added safer startup error handling;
- bumped inventory build/cache from nologin7 to nologin8.

Code fix was recorded as successful, but live deployment/browser verification was explicitly pending.

---

# 8. REPORTS & ANALYTICS

## Where it lives

Mostly embedded in the admin dashboard and shared `app.js`.

## Business purpose

Historical visibility into packing, delivery, invoice and charge activity.

## Implemented paths

- order history;
- historical report data;
- delivery transaction history;
- delivery analytics;
- exception reporting;
- driver performance;
- fleet ledger export;
- vegetable inventory reports;
- restaurant inventory stock/export.

## Status

**Partially working.**

Reason:

Reports are implemented but are highly dependent on current RPC/table contracts. The project has both historical report RPCs and newer delivery analytics/audit RPCs, so report consistency must be verified rather than assumed.

---

# 9. MANAGE TEAM

## Where it lives

Admin dashboard → Manage Team.

## Files

- `admin/index.html`
- `admin/team.js`
- inventory/team RPC migrations

## Business purpose

Manage driver and warehouse staff credentials/active status and associated credential audit behavior.

## Implemented

- add team member dialog;
- driver login/PIN fields;
- warehouse staff credential fields;
- payment-related driver setting;
- active/inactive management;
- credential audit trail;
- inventory staff status;
- staff session revocation.

## Status

**Partially working.**

The backend has evolved considerably, including login-ID and passwordless/session hardening. The surface is functional in code but not independently live-verified end-to-end here.

---

# 10. SETTINGS / CONFIGURATION

## Files

- `config.js`
- `admin/index.html`
- `supabase/functions/admin-config/index.ts`
- `20260924200728_add_app_configuration_v1.sql`

## Business purpose

Centralize feature toggles and system-wide operational configuration.

## Current configuration keys include

- driver invoice gallery upload;
- invoice number required;
- invoice photo required;
- short rejection;
- damage rejection;
- damage photo required;
- rejection confirmation;
- packing voice narration;
- auto advance;
- partial packing;
- missing marking;
- completed outlet visibility;
- barcode scanning;
- manual search;
- offline mode;
- recount;
- update notifications;
- dashboard auto refresh;
- maintenance mode.

## Status

**Partially working.**

There is a real backend configuration system, but this is not a general-purpose settings framework. It is primarily a controlled feature-flag/configuration layer.

---

# 11. PURCHASE & SUPPLIERS

## Status

**UI only / no backend.**

The admin navigation includes this as a future/soon area, but no complete supplier purchase workflow, supplier tables, purchase-order tables, receiving workflow or corresponding operational RPC system was found in the current repository architecture.

## What would happen today

A user can see/navigate to the area or its placeholder, but should not expect a complete procurement system.

---

# 12. EMPLOYEES & HR

## Status

**UI only / no backend.**

The admin navigation includes Employees & HR as a future operational area.

A complete employee master, attendance/payroll/leave/HR database workflow was not found in the current repository.

## What would happen today

The user can see the planned area, but it is not an implemented HR module.

---

# 13. PWA / UPDATE SYSTEM

## Three independent PWA surfaces

1. Main packer PWA — root `sw.js`
2. Admin PWA — `admin/sw.js`
3. Driver PWA — `driver/sw.js`

## Supporting files

- manifests;
- `version.json`;
- `update.js`;
- service workers;
- cache-busting query parameters.

## Current declared build

`20261008-deliveryflow10`

## Status

**Partially working / fragile.**

The infrastructure exists and has recently been heavily modified.

### Important current mismatch

Root and driver service workers use the declared `20261008-deliveryflow10` build.

The admin service worker currently declares:

`20261007-fleet-ledger-redesign`

However, admin service worker fetch handling uses `cache: "no-store"` and deletes its admin cache namespace on activation. This reduces, but does not eliminate, cache/version risk.

### Main risk

The project has generated many build/cache bump commits. Cache management is now part of the product architecture and must be handled deliberately with every frontend change.

---

# 14. DATABASE — CURRENT TABLE INVENTORY

The database has multiple generations of schema. Do **not** assume the repository contains one clean baseline schema.

## 14.1 Core packing tables

| Table | Purpose | Main dependencies / risk |
|---|---|---|
| `orders` | Top-level live packing order | Parent of outlets/order_items; delivery and reports depend on order identity |
| `outlets` | Store-level workload, locking, rank, driver and delivery charge | Central join point for packing, driver delivery, route, charge and reporting |
| `order_items` | SKU-level required/packed/missing state | Depends on orders/outlets; used by packing, driver exceptions and reports |
| `packing_events` | Packing audit/event history | Depends on order/outlet/item; reports/history may depend on it |
| `product_voice` | Reusable product-specific narration text | Used by packing voice flow |
| `drivers` | Legacy/simple driver master | Still referenced by team/admin/inventory credential workflows |
| `admin_settings` | Legacy/singleton admin password storage | Admin authentication legacy dependency |
| `admin_sessions` | Admin session tokens/state | Admin auth and privileged RPCs depend on it |

### Highest-risk core table

**`outlets` is the most cross-module table.**

Changing its driver, delivery, status, locking or identity fields can affect:

- packing;
- admin dashboard;
- driver route;
- delivery completion;
- delivery charges;
- financial reporting;
- fleet analytics;
- invoice/rejection workflows.

Do not modify it casually.

---

## 14.2 Driver/delivery tables

| Table | Purpose | Main dependencies / risk |
|---|---|---|
| `driver_accounts` | Secure driver login and payment-password data | Driver login, team management, driver API |
| `driver_sessions` | Driver session token hashes/expiry | Driver authentication and every privileged driver action |
| `delivery_records` | Outlet delivery lifecycle and evidence | Driver workflow, invoice/rejection, admin delivery dashboard |
| `delivery_events` | Idempotent delivery event history | Delivery transition logic |
| `driver_payments` | Driver payout ledger | Fleet/payment dashboard, driver ledger |
| `driver_opening_balances` | Opening balance for driver ledger | Fleet balances and financial calculations |
| `driver_ledger_entries` | Financial ledger/event representation | Delivery financials and driver balance calculations |
| `outlet_driver_defaults` | Default driver configuration | Outlet/driver assignment behavior |
| `outlet_delivery_charge_defaults` | Default delivery charges | Outlet setup and charge logic |
| `operations_audit_v1` | Operational audit trail | Admin audit/diagnostics |
| `invoice_outlet_name_map` | Invoice/outlet-name reconciliation mapping | Driver invoice/OCR/reconciliation logic; referenced by current Edge Function |

### Important

Some of these objects originated in migrations that are no longer present as a complete historical baseline in this repository. The live Supabase schema therefore remains an important source of truth.

---

## 14.3 Configuration/audit tables

| Table | Purpose |
|---|---|
| `app_config_v1` | Feature/configuration values |
| `app_config_audit_v1` | Configuration change audit |
| `operations_audit_v1` | Operational audit |
| `team_credential_audit` | Credential/team-member changes |

These are cross-cutting tables. They should not be repurposed for feature data.

---

## 14.4 Legacy inventory tables

| Table | Purpose | Risk |
|---|---|---|
| `inv_items` | Legacy/base inventory item master | Still referenced by V2 inventory as a compatibility parent |
| `inv_item_barcodes` | Legacy barcode mapping | V2 import writes to it as well |
| `inv_count_sessions` | Legacy restaurant inventory count sessions | Existing staff counting/report paths may depend on it |
| `inv_stock_counts` | Legacy inventory count rows | Explicitly preserved; `qty` is legacy and must not be casually changed |

### Critical rule

The inventory V2 design is additive. It did **not** replace the legacy tables cleanly.

---

## 14.5 Restaurant Inventory V2 tables

| Table | Purpose | Main dependencies |
|---|---|---|
| `inv_v2_items` | Current richer inventory item master | References `inv_items` via `legacy_item_id` |
| `inv_v2_item_barcodes` | V2 barcode mapping | References `inv_v2_items` |
| `inv_barcode_lookup_cache` | Cached external barcode lookup result | Used by barcode lookup/admin item enrichment |
| `inv_v2_audit_log` | Inventory V2 audit | Item/import/barcode changes |

### Important V2 fields

Current V2 model includes:

- section;
- name;
- normalized name;
- aliases;
- category;
- base UOM;
- count mode;
- default pack size;
- count unit;
- conversion factor;
- no-barcode;
- brand;
- active;
- storage shelf/rack.

### Important dependency

`inv_v2_items.legacy_item_id → inv_items.id`

Therefore deleting/reworking the legacy item table can break V2 inventory.

---

## 14.6 Inventory staff tables

| Table | Purpose |
|---|---|
| `inv_staff_users` | Warehouse staff identity/status/failed attempts |
| `inv_staff_sessions` | Warehouse staff sessions |
| `inv_vegetable_count_sessions` | Vegetable counting session |
| `inv_vegetable_items` | Vegetable master |
| `inv_vegetable_counts` | Vegetable count entries |
| `inv_vegetable_count_corrections` | Admin correction layer over vegetable counts |

### Important

Vegetable correction is additive. The original count row remains; correction data is stored separately.

---

# 15. DATABASE RPC / EDGE FUNCTION DEPENDENCY MAP

## Packing

Main client `app.js` calls:

- `get_order`
- `get_current_order`
- `get_outlet_delivery_charges`
- `get_order_history`
- `get_report_data`
- `update_outlet_settings_v2`
- `update_outlet_delivery_charge`
- `claim_outlet`
- `update_item_status`
- `release_outlet`
- `admin_get_operations_audit_v1`

Packing creation also relies on order-creation RPC infrastructure.

## Driver

The browser should primarily communicate through:

`supabase/functions/driver-api/index.ts`

Current Edge Function invokes/coordinates functions including:

- `driver_login`
- `driver_session_info`
- `order_session_info`
- `get_driver_dashboard`
- `get_driver_dashboard_page`
- `driver_invoice_target`
- `save_driver_item_rejections_v2`
- `delivery_transition_v2`
- `mark_exception_item_packed`
- payment/ledger RPCs;
- admin delivery financial RPCs.

## Restaurant inventory

Admin inventory JS calls:

- `inv_v2_get_categories`
- `inv_v2_add_category`
- `inv_v2_get_items_v5`
- `inv_get_items`
- `inv_v2_save_item_v5`
- `inv_v2_lookup_linked`
- `inv_v2_import_restaurant_template_v1`
- `inv_admin_get_inventory`
- `inv_admin_get_inventory_log`
- `inv_admin_adjust_available_qty`

## Restaurant staff

Staff counting calls:

- `inv_inventory_guest_session`
- `inv_staff_start_session`
- `inv_staff_get_items`
- `inv_staff_save_count`
- `inv_staff_get_session_report`
- `inv_staff_submit_session`

## Vegetable staff

Calls include:

- `inv_inventory_guest_session`
- `inv_veg_staff_start_session`
- `inv_veg_staff_get_items`
- `inv_veg_staff_save_count`
- `inv_veg_staff_get_submitted_report`
- `inv_veg_staff_submit_session`

## Vegetable admin

Calls include:

- `inv_veg_admin_get_items`
- `inv_veg_admin_save_item`
- `inv_veg_admin_set_active`
- `inv_veg_admin_report`
- `inv_veg_admin_correct_count`

---

# 16. KNOWN TECHNICAL DEBT / FRAGILITY

## T1 — Monolithic `app.js`

Approximate current size: 156 KB.

It contains:

- packing;
- voice;
- admin dashboard;
- delivery dashboard;
- fleet;
- reports;
- configuration;
- packing overview;
- historical delivery;
- outlet settings;
- admin packing;
- various UI helpers.

**Risk:** a small change in one area can affect another because the same file owns many global behaviors.

---

## T2 — Driver has two behavior layers

Driver uses:

- `driver.js`
- `driver-ux-v2.js`
- `driver-ux-v2.css`

**Risk:** UI behavior can be implemented in both the base driver code and the UX layer. Future changes must determine which layer actually owns the behavior before editing.

---

## T3 — Legacy + V2 inventory coexist

The V2 item master is explicitly linked to the legacy item master.

**Risk:** deleting/renaming/migrating one layer without the other can create inconsistent item/barcode records.

---

## T4 — Historical migration baseline is incomplete

The repository contains many current migrations, but the current `main` tree does not contain every old migration referenced by `PROJECT_MASTER.md`.

**Risk:** a clean database rebuild cannot safely be inferred from the current repository alone.

---

## T5 — Current `PROJECT_MASTER.md` became stale

The master document was last described as verified around 2026-10-01, but current `main` is hundreds of commits newer.

The current repository is ahead of the October 1 master audit by **532 commits**.

Verified baseline SHA: `6c99d7f39e00903d23d9e1d97fe535077180b4d8`.
Verified `main` before Item 2: `2dd4d68dfef43da52ef551dbe42a9b4776f14e5c`.
The reproducible comparison reports `ahead_by: 532`.

This is a major documentation-control problem.

This file is intended to close that gap.

---

## T6 — Build/cache churn

The Git history contains many repeated:

- build bumps;
- service-worker bumps;
- cache refreshes;
- force-refresh commits.

**Risk:** cache changes can mask or create apparent application bugs and make it difficult to determine whether a user is actually running current code.

---

## T7 — UI/runtime defensive fixes are still being added

Recent commits include fixes for:

- driver login binding;
- driver logout binding;
- camera initialization;
- rejection flow;
- stale dialogs;
- delivered-state locks;
- payout modal visibility;
- payout modal scrolling.

This suggests runtime initialization and modal/state ownership are still fragile.

---

## T8 — Production verification gap

Code can pass:

- Node syntax check;
- Deno check;
- GitHub Actions;

without proving:

- Supabase RPC permissions;
- real RLS behavior;
- storage signed uploads;
- mobile camera permissions;
- browser voice availability;
- service-worker upgrade behavior;
- multi-device concurrency.

These require actual integration testing.

---

## T9 — Configuration is split between defaults and server state

`config.js` contains local defaults and cached state, while `admin-config` provides server values.

**Risk:** configuration changes can behave differently during network failure/offline startup.

---

## T10 — External dependencies

The application depends on CDN-hosted libraries such as:

- Supabase JS;
- SheetJS;
- Tesseract.js.

**Risk:** third-party CDN availability/version changes can affect application behavior independently of repository code.

---

## T11 — Financial logic is distributed

Driver financial behavior spans:

- `driver_payments`;
- `driver_opening_balances`;
- `driver_ledger_entries`;
- `delivery_records`;
- delivery charges;
- Edge Function;
- admin UI.

**Risk:** changing one calculation or date rule can change balances elsewhere.

---

## T12 — Admin delivery and driver delivery share state but not the same UI code path

Admin delivery controls are mostly in shared `app.js`.

Driver delivery controls are mostly in `driver.js` + Edge Function.

**Risk:** business rules can drift between admin and driver behavior.

---

## T13 — Table/API contract is not centrally generated

There is no single generated schema/API contract checked against every frontend call.

**Risk:** RPC renames/signature changes can compile successfully but fail at runtime.

---

## T14 — UI contains many historical fix selectors/classes

The current admin HTML contains IDs/classes associated with many prior fixes.

**Risk:** removing an apparently unused element may break an old script path.

---

# 17. CURRENT KNOWN BUGS / INCOMPLETE ITEMS

This is intentionally conservative.

## Confirmed / recently recorded

### A. Vegetable Inventory startup

The remaining OPT-001 boot issue was fixed in code.

Fix included:

- DOM preflight;
- exact missing-ID error reporting;
- controlled guest-session startup;
- safe workspace hiding on failure;
- build/cache bump nologin7 → nologin8.

**Code status: SUCCESS.**
**Production/live-browser verification: previously pending.**

---

### B. Driver camera flow

The repository contains recent fixes for:

- invoice camera startup;
- native camera fallback;
- tap capture;
- damage camera;
- damage evidence persistence;
- rejection photo upload;
- camera-safe build.

**Status: implemented, but not considered fully verified solely from code.**

---

### C. Driver login/logout startup

Recent fixes explicitly made login/logout bindings resilient to initialization failures.

**Status: implemented.**

---

### D. Driver delivery step continuity

Recent code keeps the driver outlet open between workflow steps rather than prematurely returning to the outlet list.

**Status: implemented.**

---

### E. Admin payout modal

Recent work addressed:

- modal viewport position;
- internal scrolling;
- closed-dialog visibility;
- cache refresh;
- proof persistence.

**Status: implemented, but high regression risk.**

---

### F. Service-worker version alignment — 2026-10-09

The admin service worker was aligned from build `20261007-fleet-ledger-redesign` to `20261008-deliveryflow10`.

- Only `admin/sw.js` changed.
- Cache invalidation logic was unchanged.
- Commit: `bcd196271ba10a621480aaf11cd64dfcdeffc28e`

**Status: Fully working** for the approved version-string change; repository diff verified as exactly one line changed.

---

### G. Item 1 commit-count verification — 2026-10-09

The October 1 audit baseline was verified as `6c99d7f39e00903d23d9e1d97fe535077180b4d8`.

The verified comparison to `main` reported:

- `ahead_by: 532`
- `behind_by: 0`
- `total_commits: 532`

The previous **529** claim was incorrect.

---

### H. Live-verification pass — 2026-10-09

The requested live verification was attempted against the deployed GitHub Pages URLs. The available browser/web endpoint and runtime network environment could not access the deployed Pages site, so no false live-device result is recorded.

**Vegetable Inventory startup — Partially working**

- Current source contains the nologin8 defensive boot path, required-DOM preflight, controlled guest session startup, workspace hiding on failure, and explicit startup error.
- Live deployed startup could not be executed in this environment.

**Driver camera flow — Partially working**

- Current source contains invoice camera UI, native/gallery fallback, damage camera, capture handlers, and evidence upload paths.
- Physical camera permission, tap capture, and actual evidence upload could not be verified here.

**Driver invoice OCR — Partially working**

- Current source contains Tesseract.js v5 integration and invoice-number OCR/mismatch handling.
- A live browser OCR run against a sample invoice image could not be executed here; no sample invoice image was available for an actual run.

**Restaurant Inventory staff counting — Partially working**

- Current source contains manual name/barcode search, BarcodeDetector camera scanning, quantity save, IndexedDB offline queue, automatic online flush, and submit gating.
- Live barcode-camera behavior and true offline/airplane-mode queue synchronization could not be verified here.

No application source, database schema, RPC, or service-worker logic was changed as part of this verification pass.

#### Phone verification checklist

1. **Vegetable Inventory startup**
   - Open the Vegetable Inventory PWA on the phone in a normal browser session.
   - Expected first screen: `Vegetable Inventory` → `In-hand counting` → `Quick count`.
   - Expected: staff name and today's date appear; `Session open` is shown; vegetable search/list loads.
   - PASS: no blank page, no startup error, no missing-element error, and the search field is usable.
   - FAIL: blank page, `Vegetable Inventory page is incomplete...`, `Inventory access could not start`, or the workspace never appears.

2. **Driver invoice camera**
   - Open Driver PWA → log in → open an assigned outlet.
   - Start the invoice step and reach `Scan Invoice`.
   - Tap the camera capture control.
   - PASS: camera preview opens, permission prompt appears if needed, live video is visible, capture completes, and the invoice preview/processing step appears.
   - FAIL: permission is repeatedly requested, preview remains black, capture button stays disabled, or capture returns to the previous screen without an image.

3. **Driver invoice gallery fallback**
   - In `Scan Invoice`, tap `Choose from gallery`.
   - Select an invoice image.
   - PASS: selected image enters the same invoice-processing/verification path as camera capture.
   - FAIL: gallery selection does nothing, wrong outlet/invoice context is used, or the workflow resets.

4. **Driver damage camera**
   - Create/enter a rejection requiring damage evidence.
   - Reach `Take damage photo` → allow camera → frame the damaged item.
   - Tap the capture button.
   - PASS: photo is captured and the workflow proceeds to upload/save evidence; the outlet remains in the rejection workflow.
   - FAIL: camera does not start, capture does nothing, upload fails, or the app incorrectly returns to the outlet list.

5. **Driver damage gallery fallback**
   - From `Take damage photo`, tap `Choose photo`.
   - Select a damage image.
   - PASS: image is uploaded/saved as damage evidence for the correct outlet and rejected item.
   - FAIL: no upload, wrong item/outlet association, or evidence is lost after leaving the dialog.

6. **Driver invoice OCR — match**
   - Use a clear invoice whose numeric invoice number is known.
   - Enter the numeric invoice number in `Enter invoice number`.
   - Capture/upload the same invoice.
   - PASS: OCR extracts a matching numeric candidate and the result is recorded as a match/no-mismatch result.
   - FAIL: the correct number is consistently missed on a clear image or the result is associated with the wrong invoice.

7. **Driver invoice OCR — mismatch**
   - Enter a deliberately different numeric invoice number from the number printed on the test invoice.
   - Upload/capture that invoice.
   - PASS: OCR detects the printed number and records a mismatch/flag without falsely treating it as a match.
   - FAIL: mismatch is silently treated as a match or the OCR result is not recorded.

8. **Restaurant Inventory manual search/count**
   - Open Restaurant Inventory staff → `Start Count` → `Restaurant Grocery`.
   - In `Find an item`, search by item name.
   - Select an item, enter a physical count, tap `Save Count`.
   - PASS: saved confirmation appears with the correct count/unit and the item remains associated with the current session.
   - FAIL: item cannot be found, save errors, wrong quantity/unit is displayed, or the count disappears.

9. **Restaurant Inventory barcode scan**
   - Tap `Scan` beside the search field.
   - Allow camera permission.
   - Point at a supported EAN/UPC barcode and tap `Scan barcode`.
   - PASS: barcode is detected, the matching item is selected, and its count-entry field becomes active.
   - FAIL: camera cannot start, barcode is detected but no matching item is selected, or scan closes without result.

10. **Restaurant Inventory offline queue**
    - Start a count session and select an item.
    - Turn on Airplane Mode before tapping `Save Count`.
    - Enter a valid quantity and tap `Save Count`.
    - PASS: UI says `Saved offline. It will sync automatically when connection returns.` and the count is retained locally.
    - Re-enable network; wait for automatic sync, then reopen/refresh the session.
    - PASS: the queued count appears in the server session/report and is not duplicated.
    - FAIL: count is lost, never synchronizes, duplicates, or submit incorrectly reports pending data.

11. **Restaurant Inventory submit gate**
    - With a queued offline count still pending, tap `Submit Count` before synchronization completes.
    - PASS: submission is blocked with a message that offline counts are still syncing.
    - After synchronization completes, tap `Submit Count` again.
    - PASS: `Count submitted successfully.` appears and the export card becomes available.

This verification section intentionally does not upgrade any of the four flagged workflows to `Fully working` without the missing live/device evidence.
---

# 18. RECENT HISTORY — LAST ~10–15 DEVELOPMENT WORKSTREAMS

This section intentionally groups repetitive build/cache commits into the underlying workstream so the history is useful rather than listing hundreds of mechanically similar commits.

## 1. Driver camera/rejection evidence stabilization — 2026-10-07

Work included:

- reliable damage-photo camera UI;
- native fallback;
- evidence bucket/persistence verification;
- rejection-photo action fix;
- invoice camera tap capture;
- gallery fallback;
- camera-safe build;
- permanent driver control bridge.

This was not a single trivial fix; it involved both frontend and backend/storage paths.

---

## 2. Driver delivery workflow state fixes — 2026-10-07

Work included:

- delivered outlet lock;
- stale dialog handling;
- rejection step gating;
- keeping outlet open between delivery steps;
- step continuity fixes.

The repeated changes show that delivery state transitions were previously fragile.

---

## 3. Driver login/logout resilience — 2026-10-07

Work included:

- resilient login binding;
- resilient logout binding;
- preventing a successful login from being invalidated merely because dashboard loading failed;
- repeated build/cache publication.

---

## 4. Driver payout/ledger UI stabilization — 2026-10-07

Work included:

- payout modal viewport positioning;
- deterministic modal height/scroll;
- closed modal visibility;
- payment proof persistence;
- cache refresh.

---

## 5. Admin packing controls — 2026-10-07

Work included:

- packing overview item controls;
- admin mark-packed actions.

This expanded admin authority over the packing workflow.

---

## 6. Global mobile inventory layout/scroll refactor — 2026-10-07

Work included:

- global modal scroll isolation;
- removal of fixed viewport shell sizing;
- mobile inventory grid stacking;
- removal of table-width traps;
- cache/build updates.

This directly relates to the previously reported mobile scrolling/zoom/UX problems.

---

## 7. Inventory V2 hardening — late September / early October

Work included:

- V2 item master;
- barcode preflight;
- measurement model;
- warehouse counting;
- security hardening;
- staff sessions;
- staff admin;
- passwordless/guest session changes.

---

## 8. Vegetable Inventory module — late September / early October

Work included:

- separate admin page;
- separate warehouse counting page;
- vegetable master;
- English/Hindi/Gujarati names;
- submitted report;
- count corrections;
- no-inward-date scope;
- startup/session hardening.

---

## 9. Restaurant Inventory template-driven model — 2026-10-05

Work included:

- restaurant template import RPC;
- import grant;
- item master fields for packaging/counting;
- backend validation.

The intended direction is to make staff counting simple:

**Search/Scan → Enter quantity → Save**

rather than repeatedly selecting packaging metadata.

---

## 10. Delivery financial/security hardening — late September / early October

Work included:

- delivery core;
- delivery financials;
- RLS hardening;
- removal of legacy policies;
- driver RPC security;
- service-role grant hardening;
- delivery idempotency;
- invoice delivery completion reconciliation.

---

## 11. Operations audit — 2026-09-27/28 onward

Work included:

- operational audit table;
- audit capture;
- admin audit-read RPC;
- audit permission fixes;
- driver ledger handling when audit-table permission failed.

A recent commit specifically fixed the driver ledger so an audit-table permission failure would not stop the ledger from loading.

---

## 12. Driver payment confirmation system — late September

Work included:

- payment ledger;
- balance floor;
- admin driver balance;
- payment screenshots;
- private driver payment-confirmation password;
- admin re-authentication.

---

## 13. Delivery Management Dashboard — late September

Work included:

- delivery dashboard UI;
- live refresh;
- filters;
- route/outlet visibility;
- unassigned workload KPI;
- driver readiness;
- balance labels;
- date controls;
- historical delivery transactions.

---

## 14. Inventory mobile/UX optimization — current optimization cycle

Work included:

- design/system cleanup;
- scroll architecture;
- mobile grid layout;
- boot/runtime defensive handling;
- translation/readability work.

The cycle has intentionally shifted toward one-at-a-time optimization because broad simultaneous edits were producing regressions.

---

## 15. Anti-regression process — 2026-10-07

`.cursorrules` was added with explicit rules for:

- no silent code stripping;
- preserving existing IDs/routes/contracts;
- defensive async handling;
- camera integration;
- modularity;
- targeted edits;
- 360px/mobile QA;
- desktop QA;
- scroll/modal checks;
- service-worker verification.

This is now a repository-level development guardrail.

---

# 19. THINGS THAT WERE TRIED / CHANGED BEFORE AND MUST NOT BE RE-REQUESTED AS IF NEW

The project history already contains work on all of the following:

- dynamic Excel row handling;
- dynamic sheet/header detection;
- multi-phone shared orders;
- atomic outlet locking;
- narration rank;
- English product names with Hindi/Gujarati quantity narration;
- repeat narration;
- product voice text;
- driver assignment;
- delivery charges;
- driver PWA;
- invoice upload;
- invoice number;
- invoice OCR;
- item-level rejection;
- MISSING/DAMAGE rejection reasons;
- damage evidence photos;
- rejection confirmation;
- delivery blocking;
- driver ledger;
- driver payment password;
- payment confirmation;
- payment screenshots;
- opening balances;
- delivery dashboard;
- historical reports;
- admin configuration;
- restaurant inventory V2;
- barcode lookup;
- item master import;
- measurement/conversion model;
- warehouse counting;
- vegetable inventory;
- Hindi/Gujarati vegetable names;
- admin vegetable count correction;
- passwordless/guest inventory session;
- PWA cache/build versioning;
- mobile scroll/zoom fixes;
- driver login/logout recovery;
- camera fallback;
- payout modal scrolling;
- admin packing controls.

Future requests should modify or improve these existing implementations rather than recreate parallel versions.

---

# 20. CURRENT RECOMMENDED BASELINE

The current `main` branch should be treated as the baseline.

Do **not**:

- copy old code from previous chats;
- restore an old version from memory;
- create duplicate modules because a current module looks unfamiliar;
- create a second inventory table without proving the existing contract cannot support the requirement;
- directly mutate production tables without migration/RPC review;
- modify `outlets`, `order_items`, `delivery_records`, `driver_payments`, or inventory master tables without dependency mapping.

---

# 21. CHANGE CONTROL PROCESS — EFFECTIVE FROM NOW ON

This is mandatory for future change requests.

## BEFORE ANY CODE

### Step 1 — Scope declaration

Before editing, state:

**FILES/MODULES TO TOUCH**

List exact files and/or modules.

Example:

- `driver/driver.js`
- `driver/index.html`
- Driver Delivery → invoice step

### Step 2 — Explicit exclusions

State:

**FILES/MODULES I WILL NOT TOUCH**

List relevant adjacent areas that will remain unchanged.

Example:

- `admin/index.html`
- `supabase/functions/driver-api/index.ts`
- Restaurant Inventory
- Payment Ledger

This gives the user an opportunity to catch unintended scope before implementation.

### Step 3 — Side-effect assessment

State:

**EXPECTED SIDE EFFECTS / RISKS**

Include known or plausible effects, even if uncertain.

Examples:

- service-worker cache must be bumped;
- driver delivery state may be affected;
- invoice upload authorization may be involved;
- admin and driver share the same `delivery_records` state.

### Step 4 — STOP

**Do not write code until the user confirms the scope.**

No silent implementation.

---

# 22. SCOPE EXPANSION RULE

If implementation reveals that the requested “one change” actually requires additional files/modules:

**STOP.**

Do not silently expand scope.

Report:

1. what was originally approved;
2. what additional file/module is now required;
3. why it is required;
4. what could break if it is changed;
5. what will remain untouched.

Then wait for confirmation.

---

# 23. AFTER IMPLEMENTATION

## Step 5 — Exact change report

Do not say only “Done”.

Report:

- exact files changed;
- exact functions/components changed;
- database migrations/RPCs changed, if any;
- user-visible behavior;
- validation performed;
- anything not verified.

Example:

> Changed `driver/driver.js`, function `markDelivered()`, and `driver/index.html` invoice dialog markup.
>
> The driver can now not advance to Delivered until invoice upload and rejection confirmation are complete.
>
> No admin files or database schema were changed.
>
> JavaScript/Deno syntax checks passed. Real-device camera verification remains pending.

---

## Step 6 — Update this file

**`PROJECT_STATUS.md` must be updated before the implementation is declared complete.**

The update must record:

- new status;
- changed files;
- changed functions/components;
- database/API changes;
- verification;
- unresolved issues;
- cache/deployment impact;
- commit SHA when available.

---

# 24. STATUS LANGUAGE STANDARD

Use only these statuses unless there is a compelling reason to add a more precise qualifier:

- **Fully working** — implemented and sufficiently verified in the relevant environment.
- **Partially working** — significant implementation exists, but one or more important paths remain incomplete, fragile or unverified.
- **Broken** — intended workflow currently fails in a material way.
- **UI only, no backend** — visible interface exists without functional backend workflow.
- **Not started** — no meaningful implementation exists.

Never upgrade a module to “fully working” merely because:

- the UI exists;
- code compiles;
- a function exists;
- a migration exists;
- one browser worked once.

---

# 25. FINAL AUDIT CONCLUSION

The project is **not a prototype anymore**. It contains a real operational architecture spanning packing, delivery, driver management, inventory and financial workflows.

It is also **not yet a cleanly stabilized production system**.

The highest-value next phase is not adding more broad features. It is controlled stabilization:

1. one requested change at a time;
2. explicit file/module scope;
3. explicit exclusions;
4. explicit side-effect warning;
5. user confirmation before implementation;
6. targeted implementation;
7. verification;
8. immediate status-document update;
9. no silent scope expansion.

The most dangerous areas to touch casually are:

1. `outlets`;
2. `order_items`;
3. `delivery_records`;
4. driver Edge Function;
5. driver service worker/build chain;
6. `app.js`;
7. inventory legacy/V2 bridge;
8. driver financial tables/RPCs;
9. admin authentication/session code.

**This document is now the operational status baseline.**


## Latest targeted verification — Driver Bug B

- **Bug B: duplicate driver login handler / session race — code fix implemented.**
- Root cause confirmed: driver/driver.js has the guarded capture-phase login binding and driver/index.html had a second document-level click handler that independently called login().
- Fix: removed only the competing driver/index.html Login-button branch. The existing driver/driver.js capture-phase binding remains the single login click path.
- Backend was not changed.
- **Phone verification pending:** user must test one Login tap and confirm the dashboard loads on the first attempt.
- Bug A (refresh dead-end) and camera initialization remain unresolved and are intentionally not changed in this step.


## Finding 6 — Driver infinite refresh loop

**Status: Fixed — awaiting full phone verification.**

Root cause: `driver/index.html` had a stale `window.__DRIVER_BUILD__` value (`20261008-deliveryflow10`) while `version.json` and `driver/sw.js` were already on `20261009-bugB-cachefix`. The startup build guard treated every load as a version mismatch, cleared driver caches/service workers, and redirected back to the same page repeatedly.

Fix: synchronized only `window.__DRIVER_BUILD__` in `driver/index.html` to `20261009-bugB-cachefix`. No camera, OCR, login, Supabase, service-worker logic, or other application behavior was changed for this finding.

Commit: `d0faf0b702b5cade43afe89ba1760acbdb7af9df`

Required live verification: clear site data → close Chrome → reopen → driver login with five separate single taps.


## Finding 7 — False “Route complete” state after refresh

**Status: Code fix committed — awaiting live phone verification.**

Root cause: the driver UX rendered “Route complete” whenever the active outlet list was empty, without checking whether dashboard data had loaded successfully. A failed/empty dashboard response could therefore appear as successful completion.

Fix:
- `driver/driver.js`: track route load state as `not-loaded`, `loading`, `loaded`, or `error`.
- `driver/driver-ux-v2.js`: show “Route unavailable” if route data did not load successfully; show “No outlets loaded” if a successful response contains no outlets; show “Route complete” only when loaded outlet data exists and all returned outlets are delivered.

No database, Supabase RPC, login, camera, OCR, service-worker, or update logic was changed for this finding. The duplicate Refresh handler was intentionally left untouched.

Commits:
- `22822ef1fae660c573323ca26f576a9677c120ff` — route load-state tracking
- `0359367326f599faf167c757ccac7bcd7840031e` — false-completion UI guard

Required verification: clear site data, close Chrome, reopen the Driver PWA, log in once, and confirm that assigned outlets appear. If dashboard loading fails, the UI must show a retry message instead of “Route complete”.


## Driver refresh initialization and viewport stability

**Status: Source fix committed; live deployment/cache verification pending.**

- Moved the `refreshPromise` declaration beside the driver state declarations so it is initialized before any refresh callback can access it, eliminating the temporal-dead-zone error shown after login.
- Added `renderPreservingViewport()` and used it during dashboard refresh/page loading/error rendering to preserve the current vertical scroll position during passive refresh updates. Explicit workflow-driven outlet focus/scroll behavior remains unchanged.
- Changed file: `driver/driver.js` only for application logic.
- Commit: `e7e65468b78e2bcb0041e84e2c03f6e885c0393a`.
- Static verification: exactly one `refreshPromise` declaration remains, placed before refresh handlers; refresh function contains no direct `render()` calls, only viewport-preserving renders.
- Limitation: `driver/index.html`, `driver/sw.js`, and `version.json` still use build `20261010-driveraudit2`; cache-busting was not changed in this commit. A separate approved release-version bump may be required before an already-installed PWA receives this JavaScript.
- Live Android viewport stability and deployment behavior are not yet verified.


## Driver refresh regression — retain last successful route

**Status: Source fix and cache-version bump committed; awaiting live Android verification.**

The reported repeat-refresh failure showed the route becoming unavailable after a successful list load. The refresh error path now snapshots the last successfully loaded outlets/order/earnings and restores them if a later refresh request fails. The UX displays a warning above the retained route so a transient request failure does not erase the driver's usable list or imply completion.

Build/cache rollout was coordinated to `20261010-driverrefreshfix1` across `driver/index.html`, `driver/sw.js`, and `version.json`. Driver JS and UX assets are versioned with that build so the PWA can fetch the corrected source.

Files changed for this fix: `driver/driver.js`, `driver/driver-ux-v2.js`, `driver/index.html`, `driver/sw.js`, `version.json`; this status entry updates `PROJECT_STATUS.md`.

Commits:
- `fcdfa558135b2c1779c5545324dcb5d5dea6fd1c` — preserve last route on refresh failure
- `f0a075eb3d1d52632d96847e30545614cb978c8f` — display refresh warning
- `7a4ba7c63298fb585b92c0c3ca7c5cd8e846a31f` — driver asset version bump
- `5530b0964f6bda06c913ecf99fda022d1b4298e9` — service-worker cache bump
- `8dc9eb0be88e4c457e23c8def7255ab16e9d635e` — version.json bump

Verification from source: all driver build markers and cache/resource query strings use `20261010-driverrefreshfix1`; the refresh error path restores the previous route when one exists. Live deployment and phone testing are still required. If a refresh request fails, the expected behavior is to retain the list and show a warning, not replace the list with “Route unavailable”.
