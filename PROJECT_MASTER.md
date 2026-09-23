# PACKING ASSISTANT — MASTER SYSTEM BLUEPRINT
_Last verified against GitHub main after the 2026-09-23 damage-evidence fix._

> **Purpose:** This is the single recovery and continuity document for the Packing Assistant project.
> Every meaningful future feature, bug fix, database change, deployment change, test result, and architectural decision MUST be recorded here.
> If the working copy is lost, use this document together with the GitHub repository history and Supabase project to reconstruct the system quickly.
>
> **Important:** Never put passwords, Supabase service-role/secret keys, driver PINs, admin passwords, or other secrets in this document.

---

## 1. SYSTEM IDENTITY

- Project: **Packing Assistant V2**
- Repository: `shahabhishekofficial-create/packing-assistant`
- Live web app: `https://shahabhishekofficial-create.github.io/packing-assistant/`
- Supabase project ref: `pbhkuofylhqcqmspubmb`
- Supabase URL: `https://pbhkuofylhqcqmspubmb.supabase.co`
- Supabase region: `ap-south-1`
- Frontend hosting: GitHub Pages
- Database/backend: Supabase PostgreSQL + RPC functions
- Server-side driver API: Supabase Edge Function `driver-api`
- Frontend style: vanilla HTML/CSS/JavaScript, no frontend build framework
- PWA support: packer, admin, and driver service workers/manifests
- Primary languages for UI/voice: English, Hindi, Gujarati
- Target devices: desktop + Android + iPhone/iPad browsers/PWA

### Current source of truth

The current GitHub `main` branch is the source of truth for application code.

Current HEAD:
`98301ef0e162aef0295e5ba73b13c62201ad19d9`
Commit: **Bump driver cache for damage-photo fix**

Never rebuild an old version from memory when current repository code is available.

---

# 2. BUSINESS PURPOSE

The system is a multi-device warehouse packing and delivery workflow.

Core flow:

1. Admin/packer imports an Excel/CSV order.
2. System detects required columns dynamically.
3. A live order is created in Supabase.
4. Order is split into outlets.
5. Each outlet can be atomically claimed by one packing device.
6. Packer sees item-by-item required quantities.
7. Browser narrates product name + quantity.
8. Packer marks each item PACKED / PARTIAL / MISSING.
9. Required quantity is validated against packed + missing quantity.
10. Outlet automatically completes when all items are resolved.
11. Whole order automatically completes when all outlets are completed.
12. Packing events provide an audit trail.
13. Outlet rank and driver can be configured.
14. Completed packing workload becomes available to drivers.
15. Driver logs into a separate PWA.
16. Driver sees assigned outlet route and item-level packing results.
17. Driver uploads invoice.
18. Driver performs rejection checking by item.
19. Rejected quantities can be marked MISSING or DAMAGE.
20. Damage/rejected evidence photos can be uploaded.
21. Driver marks outlet delivered only after required delivery checks.
22. Delivery charge/earnings are tracked.
23. Admin can manage driver payments and see balances.
24. Driver can confirm received payments using a private payment-confirmation password.
25. Historical reporting exposes order, packing, delivery, invoice, and charge data.

---

# 3. REPOSITORY MAP

Current important files:

```
.github/workflows/validate-js.yml     JS validation workflow

README.md                            short public project README

index.html                           packer/home UI
app.js                               main application logic
styles.css                           main UI styling
config.js                            Supabase URL + publishable browser key

admin.html                           admin entry redirect/page
admin/
  index.html                         admin dashboard UI
  auth.js                            admin authentication/dashboard logic
  manifest.json
  manifest.webmanifest
  sw.js                              admin PWA service worker

driver/
  index.html                         driver PWA UI
  driver.js                          driver application logic
  manifest.json
  manifest.webmanifest
  sw.js                              driver PWA service worker

manifest.webmanifest                 packer PWA manifest
sw.js                                packer service worker
icon.svg
icon-192.png
icon-512.png

supabase/
  admin_password.sql                 admin password functions/table
  driver_dashboard_v2.sql            driver dashboard migration/functions
  driver_delivery_setup.sql          initial driver/delivery setup
  historical_reports.sql              historical report functions
  outlet_delivery_charges.sql         outlet delivery charge functions

  functions/
    driver-api/
      index.ts                       secure driver API Edge Function
```

---

# 4. FRONTEND ARCHITECTURE

## 4.1 Main packer application

Files:
- `index.html`
- `app.js`
- `styles.css`
- `config.js`

Responsibilities of `app.js`:

### Import
- Accept Excel and CSV.
- Do NOT depend on a fixed Excel sheet name.
- Detect the correct sheet/headers dynamically.
- Required business columns include:
  - `STORE_NAME`
  - `ITEM_CODE`
  - `PRODUCT_NAME`
  - `Sum of Indents`
  - `SKU Narration Order` where available/used
- Dynamic row count. Never hard-code 183, 300, or any other row limit.
- Validate duplicate outlet + item code combinations.
- Reject malformed/empty required records before live-order creation.

### Live order creation
- Generate order/access information.
- Create order and all outlet/item records through Supabase RPC.
- Preserve outlet rank/narration rank.
- Create a shareable order URL.
- Multiple phones access the same live order.

### Device identity
- Persist a browser device ID.
- Use the device ID when claiming/releasing outlets and writing packing events.

### Outlet locking
- One outlet may be actively packed by one device.
- Claim operation is atomic.
- Another phone must not be able to modify the same outlet.
- Release operation must verify order, outlet, access token, and device identity.
- Do not bypass the database locking RPC from frontend code.

### Packing states
Item statuses:
- PENDING
- PACKED
- PARTIAL
- MISSING

Required invariant:

`required_qty = packed_qty + missing_qty`

The UI must never allow an invalid completed item state.

### Outlet/order completion
- Outlet completes only after all its items are resolved.
- Whole order completes only after all outlets are complete.
- Preserve timestamps.

### Audit
Record packing events containing, where applicable:
- order
- outlet
- item
- device
- action
- required quantity
- packed quantity
- missing quantity
- status
- reason
- timestamp

### Voice
Product name is spoken in English.
Quantity is spoken according to selected language:
- English
- Hindi
- Gujarati

Voice preferences persist locally.

Voice system supports:
- `en-IN`
- `hi-IN`
- `gu-IN`
- browser speech synthesis
- voice candidate selection
- strong/clear male-oriented voice selection when available
- adjustable speech rate
- repeat narration
- product-specific `voice_text` stored in database

Do not assume a specific browser voice exists. Voice availability differs by device/browser.

### Current voice behavior
Current main app uses:
- product + quantity narration
- repeat protection
- skip completed items
- speech cancellation before new narration
- approximately `.72` speech rate
- approximately `.9` pitch
- volume 1

If voice behavior is changed, record the exact new behavior here.

---

# 5. ADMIN SYSTEM

Admin is a separate PWA.

Files:
- `admin.html`
- `admin/index.html`
- `admin/auth.js`

Admin capabilities currently include:

## Authentication
- Admin password verification via Supabase RPC.
- Admin password change via RPC.
- Password hashes use pgcrypto/bcrypt-style hashing.
- Password itself must never be stored in frontend code or this document.

## Packing administration
Admin can access live packing/order management and outlet configuration.

Outlet configuration includes:
- outlet rank
- driver assignment
- delivery charge

## Delivery management dashboard

Current dashboard concepts include:

- live route
- live unassigned workload
- delivered
- pending delivery
- missing quantity
- rejected quantity
- partial items
- delivery checks
- earnings
- driver performance
- exceptions
- recent deliveries

Dashboard supports:
- live refresh
- date controls
- filters
- driver-level performance
- route/outlet visibility
- driver balance/payment information

## Fleet management

Admin can:
- manage driver payment records
- record payment amount/date/note
- upload payment screenshot/proof
- view driver balances
- view driver payment confirmation state
- require admin re-authentication for sensitive payment operations

---

# 6. DRIVER SYSTEM

Driver is a separate PWA.

Files:
- `driver/index.html`
- `driver/driver.js`
- `supabase/functions/driver-api/index.ts`

Current driver workflow:

1. Login with driver login name + PIN.
2. Receive a random session token.
3. Only the token hash is persisted in driver session storage.
4. Session is valid for 30 days unless invalidated.
5. Driver sees assigned route/outlets.
6. Outlet rank controls route order.
7. Packing results are visible item-by-item.
8. Missing/partial exceptions are visible.
9. Driver uploads invoice image.
10. Driver checks delivered/rejected quantities.
11. Rejections use:
   - MISSING
   - DAMAGE
12. Rejected quantity cannot exceed packed quantity.
13. Damage/rejected evidence can be photographed/uploaded.
14. Rejection confirmation is required before marking delivered.
15. Invoice upload is required before marking delivered.
16. Driver marks outlet delivered.
17. Delivery earnings are calculated from delivery charge.
18. Driver can open a payment ledger.
19. Driver can set a private payment confirmation password.
20. Driver can confirm received payments.

### Progressive dashboard loading
Driver dashboard loads outlets in pages rather than requiring all outlets in one huge response.

Current frontend uses page size 4.

Do not remove progressive loading unless performance testing proves it is unnecessary.

---

# 7. SUPABASE DATA MODEL

The live production database currently contains these application tables.

## orders

Key columns:
- id uuid PK
- order_name text
- access_token text UNIQUE
- status: active/completed/cancelled
- created_at
- completed_at

Purpose:
Top-level live order and access control.

## outlets

Key columns:
- id uuid PK
- order_id FK orders
- store_name
- status: available/in_progress/completed
- locked_device_id
- locked_at
- started_at
- completed_at
- created_at
- outlet_rank
- driver
- delivery_charge

Purpose:
Outlet-level workload, locking, route ordering and delivery configuration.

## order_items

Key columns:
- id uuid PK
- order_id FK orders
- outlet_id FK outlets
- item_code
- product_name
- voice_text
- required_qty
- packed_qty
- missing_qty
- status: pending/packed/partial/missing
- reason
- started_at
- completed_at
- updated_at
- narration_rank

Purpose:
Item-level packing state and narration ordering.

## packing_events

Key columns:
- id
- order_id
- outlet_id
- item_id
- device_id
- action
- required_qty
- packed_qty
- missing_qty
- status
- reason
- created_at

Purpose:
Audit/history of packing operations.

## product_voice

Key columns:
- item_code PK
- product_name
- voice_text
- updated_at

Purpose:
Reusable product-specific narration text.

## drivers

Key columns:
- id
- name UNIQUE
- active
- created_at

Purpose:
Legacy/simple driver configuration used by parts of the packing/admin system.

## driver_accounts

Key columns:
- id
- driver_name
- login_name UNIQUE
- pin_hash
- active
- created_at
- payment_password_hash

Purpose:
Secure driver login and private payment confirmation password.

## driver_sessions

Key columns:
- id
- driver_id
- token_hash UNIQUE
- expires_at
- created_at
- last_seen_at

Purpose:
Driver session management.

## delivery_records

Key columns:
- id
- order_id
- outlet_id
- driver_id
- driver
- status
- delivered_at
- invoice_path
- invoice_filename
- invoice_mime_type
- invoice_uploaded_at
- ocr_status
- ocr_result
- delivery_charge
- rejection_photos
- item_rejections
- rejections_confirmed
- created_at
- updated_at

Unique business key:
`order_id + outlet_id`

Purpose:
Delivery lifecycle and evidence.

## driver_payments

Key columns:
- id
- driver_id
- amount
- paid_at
- note
- screenshot_path
- created_at
- confirmed_at
- confirmed_by_driver_id

Purpose:
Driver payment ledger and confirmation.

## admin_settings

Key columns:
- id boolean singleton
- password_hash
- updated_at

Purpose:
Admin authentication.

---

# 8. DATABASE RPC/API CONTRACT

These public database functions currently exist and are part of the system contract.

### Packing
- `create_order(p_order_name text, p_access_token text, p_items jsonb)`
- `get_current_order()`
- `get_order(p_order_id uuid, p_access_token text)`
- `claim_outlet(p_order_id uuid, p_outlet_id uuid, p_access_token text, p_device_id text)`
- `release_outlet(p_order_id uuid, p_outlet_id uuid, p_access_token text, p_device_id text)`
- `update_item_status(p_order_id uuid, p_item_id uuid, p_access_token text, p_device_id text, p_status text, p_packed_qty numeric, p_missing_qty numeric, p_reason text)`
- `update_voice_text(p_item_code text, p_product_name text, p_voice_text text)`
- `update_outlet_settings(p_order_id uuid, p_outlet_id uuid, p_access_token text, p_rank integer, p_driver text)`

### Reports
- `get_order_history(p_access_token text)`
- `get_report_data(p_access_token text, p_from_date date, p_to_date date)`

### Delivery charges
- `get_outlet_delivery_charges(p_order_id uuid, p_access_token text)`
- `update_outlet_delivery_charge(p_order_id uuid, p_outlet_id uuid, p_access_token text, p_delivery_charge numeric)`

### Admin
- `verify_admin_password(p_password text)`
- `change_admin_password(p_current_password text, p_new_password text)`
- `admin_driver_payment_ledger(p_admin_password text)`
- `admin_record_driver_payment(p_admin_password text, p_driver_id uuid, p_amount numeric, p_paid_at timestamptz, p_note text, p_screenshot_path text)`

### Driver
- `driver_login(p_login_name text, p_pin text)`
- `driver_session_info(p_session_token text)`
- `get_driver_dashboard(p_session_token text)`
- `get_driver_dashboard_page(p_session_token text, p_offset integer, p_limit integer)`
- `get_driver_payment_ledger(p_session_token text)`
- `driver_set_payment_password(p_session_token text, p_new_password text)`
- `driver_confirm_payment(p_session_token text, p_payment_id uuid, p_password text)`
- `driver_invoice_target(p_session_token text, p_outlet_id uuid, p_order_id uuid, p_outlet_name text)`
- `save_driver_item_rejections(p_session_token text, p_order_id uuid, p_outlet_id uuid, p_rejections jsonb)`

Any new RPC is an architectural change and MUST be recorded here.

---

# 9. EDGE FUNCTION

Function:
`supabase/functions/driver-api/index.ts`

Supabase Edge Function:
- name: `driver-api`
- current deployed version: 26
- custom authentication is implemented inside the function
- function uses service-role internally; this key is NEVER exposed to browser code

Current responsibilities include:
- driver login
- session validation
- dashboard access
- paginated dashboard
- invoice upload target/signing
- rejected-item photo upload target/signing
- save rejection data
- mark delivery
- payment ledger
- payment screenshot access
- payment confirmation
- payment password setup
- admin-protected payment operations

Security rule:
The browser talks to the Edge Function for privileged driver actions. Do not move service-role operations into `app.js` or `driver.js`.

---

# 10. STORAGE BUCKETS

Application storage buckets currently include:

- `delivery-invoices` — private invoice evidence
- `delivery-evidence` — private rejected/damage evidence
- `driver-payments` — driver payment proof/evidence

All evidence buckets must remain private.

Use signed URLs or signed upload targets rather than making evidence publicly accessible.

---

# 11. SUPABASE MIGRATION HISTORY

The production project currently reports these application migrations:

1. `20260920094657_add_packing_report_events`
2. `20260920094752_single_fixed_app_order_link`
3. `20260920100958_add_narration_rank_to_order_items`
4. `20260920122540_keep_latest_packing_order_available`
5. `20260921174456_driver_system_v2`
6. `20260921180823_fix_driver_login_crypt_schema`
7. `20260921181317_fix_driver_dashboard_digest_schema`
8. `20260921182832_driver_session_validation_rpc`
9. `20260921193820_fix_driver_invoice_authorization`
10. `20260921194454_add_delivery_record_unique_key`
11. `20260921200100_add_driver_item_rejections`
12. `20260921200141_require_driver_rejection_confirmation`
13. `20260921201356_driver_dashboard_progressive_loading`
14. `20260921201712_driver_dashboard_loading_indexes`
15. `20260922132212_driver_rejection_reason_missing_damage`
16. `20260922163822_driver_payment_ledger`
17. `20260922164352_driver_payment_balance_floor`
18. `20260922164404_admin_driver_balance_floor`
19. `20260922181806_driver_payment_confirmation_password`

### Rebuild rule

For a clean Supabase rebuild:
1. Create a new Supabase project.
2. Install required extensions, especially pgcrypto.
3. Recreate the core packing schema: orders, outlets, order_items, packing_events, product_voice.
4. Recreate the packing RPCs.
5. Apply driver system migrations in chronological order.
6. Recreate driver accounts without copying plaintext credentials.
7. Recreate private storage buckets and policies.
8. Deploy `driver-api`.
9. Configure browser publishable key in `config.js`.
10. Run verification queries/tests.
11. Only then publish GitHub Pages.

Do not run old SQL files in arbitrary order. Database dependencies and later fixes matter.

---

# 12. SECURITY RULES

These are non-negotiable.

1. Browser may contain only Supabase URL + publishable key.
2. Never commit service-role key.
3. Never commit database password.
4. Never commit admin password.
5. Never commit driver PINs/passwords.
6. Admin password must be hashed.
7. Driver PIN must be hashed.
8. Driver payment password must be hashed.
9. Driver session tokens are stored hashed in database.
10. Private delivery/payment evidence stays in private buckets.
11. Privileged storage signing is performed server-side.
12. RLS must remain enabled on application tables.
13. RPC authorization must validate order/access/session/device ownership.
14. Do not trust frontend-only authorization.
15. Any security-sensitive change requires verification plus Supabase security advisors.

---

# 13. DEPLOYMENT PATH

## Frontend

GitHub Pages serves the repository root.

For a normal frontend change:
1. Modify files.
2. Validate JavaScript.
3. Commit to `main`.
4. GitHub Pages deploys the new version.
5. If a PWA/service worker caches old code, bump the appropriate cache/service-worker version.
6. Test in a fresh/private browser session and at least one mobile device.

## Supabase

For schema/function changes:
1. Review current production schema first.
2. Use Supabase migration workflow.
3. Apply the migration.
4. Run verification SQL.
5. Run security/performance advisors.
6. Update repository SQL/migration documentation.
7. Update this blueprint.
8. Deploy/update Edge Function if needed.
9. Test end-to-end.

---

# 14. PWA/CACHE RULES

There are three independently cached application surfaces:

- main packer PWA
- admin PWA
- driver PWA

When frontend code changes:
- identify which service worker caches the changed file
- bump cache version when necessary
- verify the deployed browser receives the new JS/CSS
- do not assume GitHub Pages deployment alone clears an installed PWA cache

Current driver service-worker history reached v25 during recent work.

---

# 15. CURRENT KNOWN IMPLEMENTATION NOTES / THINGS TO VERIFY

These are important so future work does not accidentally assume the documentation is perfect.

### Live synchronization
- Supabase Realtime subscriptions are used for `outlets` and `order_items`.
- A 250 ms debounce prevents excessive refreshes after realtime events.
- A 3-second fallback poll runs while an order is active.
- `syncBusy` prevents overlapping synchronization requests.
- The fallback was restored on 2026-09-23 after the interval had drifted to 5 minutes.

### Core schema source
The repository contains the later SQL setup/migration files, but not one single complete historical baseline schema file for the original packing tables.

Therefore:
- the live Supabase schema is currently an important source of truth
- future work should progressively consolidate the baseline schema/migrations into the repository
- this blueprint records the live table/RPC contract so the architecture is not lost

### Voice compatibility
Browser speech voices vary by device. Do not hard-code a voice name as mandatory.

### Excel importer
Never reintroduce fixed row-count assumptions or fixed sheet-name assumptions.

### Driver delivery
Do not allow delivery completion without the required invoice/rejection confirmation checks.

---

# 16. TESTING CHECKLIST

Every significant release should test these layers.

## Import
- Excel with 1 outlet
- Excel with many outlets
- CSV
- blank rows
- duplicate outlet + item code
- dynamic row count >300
- workbook where target sheet is not the first sheet
- required-header detection
- invalid quantity

## Packing
- create live order
- open from second phone
- claim same outlet from two phones
- verify only one phone gets lock
- PACKED
- PARTIAL
- MISSING
- required = packed + missing
- reason persistence
- refresh persistence
- browser crash/reload
- release outlet
- automatic outlet completion
- automatic order completion
- audit events

## Voice
- English quantity
- Hindi quantity
- Gujarati quantity
- product name remains English
- repeat button
- voice cancellation
- next-item narration
- completed item skipped
- Android
- iPhone
- browser with limited voice list

## Admin
- login
- wrong password
- password change
- outlet rank
- driver assignment
- delivery charge
- dashboard refresh
- filters/date controls
- live/unassigned workload
- driver balance
- payment record
- payment screenshot
- re-authentication

## Driver
- login
- invalid login
- session reload
- session expiry
- route loading
- progressive loading
- packing exceptions
- invoice upload
- missing rejection
- damage rejection
- invalid rejection quantity
- damage photo
- rejection confirmation
- delivery blocked before required checks
- mark delivered
- earnings
- ledger
- payment confirmation password
- wrong payment password
- correct payment confirmation
- payment proof

## Security
- no service-role key in repository
- private storage remains private
- invalid access token rejected
- invalid device cannot update packing
- invalid driver session rejected
- admin-protected actions reject bad password

---

# 17. DEVELOPMENT RULES FOR FUTURE WORK

Before changing code:

1. Read this file.
2. Inspect current GitHub HEAD.
3. Inspect the relevant current file(s).
4. Inspect the relevant Supabase table/RPC/migration if database behavior is involved.
5. Do not recreate functionality that already exists.
6. Make the smallest coherent change that solves the actual requirement.
7. Verify the change.
8. Update this file in the same development cycle.
9. Commit code + blueprint update together whenever practical.
10. Record unresolved issues explicitly instead of silently forgetting them.

### When a new feature is added, document:
- user/business purpose
- UI entry point
- frontend file(s)
- backend/RPC/Edge Function
- database tables/columns
- storage bucket
- security/authorization
- state transitions
- validation rules
- error cases
- test procedure
- deployment/cache impact
- current status

### When a bug is fixed, document:
- symptom
- root cause
- affected component
- fix
- verification
- commit SHA

---

# 18. CHANGE LOG — PROJECT HISTORY SUMMARY

This section is a continuity summary, not a replacement for Git history.

### Packing foundation
The original project established:
- Excel/CSV order import
- dynamic row handling
- outlet/item validation
- Supabase live orders
- shareable order access
- multi-device state
- atomic outlet locking
- item packing states
- outlet/order completion
- packing audit events
- device identity
- voice narration

### Voice/narration evolution
Added:
- product-specific voice text
- narration rank
- English product names
- selectable quantity language
- browser speech
- repeated narration
- male-oriented voice selection logic
- voice preference persistence

### Reporting/order evolution
Added:
- packing report events
- fixed/current order-link behavior
- historical order/report functions
- latest order availability behavior

### Driver system
Added:
- driver accounts
- secure driver sessions
- driver dashboard
- route/outlet assignment
- progressive dashboard loading
- invoice authorization
- private delivery evidence
- delivery completion

### Rejection workflow
Added:
- driver item rejection records
- required rejection confirmation
- MISSING/DAMAGE reasons
- rejected-item photos
- delivery blocking until checks are complete

### Delivery analytics
Added:
- delivery management dashboard
- live route
- live workload/unassigned workload
- filters
- refresh
- outlet rank
- earnings
- driver performance
- exception reporting

### Fleet/payment workflow
Added:
- driver payment ledger
- payment balance floor
- admin driver balance
- payment screenshots
- driver payment confirmation
- private payment-confirmation password
- admin re-authentication
- improved password form interactions

### Recent GitHub commits
Most recent sequence includes:
- `c0a1794` Improve driver password form interactions
- `d708f2a` Polish driver payment password modal
- `c35fb8f` Improve driver payment password dialog
- `0813be2` Show live unassigned workload KPI
- `57365cc` Add live workload and unassigned metrics
- `6cb8c48` Label driver balance correctly
- `4b6a37f` Polish dashboard date controls and balance labels
- `0debdc2` Normalize dashboard function source
- `37b6051` Fix driver dashboard source formatting
- `45ee873` Fix driver dashboard source formatting
- `6ffe409` Correct driver balance using all-time delivered earnings
- `e3fc674` Bump admin dashboard cache
- `7360a4f` Style delivery management dashboard
- `252859f` Add live refresh and dashboard filters
- `9dc6aac` Add delivery management dashboard UI
- `985ec85` Optimize admin driver dashboard analytics
- `acf6c34` Include outlet rank in live delivery dashboard
- `25fc8a1` Return live route details for driver dashboard
- `43af3d7` Add delivery management dashboard analytics
- `fdc9db6` Add secure admin re-auth flow for fleet management
- `2c383db` Fix fleet admin authentication after session reload
- `82e6981` Show driver payment confirmation in admin fleet
- `cab789b` Add driver payment confirmation and private password

Git history remains authoritative for the complete commit-by-commit implementation history.

---

# 19. RECONSTRUCTION PROCEDURE — TARGET: HOURS, NOT DAYS

If the application code is lost but this blueprint survives:

## Phase A — recover repository
1. Recreate repository structure exactly as in Section 3.
2. Restore the latest known Git commit if GitHub history survives.
3. If GitHub history is also lost, recreate frontend modules from the architecture and contracts below.

## Phase B — rebuild Supabase
1. Create Supabase project in `ap-south-1`.
2. Enable pgcrypto.
3. Create core tables:
   - orders
   - outlets
   - order_items
   - packing_events
   - product_voice
4. Add all constraints/indexes/RLS.
5. Create packing RPCs.
6. Apply driver migrations chronologically from Section 11.
7. Create driver_accounts/driver_sessions/delivery_records/driver_payments/admin_settings.
8. Create storage buckets.
9. Apply storage policies.
10. Deploy `driver-api`.
11. Recreate non-secret seed/configuration data.

## Phase C — frontend
1. Restore `config.js` with the new project URL + publishable key.
2. Restore `index.html`, `app.js`, `styles.css`.
3. Restore admin PWA.
4. Restore driver PWA.
5. Restore service workers/manifests/icons.
6. Validate JS.
7. Publish GitHub Pages.

## Phase D — verification
Run Section 16 in order:
- import
- packing
- multi-device lock
- voice
- admin
- driver
- delivery
- payments
- security

## Phase E — record recovery
Immediately update this file with:
- new Supabase project ref
- migration status
- new deployed Edge Function version
- new frontend commit
- any deviations from the old architecture

---

# 20. ARCHITECTURAL NON-NEGOTIABLES

These rules define the product even if implementation technology changes.

1. **Dynamic input:** no fixed row count.
2. **Dynamic Excel sheets:** no fixed sheet name dependency.
3. **Shared live state:** multiple phones see the same order.
4. **Atomic outlet locking:** two packers cannot own the same outlet simultaneously.
5. **Quantity integrity:** required = packed + missing.
6. **Auditability:** packing actions are traceable.
7. **Persistent state:** refresh/crash must not lose committed packing data.
8. **Voice separation:** product name English; quantity language selectable.
9. **Driver separation:** driver operations are isolated from packer/admin privileges.
10. **Private evidence:** invoice/payment/rejection images are not public.
11. **Server-side privileged actions:** service-role operations stay server-side.
12. **Delivery controls:** invoice + rejection checks precede final delivery.
13. **Financial integrity:** driver balance must not become negative from payment calculations.
14. **Password security:** passwords/PINs are hashed, never stored in plaintext.
15. **Mobile-first operation:** core packing/driver flows must work on phones.
16. **Continuity:** every architectural change is recorded in this file.

---

# 21. CURRENT WORKING STATUS

### Implemented
- Core packing workflow
- Dynamic import
- Multi-phone live packing
- Outlet locking
- Item status workflow
- Voice narration
- Admin system
- Driver PWA
- Driver authentication
- Driver route/dashboard
- Delivery evidence
- Rejection workflow
- Delivery completion
- Delivery analytics
- Driver earnings
- Fleet payment ledger
- Driver payment confirmation
- PWA/service-worker infrastructure
- GitHub Pages deployment

### Known documentation/technical follow-ups
- Validate the restored 3-second fallback on two physical phones and degraded mobile networks.
- Consolidate the original core Supabase schema into a clean repository baseline/migration path.
- Keep this blueprint updated after every future feature/fix.

---

# 22. CHANGE LOG — 2026-09-23


## 2026-09-23 — Remove Repeated Password Prompts from Delivery & Fleet
**Status:** DEPLOYED

**Why**
- Delivery & Fleet are Admin modules. Once the user has authenticated to the Admin Dashboard, those modules should use the same active Admin session instead of asking for the password again.

**Changed**
- Added server-backed Admin sessions in `public.admin_sessions`.
- Main Admin login now creates a one-hour rolling Admin session token after password verification.
- Session token is stored hashed in the database; the browser stores only the session token.
- Session is revalidated when an existing Admin PWA session is restored.
- Logout revokes the server-side Admin session.
- Delivery Dashboard no longer sends the Admin password to `driver-api`.
- Fleet Management, payment proof viewing, payment upload and payment recording now use the same Admin session.
- Removed the Fleet/Delivery frontend password re-entry path.
- Added session-based database RPCs for Fleet payment ledger and payment recording.
- Edge Function `driver-api` deployed as version 30 with session-based Admin authorization.
- Admin PWA cache bumped to v20.
- Existing one-hour Admin inactivity timeout remains in place; this change removes duplicate prompts, not Admin authentication itself.

**Security**
- Admin password is no longer sent to the Delivery/Fleet Edge Function after login.
- Server stores only a SHA-256 hash of the session token.
- Admin session table has RLS enabled and direct anon/authenticated table access revoked.
- Privileged Edge Function operations validate the server-side Admin session before accessing payment/delivery data.

**Verification**
- Production database contains all five new Admin session/payment RPCs.
- No active test Admin sessions were created during verification.
- Production `driver-api` version 30 is ACTIVE.
- Frontend Delivery/Fleet operations use `admin_session` rather than `admin_password`.
- Physical browser/PWA validation should confirm that navigating Dashboard → Delivery & Fleet and Dashboard → Fleet Management no longer opens a password prompt.

**Commits**
- `a67e2945aa7d30053f57f00ac05cef985d74f0b5` — Add persistent admin session authentication
- `637fd3eaf2acb4f54e120f32c789902d10095437` — Use persistent admin session for privileged dashboard actions
- `a4f93f8c971c0288efe2807487240713a3d32a20` — Use main admin session for Delivery/Fleet APIs
- `ee02dbc95efdccb51760857f2821ae8bd114b503` — Use shared admin session for Delivery/Fleet access
- `a5c5a7ff7835b0a0496ee7327b7561a105e4f182` — Finish migration from password prompts to admin session
- `183486d0da5b4a77b94be718738bfca3c5dc8298` — Revoke admin session on logout
- `a67e2945aa7d30053f57f00ac05cef985d74f0b5` — Add Admin session migration
- `8cc9ea1f67789613ddf072274bc54b5c691d3fab` — Use admin session for payment proof access
- Admin PWA cache commit: latest v20 cache update
- Edge Function deployment version: **30**

**Database migration**
- `supabase/migrations/20260923000300_admin_session_auth.sql`

## 2026-09-23 — Separate Admin Packing Overview from Staff Packing Controls
**Status:** DEPLOYED

**Why**
- The item-by-item packing screen with large PACKED / PARTIAL / MISSING controls is an operator/staff workflow, not the primary Admin management view.
- Admin needs visibility and control of packing progress without being forced into the staff execution interface.

**Changed**
- Added a dedicated Admin **Packing Overview** screen.
- Packing Overview shows:
  - current order
  - outlet count
  - completed / in-progress / pending outlets
  - required / packed / missing quantities
  - overall progress
  - outlet-wise rank, driver, product count, quantities and status
- Sidebar **Packing & Dispatch** now opens the Admin Packing Overview.
- Dashboard **Packing & Dispatch** module and **Open Packing** action now open the Admin Packing Overview.
- Added **Open Staff Packing Screen** inside the Packing Overview for deliberate access to the operator interface.
- Existing item-level PACKED / PARTIAL / MISSING controls are retained for the staff packing screen and are no longer the default Admin packing destination.
- Options menu label changed from **Order Packing Screen** to **Staff Packing Screen** to make the distinction explicit.
- Admin cache bumped to v19.
- No database/RPC/Edge Function changes.

**Commits**
- `fcae1721d0490f01850100e38d6992379147027c` — Separate admin packing overview from staff packing controls
- `a28b6db41ba765482c8d9ffabec376257cf8dd36` — Add admin packing overview and isolate staff packing controls
- `31219db67b9f3a536e118e0e9901ab3492587e40` — Prevent admin packing overview from overlapping staff packing screen
- `9f8146990ef61e26e47b7c121361b25e0b2aacae` — Style admin packing overview
- `c8a49fec41fc68eddd7cf6518dff8d1a6045f9a2` — Hide packing overview when opening fleet management
- `5039c53c830872ab1e1a02f990080a29f3890e9e` — Bump admin cache for packing overview

**Known follow-up**
- Refresh/reopen the Admin PWA so service-worker v19 takes control.
- The staff packing screen remains available when intentionally selected from Options.

## 2026-09-23 — Rebrand Admin into Bigly Agro Operations Dashboard
**Status:** DEPLOYED

**Why**
- The Admin PWA is no longer only a Packing Assistant. It is becoming the company's central operations dashboard for Bigly Agro Private Limited.
- Finance/Expenses and Sales are intentionally kept outside the current dashboard scope while the operations foundation is built.

**Changed**
- Admin branding changed from **Packing Assistant** to **Bigly Agro Private Limited**.
- Replaced the packing-centric home screen with an operations dashboard layout:
  - Welcome / company operations banner
  - Active outlets, packing progress, pending deliveries and delivery issues quick stats
  - Core modules: Packing & Dispatch, Delivery & Fleet, Inventory, Purchase & Suppliers, Employees & HR, Reports & Analytics
  - Latest Packing Order panel
  - Live Delivery Status panel
  - Operations Alerts panel
  - Existing detailed Packing Analysis retained below the new overview
- Added persistent desktop sidebar and mobile slide-out navigation.
- Added company-level header/search/date area and responsive layout.
- Inventory, Purchase & Suppliers, and Employees & HR are visually established as future modules and currently show a simple "coming soon" message rather than pretending to be implemented.
- Finance/Expenses and Sales are deliberately not included in the current navigation.
- Existing Packing, Delivery, Reports, Outlet Settings, Driver Dashboard and Fleet functionality remains connected to the new navigation.
- Admin PWA cache bumped from v16 to v18 after the dashboard and PWA branding changes.

**Logic**
- Dashboard overview is populated from the existing live packing state.
- Live delivery API data updates pending-delivery, issue and alert cards.
- Existing order creation remains available from the Latest Packing Order panel.
- Existing detailed packing analysis remains available on the dashboard for operational monitoring.

**Validation**
- Existing element IDs required by order creation, packing, reports and delivery status were preserved.
- New sidebar/module navigation is wired to the existing handlers.
- Packing screen visibility is explicitly restored for the redesigned Admin PWA.
- Finance and Sales are absent from the current dashboard navigation.

**Commits**
- `f84e42c8c2d5b92f93b567bbd8c86eec9e415e48` — Implement Bigly Agro operations dashboard layout
- `66ec783e948e2ac90a2e7d3c1cd3714bb9227087` — Style Bigly Agro operations dashboard
- `05654301f2843ef51e7d8e1634c82957acc3a4ec` — Wire Bigly Agro dashboard modules and live overview
- `029ee374308503d83582593e54462b4c2b738685` — Allow redesigned admin navigation to open packing screen
- `1e6de9239b24d2d02b3304342dd77dbd04010bff` — Keep dashboard navigation state synchronized
- `02a5595cc4d7f9dc997b5bf7fa19fd360a62dbaf` — Bump admin cache for Bigly Agro dashboard
- `ed3157ce3f112a56cca888cbeb32606b805d823c` — Rename admin PWA manifest to Bigly Agro
- `56ef0b1ef8350e47b43d642bf18a60a2dd754f7a` — Rename admin webmanifest to Bigly Agro
- `8cbf85888c5296c9ef969e63aba6cecc4dcd82ce` — Bump admin cache for Bigly Agro PWA branding

**Database migration**
- None.

**Known follow-up**
- Physical browser/PWA validation is required to confirm the new layout after service-worker v17 refresh.
- Future modules can be added behind the established sidebar without redesigning the dashboard shell.

## 2026-09-23 — Remove obsolete Admin Voice Language option
**Status:** DEPLOYED

**Why**
- Voice language selection is used inside the packing screen and does not need to be a separate Admin Options destination.
- The Admin Voice Language option did not provide a meaningful standalone workflow.

**Changed**
- Admin Options: removed the **Voice Language** menu item.
- Admin UI: removed the unused standalone Voice Language dialog and its Dashboard/close controls.
- Frontend: removed obsolete event handlers and standalone voice selector synchronization; the packing-screen voice selector remains available.
- Admin PWA cache bumped from v15 to v16 so installed PWAs receive the change.
- No database, RPC, Edge Function, or Storage changes.

**Validation**
- Packing screen voice-language selector remains intact.
- No Admin Options Voice Language destination remains.
- Service-worker cache version incremented to v16.

**Commits**
- `edc25916e361d6cf0a00a832b250716d7b2e8d7c` — Remove unused admin Voice Language option
- `ac6e798fcb4a2b4b4e648b05df9f175c527b3b46` — Remove obsolete admin Voice Language controls
- `18a175a6bdc07fdb890666d95bcce5bcbb23aa21` — Bump admin cache after removing voice option

**Database migration**
- None.

## 2026-09-23 — Make bootstrap failure visible and refresh the admin PWA
**Status:** DEPLOYED

**Why**
- A failed bootstrap previously looked identical to “no order exists.”
- The root frontend blocker was then traced to a literal `\\n` token between two JavaScript statements in `app.js`, which made the entire file fail parsing.
- Installed admin PWAs could continue serving cached frontend files after the fix.

**Changed**
- Admin UI: added `orderLoadStatus` status text below the import requirements.
- Frontend: successful `renderHome()` clears the bootstrap error status.
- Admin service worker: bumped cache v12 → v13.
- The resilient saved-order fallback remains in place.

**Validation**
- The failure path now has an explicit user-visible status.
- `app.js` was parsed with a JavaScript parser after the fix: syntax OK.
- Successful order load hides the status.
- Admin PWA cache version is incremented.

**Commits**
- `9fec6865f0d999b17d522e876e2647d64ccc12f6` — Show admin order bootstrap errors
- `ff65bab21c6752b571d8933ef4e481ee54af8716` — Clear admin bootstrap status after load
- `4a818ebf361127ca0549d43cfce3fa3a15a4e2c5` — Bump admin cache for order bootstrap UI
- `0c8880102960a961ec258f2a828607d6498ca334` — Fix admin status markup formatting
- `ff554ab892bf6630bb92bb63a9571e4e1f7f2ef0` — Bump admin cache after markup fix
- `90c304220e565c9290623c805ead7c0a56d4afda` — Fix admin dashboard JavaScript syntax error
- `d4e7196353cd53f2634c0817a06d6e8c65852ade` — Bump admin cache for syntax fix

**Database migration**
- None.

## 2026-09-23 — Fix rejected-photo false assignment failure caused by stale order ID
**Status:** DEPLOYED

**Second root cause found**
- The previous authorization fix correctly switched driver identity to `driver_id`, but rejected-photo authorization still required the client-supplied `order_id` to exactly match the outlet row.
- The driver dashboard can retain a stale `ds.orderId` during an order transition/refresh while the clicked outlet ID is still valid.
- That caused the backend lookup to find no outlet and return the misleading **“Outlet is not assigned to this driver”** message even when the driver actually owned the outlet.

**Permanent fix**
- Rejected-photo authorization now resolves the outlet using:
  - outlet UUID
  - authenticated driver's stable UUID
- The server then derives the authoritative `order_id` from that outlet.
- Item validation, rejection lookup, storage path, and photo-record save all use the server-resolved order ID.
- The client-supplied order ID is no longer trusted for outlet authorization.
- This removes the stale-order-ID failure mode without weakening driver authorization.

**Deployed**
- `driver-api` version **28**.
- Commit: `bc4f8e2027c878e2917639b95492a9259f5d1098` — Resolve rejected photo order from assigned outlet.

**Validation**
- Current production order has 19 assigned outlets.
- All 19 have valid `driver_id` values.
- The live Edge Function version is 28.

## 2026-09-23 — Fix driver rejected-item photo authorization
**Status:** DEPLOYED

**Problem**
- Drivers could see an outlet in their dashboard but the rejected-item image upload could return **“Outlet is not assigned to this driver.”**
- The delivery authorization model was comparing the mutable display-name text stored in `outlets.driver` with the driver's session name.
- That is fragile because assignment identity was represented by text instead of the driver's stable UUID.

**Root cause**
- `outlets` had only the legacy `driver` text field.
- Evidence upload authorization in `driver-api` used name matching.
- Driver assignment and driver session identity are actually stable UUIDs in `driver_accounts` / `driver_sessions`.

**Permanent fix**
- Added `outlets.driver_id uuid references driver_accounts(id)`.
- Backfilled all current assignments.
- Current production order: **19/19 assigned outlets now have a valid driver_id**.
- `update_outlet_settings()` now writes both the display name and stable driver UUID.
- `driver_invoice_target()` now authorizes using `driver_id`.
- Driver dashboard page loading now uses `driver_id` rather than driver-name matching.
- Rejected-item evidence authorization in `driver-api` now checks `outlets.driver_id === session.driver_id`.
- Rejected-photo save authorization uses the same stable-ID check.
- Deployed `driver-api` version **27**.

**Validation**
- Production query confirms 19 assigned current-order outlets and 0 missing driver IDs.
- Confirmed current assignments map exactly to active driver accounts.
- Confirmed live `driver_invoice_target()` uses `driver_id`.
- Edge Function deployment verified at version 27.

**Commits**
- `f65828b9376fb51566ea445de967e31bce55c9c0` — Authorize driver evidence by driver ID
- `a0e4ca12aa7dd26ee49168c172359be8eb9b5045` — Add stable driver-ID authorization migration

**Database migration**
- `20260923000200_driver_outlet_id_authorization` — applied directly to production and recorded in repository.

## 2026-09-23 — Enforce a single current order
**Status:** DEPLOYED

**Why**
- Production data contained multiple old orders with `status='active'`.
- “Current order” should be an explicit invariant, not inferred from status or whichever row happens to be newest.

**Changed**
- Supabase: added `orders.is_current boolean not null default false`.
- Supabase: added unique partial index `orders_one_current_idx` allowing only one current order.
- Supabase: `get_current_order()` now returns the explicit current order.
- Supabase: `create_order()` now serializes creation with an advisory transaction lock, clears the previous current flag, and makes the newly created order current atomically.
- Existing data: the latest order was set as the single current order; older orders remain available as historical/saved orders.
- Repository: added `supabase/migrations/20260923000100_single_current_order.sql`.

**Permanent behavior**
- There can be only one current order.
- Completing an order does not make the admin lose it; it remains current until the next order is created.
- Creating a new order explicitly replaces the previous current order.
- Concurrent order creation cannot leave two current orders.

**Validation**
- Confirmed exactly 1 current order in production after migration.
- Confirmed the latest order (22 Sep 2026) is the current order and contains 19 outlets / 177 items.
- Confirmed the new `get_current_order()` definition uses `is_current=true`.

**Commit**
- `0d38077996b54297dccbf36a6b094c173bd0f240` — Add single current-order invariant

**Database migration**
- `20260923000100_single_current_order` — applied directly to production and recorded in repository for rebuild continuity.

**Known follow-up**
- Physical browser validation of the admin bootstrap and PWA cache is still required on the user's device.

## 2026-09-23 — Make admin order bootstrap resilient
**Status:** DEPLOYED

**Why**
- The admin page could remain on the initial “Create New Live Order” screen when the first order-discovery request failed or when the optional driver list request delayed initialization.
- The bootstrap path silently swallowed the failure, so the user could not distinguish “no order” from “order failed to load.”

**Changed**
- Frontend: `app.js`
  - Driver-name loading is now non-blocking.
  - Server latest-order discovery is attempted first.
  - If discovery fails, the browser's last valid saved order token is restored automatically.
  - Bootstrap failures are logged and can surface through `orderLoadStatus` when present.
- Admin PWA: `admin/sw.js`
  - cache bumped from v9 to v10 so installed admin PWAs receive the new bootstrap code.
- Supabase: no schema change.

**Root cause**
- Admin startup was unnecessarily serialized behind an optional driver query and had a single failure path: any exception from current-order discovery/load jumped to the outer catch and left the original hidden dashboard sections untouched.
- The database still contains the latest completed order with 19 outlets and 177 items, so the blank initial screen was a frontend bootstrap/recovery problem rather than missing order data.

**Permanent behavior**
- A transient current-order discovery failure no longer strands the admin UI.
- A previously loaded order can be restored from the browser's saved order ID/access token.
- Optional driver configuration cannot block order loading.

**Validation**
- Verified production database contains the latest order and its 19 outlets / 177 items.
- Verified `get_current_order()`, `get_order()`, and required RPC execute privileges exist for the browser role.
- Updated frontend bootstrap and bumped the admin service-worker cache.

**Commits**
- `bc61878ccc20fd173c8320dbd9af192edf312b86` — Make admin order bootstrap resilient
- `601a36ff2922cc7ba175a055334e65823bcd2765` — Bump admin cache for bootstrap fix

**Database migration**
- None.

**Known follow-up**
- Existing historical data contains multiple old rows with `status='active'`; this should be cleaned up and future order creation should enforce a single live order/current-order policy separately.

## 2026-09-23 — Restore 3-second live synchronization
**Status:** DEPLOYED

**Why**
- The documented 3-second synchronization had drifted to a 5-minute fallback poll.
- Realtime subscriptions already existed, but the fallback was too slow when a realtime event was delayed or unavailable.

**Changed**
- Frontend: `app.js` fallback polling changed from 300,000 ms to 3,000 ms.
- README: clarified Realtime + 3-second fallback polling.
- Supabase: no schema change.
- Edge Function: no change.
- Storage: no change.

**Logic**
- Realtime event → 250 ms debounce → `syncFromServer()`.
- Fallback poll → every 3 seconds while an order/token exists.
- `syncBusy` prevents overlapping sync calls.

**Validation**
- Confirmed the old 300,000 ms interval in the repository.
- Changed it to 3,000 ms.
- Existing Realtime subscription path remains intact.

**Commits**
- `f0e16925b1db4ba9cbe2743924e4818101783519` — Restore 3-second live sync fallback
- `865e23684658244f8e086efdb140a792bb649bfc` — Document realtime and fallback sync

**Database migration**
- None.

**Known follow-up**
- Physical two-phone validation remains required.

---

# 22. CHANGE LOG

## 2026-09-23 — Add dashboard back navigation across Admin screens
**Status:** DEPLOYED

**Why**
- Admin menu options opened separate screens/dialogs, but there was no consistent one-click way to return directly to the main admin dashboard.

**Changed**
- Admin UI: added `← Dashboard` navigation to:
  - Delivery Fleet Management
  - Driver Dashboard
  - Order Packing outlet chooser
  - Active outlet packing screen
  - Historical Reports dialog
  - Delivery Invoices dialog
  - Outlet Setup dialog
  - Voice Language dialog
  - Driver Payment dialog
- Frontend: added a shared `showAdminDashboard()` navigation handler that:
  - stops active packing narration
  - hides Fleet, Driver Dashboard, and Packing screens
  - restores the main admin dashboard/home
  - closes open admin dialogs
  - scrolls to the top
- CSS: added responsive layout for screen/dialog header action groups.

**Logic**
- Every secondary admin destination now provides a direct return path to the main dashboard without relying on the three-dot menu.
- Existing `✕` dialog close behavior remains available.

**Validation**
- Confirmed navigation is wired to every newly added dashboard-back button.
- No database, RPC, Edge Function, or Storage changes required.

**Commits**
- `ec3fa39e4319c26b3cc837a918890450ed2e193b` — Add dashboard back buttons to admin screens
- `123f09be218a474dcf5baa96ce95e4a7e1a7a72f` — Add dashboard back button to packing chooser
- `125328c293f819d56ab35987850a3ed291b4a001` — Add admin dashboard navigation from all screens
- `67e0b61042110df09132fba5e5f45cc6d0aa051a` — Style admin dashboard navigation buttons
- `90266936c6a2eb5c345591046d4c139d4004f41b` — Bump admin cache for dashboard navigation

**Database migration**
- None.

**Known follow-up**
- Physical browser/PWA validation should confirm the buttons render correctly on desktop and mobile after service-worker/browser cache refresh.

---

## 2026-09-23 — Add simple security options and live delivery status to Admin home
**Status:** DEPLOYED

**Why**
- Admin security actions should be easy to find under Options rather than as extra header icons.
- The main Admin screen should show live delivery progress alongside packing progress so delivery status does not require opening the Driver Dashboard.

**Changed**
- Admin Options now contains plain-language buttons: Reports / Export, Outlet Setup, Voice Language, Order Packing Screen, Driver Dashboard, Delivery Fleet Management, Change Password, Log Out.
- Removed the separate injected Change Password / Log Out header controls.
- Added a Live Delivery Status section directly below the packing/order summary with Delivered, Pending Delivery, Packing, Unassigned and Delivery Issues counts plus outlet-level status.
- Live delivery status refreshes on authentication, manually via Refresh, and automatically every 30 seconds while the main dashboard is visible.
- Edge Function `driver-api` now uses the database `is_current=true` order as the authoritative live order, with the previous active-order lookup retained as fallback.
- Admin PWA cache bumped to v15.

**Validation**
- `driver-api` deployed successfully as version 29.
- Frontend uses the existing authenticated admin password only for the privileged dashboard endpoint; no new secret is exposed.
- No database migration required.

**Commits**
- `a7feb3bae15d15d009e23ded221ed0fa5e54a396` — Expose admin security actions in options menu
- `dcee33354f60244b07f2c0b0ee55a6e26a3f0e0b` — Notify admin dashboard after authentication
- `646360206fdd65085e9f5e3519075d94cda38325` — Add simple admin security options and live delivery status
- `31d49c3a07b405e74aac522d9614206a39399f3a` — Use current order for live delivery status
- `64c2a7dea1e2a2e692d6f85cc3390f26aeb72c65` — Show live delivery status on admin dashboard
- `9785ef8aa22fb01991121fe3cdab9779ed746980` — Use live packing count in delivery summary
- `7e536d54170a1ccecf49a0549fa7350e6cab054f` — Style live delivery summary on admin dashboard
- `e77792ee342a040f585856a80069e600b94d4c1e` — Bump admin cache for live delivery status

**Edge Function**
- `driver-api` version 29 is active in production.

**Database migration**
- None.

**Known follow-up**
- Physical browser/PWA validation should confirm the new home summary appears after the service-worker update.

---

# 22. FUTURE CHANGE LOG

Every future change goes here in this format:

## YYYY-MM-DD — <short change title>
**Status:** PLANNED / IN PROGRESS / TESTED / DEPLOYED

**Why**
- Business/user reason.

**Changed**
- Frontend:
- Admin:
- Driver:
- Supabase:
- Edge Function:
- Storage:
- PWA/cache:

**Logic**
- Exact behavior/state transitions.

**Validation**
- Tests performed and results.

**Commit**
- Git SHA:

**Database migration**
- Migration name/version, if applicable.

**Known follow-up**
- Any remaining issue.

---

# 23. RECOVERY COMMAND/REFERENCE ORDER

When a new developer/AI takes over, read in this exact order:

1. `PROJECT_MASTER.md` (this file)
2. `README.md`
3. repository tree
4. `app.js`
5. `admin/auth.js`
6. `admin/index.html`
7. `driver/driver.js`
8. `driver/index.html`
9. `config.js`
10. all files under `supabase/`
11. current Supabase tables/RPCs
12. current Edge Function version
13. recent Git commit history
14. Section 16 testing checklist
15. Section 22 future change log

Do not start coding before completing this context recovery.

---

# 24. GOLDEN RULE

**The code implements the system. This file explains the system. Git history explains how it evolved. Supabase contains the live state/schema. All four must stay aligned.**

Whenever we make a change, update this document so that a future session can continue without reconstructing the project from memory.


## 2026-09-23 — Fix Admin Dashboard Login Session Creation

**Status: DEPLOYED**

### Problem
After the Admin password was entered, the dashboard displayed:
**“Could not verify password. Please retry.”**

The password verification RPC itself was working. The failure occurred immediately afterward while creating the new server-backed Admin session.

### Root cause
The Admin session functions use pgcrypto functions. In production, gen_random_bytes() and digest() are installed in the extensions schema, while the security-definer session functions use search_path = 'public'.

Therefore the valid-password path in create_admin_session() could not resolve:
- gen_random_bytes()
- digest()

The browser caught that RPC exception and displayed the generic login error.

### Fix
Qualified the pgcrypto calls explicitly:
- extensions.gen_random_bytes(32)
- extensions.digest(..., 'sha256')

Updated functions:
- create_admin_session(text)
- verify_admin_session(text)
- revoke_admin_session(text)

Production database was updated immediately and the migration source was corrected so future reconstruction does not reintroduce the bug.

### Verification
- Confirmed production pgcrypto functions are in schema extensions.
- Confirmed verify_admin_password(text) uses the existing qualified extensions.crypt().
- Confirmed the corrected session functions compile successfully.
- Confirmed invalid-password session creation returns no session rather than raising the previous missing-function error.
- No Admin session test token was left active.

### Relevant commit
- e9de54d69cf0da67d2086bdf8597a149306ed08e — Fix admin session crypto function resolution

### Security
No password, session token, or secret was stored in source control. Session tokens remain hashed in public.admin_sessions.


## 2026-09-23 — Correct Admin Dashboard KPI Refresh

**Status: DEPLOYED**

The Admin screenshot showed the top dashboard KPIs still at their initial values:
- Current Outlets: 0
- Packing Progress: 0%
- Pending Deliveries: 0
- Delivery Issues: 0

Production data verification for the current order showed:
- 19 current outlets
- 19/19 outlets packing-completed
- 698 required quantity
- 695 packed
- 3 missing
- packing resolution = 100%
- 1 delivery record exists and is pending
- remaining current outlets have no delivery record yet, so all 19 outlets are pending delivery
- 1 rejected quantity exists on Bopal - MP; combined with 3 packing-missing quantity, the existing Delivery Issues definition is 4

### Root cause
The Admin authentication flow and the main app order bootstrap could complete at different times. The Admin dashboard could therefore become visible while its top KPI elements still contained their HTML defaults.

### Fix
After the Admin-authenticated event, the Admin page now:
1. Ensures the current order is loaded when state is empty.
2. Re-renders the dashboard immediately when state already exists.
3. Refreshes live delivery status as before.

Also renamed the KPI label from Active Outlets to Current Outlets because the value represents the current order's outlet count, not outlets actively being packed.

Admin service-worker cache was bumped to packing-assistant-admin-v20.

### Relevant commits
- bf729fa8313be7e0696f1b11f0b6bf186b9d0167 — Refresh admin dashboard data after authentication
- 23ed7fc85153ce30aa88a3d96aa35f1350386cc4 — Clarify current outlet dashboard metric
- 4fc6691728261fccd10660b5d1c2029080f50bcf — Bump admin cache for dashboard data refresh


## 2026-09-23 — Full Admin Dashboard Stability / UX Optimization Audit

**Status: IMPLEMENTED / DEPLOYMENT VALIDATION IN PROGRESS**

A full static and production-data audit was performed across the Admin Dashboard, including navigation, dashboard refresh, live delivery, packing analysis, fleet/driver screens, mobile sidebar behavior, scrolling, visual overflow, search, session continuity, caching, and JavaScript validation.

### Issues found and solutions

1. **Admin order polling was unnecessarily aggressive**
   - Problem: the shared packing fallback poll ran every 3 seconds on Admin too.
   - Impact: repeated get_order calls and repeated Admin rendering while the operator was not on a live packing screen.
   - Fix: Admin fallback polling is now 10 seconds; staff packing remains 3 seconds.
   - Admin polling pauses while Fleet/Driver Dashboard screens are open and resumes for Dashboard/Packing screens.
   - Supabase Realtime remains the fast update path.

2. **Admin delivery-charge RPC was being called on every Admin order refresh**
   - Problem: every fallback order sync also requested outlet delivery charges.
   - Fix: delivery charges are cached for 30 seconds and reused between refreshes.
   - This reduces redundant database traffic without making settings stale for longer than the normal dashboard refresh window.

3. **Realtime subscription errors were silent**
   - Problem: subscribe had no status/error callback.
   - Fix: CHANNEL_ERROR and TIMED_OUT are now logged so live-sync failures can be diagnosed while the fallback poll continues to protect data freshness.
   - Production verification confirmed outlets and order_items are both in the supabase_realtime publication.

4. **Live delivery requests could overlap**
   - Problem: a slow 30-second delivery request could overlap the next refresh.
   - Fix: added a request-in-progress guard.
   - Driver Dashboard analytics received the same protection.

5. **Header Refresh did not refresh every visible module**
   - Problem: it only refreshed the packing order.
   - Fix: Header Refresh now refreshes the live delivery summary and whichever Fleet, Driver Dashboard, or Packing Overview screen is currently visible.

6. **Mobile sidebar had incomplete dismissal behavior**
   - Problem: sidebar could remain open after tapping outside it; no Escape handling.
   - Fix: outside-tap dismissal, Escape-to-close, aria-expanded state, body scroll locking, and a mobile backdrop were added.

7. **Main dashboard live delivery table was hidden**
   - Problem: the live delivery summary existed, but the actual outlet-by-outlet status table used display:none.
   - Fix: table is now visible directly on the main dashboard with a bounded scroll area and sticky table headers.
   - It shows outlet, driver, status, missing, rejected, and last-update information.

8. **Dashboard search was only visual**
   - Problem: the header search looked interactive but was not an input.
   - Fix: it is now a real search field with Ctrl/Cmd+K focus.
   - It can locate outlets, products/item codes, and drivers and scrolls directly to the relevant Packing Analysis filter.
   - Common terms for Packing, Delivery/Fleet, and Reports navigate directly to those modules.

9. **Fleet navigation did not update the active sidebar state**
   - Fix: opening Delivery Fleet Management now highlights Delivery & Fleet and closes the mobile sidebar.

10. **Active Admin session could expire server-side during long active use**
    - Problem: the browser local inactivity timer could remain active while the server-backed session reached its one-hour expiry.
    - Fix: while the Admin is actively used, the browser refreshes the server-backed Admin session approximately every 10 minutes.
    - Network errors are logged without immediately forcing logout; an explicit invalid/expired session still logs the Admin out.

11. **Dashboard scrolling / mobile visual polish**
    - Added horizontal-overflow protection, touch-friendly table scrolling, sticky delivery-table headers, focus-visible states, mobile panel sizing, and safe text wrapping.
    - Mobile sidebar backdrop prevents accidental interaction with the dashboard behind the open menu.

12. **JavaScript validation regression discovered during audit**
    - GitHub Actions exposed a pre-existing literal backslash-n before function showAdminDashboard in app.js, which caused Node syntax validation to fail.
    - Fixed the invalid token.
    - This was caught and corrected before final deployment validation.

13. **Admin PWA cache**
    - Cache version was advanced through v24 so the optimized HTML/CSS/JS is not trapped behind the previous service-worker cache.

### Production data verification

Current production order:
- 19 current outlets
- 19/19 outlets completed packing
- 698 required quantity
- 695 packed quantity
- 3 missing quantity
- Packing completion calculation = 100%
- 1 delivery record exists and is currently pending
- The live delivery model therefore reports all 19 packed outlets as pending delivery until each is marked delivered.
- Existing Delivery Issues KPI combines current packing missing quantity and driver rejection quantity; production currently has 3 missing + 1 rejected = 4 issues.

### Supabase / production verification

- driver-api production Edge Function remains ACTIVE at version 30.
- outlets and order_items are confirmed in the supabase_realtime publication.
- No database schema changes were required for this dashboard optimization.
- Supabase current guidance was checked for Realtime subscription status/error handling and PostgREST retry behavior.

### Validation / deployment

- Pages deployment for commit bc024c3ddcdbc6fd8d1422d159319983aa2c418b completed successfully before the final syntax/cache corrections.
- Latest commits trigger fresh Pages deployment and JavaScript validation.
- Final code/cache commit: 4eb350ab5df3827405e964689546ec93cf94ccc4.


## 2026-09-23 — Permanent Damaged-Item Photo Fix / Driver Evidence Audit

**Status: DEPLOYED / VERIFIED**

The damaged-item photo workflow was re-audited end-to-end after the driver continued showing the misleading "Outlet is not assigned to this driver" error.

### Root cause found

The live production rejection record was inspected directly.

Affected production record:
- Outlet: Bopal - MP
- Driver: Lux
- Driver account ID and outlet assignment ID match
- Rejected item: Capsicum Tricolour
- Rejected quantity: 1
- Rejection reason: DAMAGE
- Packing state: PACKED
- Rejection photo list: empty

The previous Edge Function required the underlying packing item to have status MISSING or PARTIAL before generating a damage-photo upload target. A legitimately damaged delivered item can be PACKED (for example, 7 packed and 1 of those 7 later rejected as DAMAGE). This made the evidence workflow inconsistent with the rejection workflow.

The driver-to-outlet assignment itself was verified in production and is correct. The error text therefore obscured the actual evidence-state validation problem and made diagnosis difficult.

### Permanent fix

1. driver-api damaged-evidence authorization now accepts item states:
   - PACKED
   - PARTIAL
   - MISSING
2. The server still requires:
   - valid driver session
   - stable outlets.driver_id assignment
   - item belongs to that outlet and resolved current order
   - a saved DAMAGE rejection with rejected quantity greater than zero
3. The server continues to derive the authoritative order ID from the assigned outlet instead of trusting the browser's order ID.
4. The save-photo path uses the same authoritative outlet/order/item validation.
5. Assignment failures now return a clear refresh/reassignment message instead of silently reusing the old generic wording.
6. Driver UI no longer shows a generic "Rejected Photo" button for every packing exception. The item list only shows the damage-photo action when a DAMAGE rejection actually exists.
7. Production Edge Function was deployed as version 31.
8. Driver PWA cache was bumped from v25 to v26 so the corrected driver code is not trapped behind the previous service-worker cache.
9. GitHub repository Edge Function source was synchronized with the deployed production version.

### Production verification

- All 19 current outlets have a stable driver account assignment.
- Bopal - MP is assigned to Lux's stable driver account ID.
- The exact affected Capsicum Tricolour rejection exists with DAMAGE / quantity 1.
- The affected item is PACKED with 7 required and 7 packed, confirming that PACKED damage is a valid real production case.
- delivery-evidence bucket exists and remains private.
- No rejected-item photo records existed before this fix, so there was no previous successful evidence upload to mask the issue.

### Relevant commits

- c81da830e0e6030aae13e8735ddbb3de40088898 — Fix damaged item evidence authorization and packed damage handling
- 7509535ad3229cc8022a606edd46c6b34ddd15aa — Fix driver damage-photo UI and evidence error handling
- 98301ef0e162aef0295e5ba73b13c62201ad19d9 — Bump driver cache for damage-photo fix

### Verification rule for future changes

Any future driver delivery/rejection change must preserve the distinction between:
- packing status (PACKED/PARTIAL/MISSING)
- delivery rejection reason (MISSING/DAMAGE)

A DAMAGE rejection must not require the packing item itself to be MISSING or PARTIAL. This is now a documented invariant.



## 2026-09-23 — Admin Mobile Layout Correction

**Status: IMPLEMENTED / DEPLOYMENT VALIDATION PENDING**

A mobile screenshot exposed a responsive-layout regression in the Admin Dashboard.

### Issues found
- The mobile header kept the search field in the same flex row as the brand and action buttons. On narrow screens this squeezed the company-name container and caused Bigly Agro Private Limited to wrap vertically one character at a time.
- The search field was also being re-enabled by a later CSS media rule, defeating the earlier mobile header rule.
- Long management tables were correctly scrollable in principle, but their containment was not explicit enough on narrow screens and could visually crowd the card boundary.

### Fix
- Mobile Admin header now uses a two-row grid:
  - Row 1: menu + Bigly Agro brand + Online/Refresh/Options
  - Row 2: full-width dashboard search
- Brand and header children now have explicit min-width:0/flex behavior.
- Company name is kept on one line with ellipsis instead of vertical character wrapping.
- Mobile logo/menu/action controls have fixed compact dimensions.
- Analysis, delivery, and driver-dashboard tables have explicit horizontal-scroll containment so wide data does not expand the page.
- Admin PWA cache advanced from v24 to v25.

### Verification
- Source/CSS audit confirmed the previous conflicting mobile search rules.
- The uploaded mobile screenshot was used to identify the exact failure mode.
- No database or API changes were required.
- JavaScript behavior was not changed.

### Relevant commits
- a08d2fa62a61096cc3d09a0ba842f5433216aa33 — Fix admin mobile header and table overflow
- b29e2038f048c593368d8e47df7a2c770b5c97fb — Bump admin cache for mobile layout fix



## 2026-09-23 — Admin Mobile Scrolling Correction

**Status: IMPLEMENTED / VALIDATION PENDING**

A second mobile test showed that the earlier header fix did not fully solve touch scrolling.

### Root cause
- Admin analysis tables inherited nested overflow:auto containers.
- The later mobile containment rule forced overflow-y:hidden on table wrappers.
- The combination of nested horizontal scrolling, hidden vertical overflow, and the sticky Admin header could make vertical finger scrolling feel trapped when the gesture started over a table/card.
- Mobile smooth scrolling was also unnecessary for manual touch scrolling.

### Fix
- Main Admin content is explicitly allowed to remain overflow-visible.
- Analysis and Driver Dashboard table wrappers now scroll horizontally without becoming vertical scroll containers.
- Live delivery table remains a bounded two-axis scroll area where required.
- Touch scrolling is explicitly enabled for both axes.
- Mobile Admin analysis cards no longer clip their table content.
- Mobile manual scrolling uses normal/native scrolling instead of forced smooth scrolling.
- Admin PWA cache advanced to v26.

### Invariant
The page itself remains the primary vertical scroll container. Only genuinely bounded data regions, such as the live delivery table, get their own vertical scroll.

### Relevant commits
- 24376114169897b61252493aa16c9880ac16c638 — Fix admin mobile vertical and table scrolling
- 12d4ff6f61f1471881c840270315118a07073777 — Bump admin cache for scrolling fix



## 2026-09-23 — Roll Back Mobile Scrolling Regression

**Status: IMPLEMENTED / DEPLOYMENT PENDING**

A mobile report showed the Admin PWA stopped loading after the latest scrolling CSS change.

### Action
- Reverted only the newest Admin mobile scrolling CSS block introduced in commit 24376114169897b61252493aa16c9880ac16c638.
- Preserved the earlier mobile header/layout correction.
- Admin cache advanced to v27 so installed PWAs receive the rollback instead of retaining v26 assets.
- No application logic, database, authentication, or delivery functionality was changed.

### Safety rule
Future scrolling changes must be isolated and validated independently before being combined with header/PWA changes.

### Relevant commits
- d5af78d06912ebe53e3d8f62b0a37f3e58ddc329 — Revert latest mobile scrolling CSS regression
- c93ba3f52dde88ee59cfbfe1373ecbba97bbc216 — Bump admin cache after scrolling regression rollback



## 2026-09-23 — Admin Mobile Blank-Page Boot Hardening
- **Status:** DEPLOYED SOURCE / PENDING FINAL Pages verification
- **Issue:** Admin PWA could still show a completely blank page on mobile after the scrolling rollback, despite successful JavaScript validation. The page used `body.adminPage{visibility:hidden}` until `admin/auth.js` executed, so any stale/cached/missed script boot left the entire application visually blank with no diagnostic state.
- **Fix:** Replaced the invisible initial state with a secure visible boot overlay. The dashboard remains covered until Admin authentication/lock handling completes; unauthenticated users still receive the normal password overlay. Added explicit removal of the boot overlay on successful session restoration/login and on logout.
- **Cache resilience:** Added versioned query strings to Admin CSS, `auth.js`, and `app.js`; Admin service-worker registration now uses `updateViaCache: "none"` and requests an update; Admin service-worker cache bumped from v27 to v28.
- **Security invariant:** The boot overlay does not expose the dashboard to unauthenticated users. `auth.js` applies `adminLocked` before allowing access and the normal login overlay remains authoritative.
- **Files:** `admin/index.html`, `admin/auth.js`, `admin/sw.js`.
- **Commits:** `44f83ddda408725aa260760380c9d53c1feb10a5`, `0ad43ccded3cfe493153e8f30b180af710c2f6b4`, `b41e913c8ded68c073d7567325cc2857baa7733c`, `e01de393ea341e8a820b58ad31b8d2b88507bb2f`, `34d6146b77bbda5a5f69ab22b56c7a545cb729a7`.


## 2026-09-23 — Admin Blank-Page Auth-Failure Fix
- Status: IMPLEMENTED
- Fixed Admin boot/auth failure ordering in `admin/auth.js` so the loading overlay is not removed before the login/session-expired UI is available.
- Auth failure now clears the boot overlay only after invoking the login UI, preventing a blank Admin page after refresh when session restoration fails.
- No database, delivery, packing, or driver logic changed.
- Commit: d38b8a41a9c0abedef5202fea411dc09dde3b44c.


## 2026-09-23 — Admin Blank-Page Auth-Failure Fix
- Status: IMPLEMENTED
- Fixed Admin boot/auth failure ordering in `admin/auth.js` so the loading overlay is not removed before the login/session-expired UI is available.
- Auth failure now clears the boot overlay only after invoking the login UI, preventing a blank Admin page after refresh when session restoration fails.
- No database, delivery, packing, or driver logic changed.
- Commit: d38b8a41a9c0abedef5202fea411dc09dde3b44c.


## 2026-09-23 — Full Admin Mobile Boot Audit and Deterministic Startup Fix
- Status: IMPLEMENTED
- User-reported failure: Admin showed “Loading Admin Dashboard” briefly after refresh and then became blank on mobile.
- Audit covered Admin HTML boot order, authentication/session restoration, service-worker cache/versioning, script loading order, dashboard visibility CSS, navigation visibility rules, mobile header/table CSS, realtime/data initialization, and existing dashboard auth handoff.
- Root reliability issue: Admin authentication was initialized independently while dashboard scripts were still loading. A failure or stale/mismatched cached script could leave the page in an inconsistent boot state. Critical scripts also loaded without a deterministic deferred startup contract.
- Fix:
  - `admin/auth.js` no longer auto-starts immediately; it exposes `PA_ADMIN_START`.
  - `admin/index.html` starts authentication only after the complete Admin script stack has loaded.
  - Supabase, SheetJS, config, auth, and app scripts now load with `defer` in dependency order.
  - Early boot error/unhandled-rejection handlers are registered before external scripts.
  - Boot overlay remains until authentication successfully unlocks the dashboard.
  - Authentication failure still produces the login screen rather than a blank page.
  - Critical Admin assets use versioned query strings.
  - Admin service-worker cache bumped to v30.
  - Service-worker registration uses cache-bypass update behavior.
  - Existing secure server-backed Admin session remains unchanged.
- Preserved:
  - Dashboard data loading and current-order logic.
  - Delivery/Fleet session authentication.
  - Packing, driver, payment, and database functionality.
  - Earlier mobile header correction.
- Commits:
  - `58838c3d1a86839d5f790f15617f230b049503aa` — defer Admin authentication startup until scripts are ready.
  - `904d21c11b1614a582f14537163e38ecaadc037b` / `a057cdb8bf48bf65e49180067640f40c7a120aa6` — Admin boot/cache hardening.
  - `6d51ed2c635d52376cac5274942f25fd3fbc0125` — deterministic deferred script boot and early error capture.
  - `671986a36d9718c1a290d34b036bddc3f0870ac8` — Admin cache v30.
- Invariant: Admin must never transition from the boot state to an inaccessible blank page. It must either unlock the dashboard or show an actionable authentication/startup error.

- Static DOM audit after the boot changes found one obsolete Admin reference to `outletList`; it was removed. Current Admin HTML has no duplicate IDs and no remaining static app.js references to missing Admin DOM IDs.
- Final cleanup commit: `bb5d1d02a90d113adf9f79f0ec3f8d7431f10eff`.


## 2026-09-23 — Admin Blank Background / Login Overlay Hardening
- Production symptom: after the boot overlay disappeared, only the page background remained on mobile.
- Root cause identified in the client architecture: the `adminLocked` CSS mechanism hid the entire Admin DOM and relied on a dynamically created login overlay to be exempt. This was fragile during session restoration/cache transitions and could leave only the body background visible.
- Permanent fix: removed the `adminLocked` DOM-hiding mechanism entirely. Authentication is now enforced by a fixed, z-indexed login overlay. The dashboard DOM remains mounted underneath it until a valid session exists, while the overlay blocks access.
- Session restoration with no valid server session now directly displays the login overlay.
- Successful authentication removes the overlay and dispatches the existing Admin-authenticated event.
- Admin cache bumped to v31 and critical assets cache-busted to 20260923-3.
- No database or delivery logic changed.


## 2026-09-23 — Persistent Outlet Delivery Charges
- **Status:** IMPLEMENTED in production database and source.
- **Issue:** Admin Outlet Setup displayed delivery charges as `0.00` again when a new packing order was created because `delivery_charge` lived only on the order-specific `outlets` rows, whose database default is 0.
- **Fix:** Added `public.outlet_delivery_charge_defaults`, keyed by outlet/store name. Admin changes now update both the current order's outlet charge and the persistent outlet default.
- **New-order behavior:** `create_order()` now copies the saved outlet delivery charge into each new order automatically. Charges therefore remain unchanged until the Admin deliberately edits and submits them.
- **Security:** The defaults table has RLS enabled and direct anon/authenticated table access revoked. Existing security-definer RPCs remain the application access path.
- **Existing data:** Existing outlet charges were seeded into the defaults table during the migration. Current production charges were all `0.00`, so no previously non-zero values were overwritten.
- **Source:** `supabase/outlet_delivery_charges.sql`.
- **Database migration:** `persistent_outlet_delivery_charges`.
- **Source commit:** `a498b1db86aa94dc2deb28487ec0a65e1ece92c3`.
- **Invariant:** Delivery charges must not reset to zero merely because a new packing order is created; they change only when Admin submits a changed value.


## 2026-09-23 — Admin Table / Page Scrolling Fix
- **Issue:** On mobile, touching/dragging inside the dashboard's Outlet-wise Summary table could trap vertical scrolling in the table area instead of scrolling the whole Admin webpage.
- **Fix:** Admin table wrappers now have an independent vertical scrollbar while retaining horizontal overflow for wide tables. Vertical touch gestures that begin on table content are explicitly routed to the page scroll; horizontal gestures remain available for wide tables. The table's native scrollbar remains directly draggable.
- **CSS:** Removed the previous vertical-scroll suppression/scroll-chain behavior for Admin tables and added a bounded table viewport (`58vh` on small screens) with native vertical scrollbar support.
- **Cache:** Admin assets bumped to `20260923-4`; service-worker cache bumped to v32.
- **Commits:** `c523eaca16f78b9476853694fabc9f0981322a71` (CSS), `f392e6c6d752b0015c74d3d0d72715b5c14ccfdb` (touch routing), `b3df9cf34f8651208d7ec9aa34f41e5a6a0a6fa5` (Admin asset cache-bust), `2389ef8425f2a71fcfde01394884b3d9ed188423` (service-worker cache).
- **Invariant:** Swiping vertically anywhere on the Admin page must move the page; table horizontal scrolling must remain available; table vertical scrollbar is independent and does not lock the whole app.


## 2026-09-23 — Admin Header Scroll Behavior
- **Issue:** The Admin header was sticky/fixed at the top while scrolling, so it remained visible instead of moving away with the page.
- **Fix:** Admin header now uses normal document flow (`position: relative`) and therefore scrolls upward and disappears naturally. No change was made to the independent table scrollbar behavior or sticky sidebar.
- **Cache:** Admin assets bumped to `20260923-5`; service-worker cache bumped to v33.
- **Commit:** `cc5c82ca3e66092248fa57bde920302a7350a849` (CSS), `c7f61e94cdf71929d9572996fffb4258f68549a6` (asset cache-bust), `92b228c76fafc0514032f667bd98bbcc6861a752` (service-worker cache).
- **Invariant:** The Admin top header must scroll away with the webpage rather than remain fixed.


## 2026-09-23 — Driver Damage Photo / Assignment Resolution Fix
- **Issue:** Damage-item photo upload could still return an outlet-assignment error even when the driver name matched the outlet assignment. This was especially relevant for valid damage on an item whose packing status was `PACKED`.
- **Backend fix:** `driver-api` damage-photo endpoints now resolve the outlet first, validate the requested order, accept the authoritative `driver_id` assignment or a normalized driver-name match, and repair a stale/missing `driver_id` when the name match is unambiguous. The endpoint now returns a specific mismatch diagnostic instead of a generic assignment failure.
- **UI fix:** Driver item tables now show **Add damage photo** whenever a saved `DAMAGE` rejection exists, including fully `PACKED` items. Previously the button was incorrectly limited to `MISSING`/`PARTIAL` item status.
- **Deployment:** `driver-api` deployed as Edge Function version **32**. Driver app asset version bumped from `26` to `27`; driver service-worker cache bumped to v27.
- **Commits:** `6bffbdeae634bfe594c4cfba60b38af8dc64a5ee` (driver-api), `d609b165a351dfa5f77c98f035e1e1fb7ac772cb` (driver UI), `8f7a802297fdec834a04923a178e28a0c7a2b7d4` (driver asset cache-bust), `95fb9b1774bb5c69f4a88d590b5a805e6b77a621` (driver service-worker cache).
- **Production verification:** Current production data confirms Bopal - MP is assigned to Lux with matching `driver_id`; the historical Bopal damage record contains `DAMAGE` rejection for Capsicum Tricolour (1 rejected out of 7 packed) and currently has zero rejection photos. The new endpoint is deployed specifically to remove the assignment-resolution failure blocking this upload.


## 2026-09-23 — Staff packing order visibility fix
- Production current order was correctly created and loaded: 17 outlets / 153 products.
- Root cause of packaging staff seeing the order summary but no outlet list: `renderHome()` rendered only `#adminOutletList`, while the staff page uses `#outletList`.
- Fixed `renderHome()` to render `#adminOutletList` on Admin and `#outletList` on the staff page.
- Bumped staff service-worker cache from v3 to v4 so the corrected app.js is refreshed.
- Commits: `3eaf660e1589899e0a7d0f92a43d222d48c8d30f`, `dbb32cd91226564bb04c1893887f9b4b48cc8b9c`.


## 2026-09-23 — Staff outlet rendering/cache hardening
- User still saw the current order summary (17 outlets / 153 products) but no outlet buttons after clearing site settings.
- The staff page source uses `#outletList`; Admin uses `#adminOutletList`.
- Hardened `renderHome()` with a dedicated `renderStaffOutletList()` that explicitly renders the staff outlet buttons and removes any hidden state from `#outletList`.
- Added explicit staff asset cache-busting for `app.js`, `config.js`, and the service-worker registration using `updateViaCache: "none"`.
- Packer service-worker cache bumped v4 → v5.
- Commits: `8c72a73b6bac0be7b6a0702f052ff827b2fbb17d`, `4165197b2f0e269d30874c5f4b22136151be1231`, `f56f74363cc7dac108f8b7d49dd5dc706ce5bb54`.


## 2026-09-23 — Packing narration stutter fix
- Staff narration was audibly glitching/restarting, e.g. **“ba-ba-ba Basil”**.
- Root cause: `speakProduct()` automatically retried each utterance up to 4 times and could call `speechSynthesis.cancel()` immediately before another `speak()`; background renders/syncs could also restart the same item. Browser speech cancellation can generate cancellation/interruption events, so automatic error retries amplified the stutter.
- Fixed `app.js` narration to:
  - speak each item once automatically;
  - ignore duplicate narration requests for the same currently speaking item;
  - use a generation guard so stale utterances cannot restart;
  - add a short 80 ms gap after cancellation before a new utterance;
  - never auto-retry speech errors;
  - keep **Repeat** as an explicit manual repeat action.
- Voice-language change also explicitly forces one fresh narration.
- Bumped packer asset versions and service-worker cache so phones receive the new code: `app.js?v=20260923-3`, `config.js?v=20260923-3`, SW cache `packing-assistant-v6`.
- Commits: `8fae10f`, `5d62133`, `d86a2b6`, `b1f93b8`.


## 2026-09-23 — Inventory Module
- **Status:** Implemented in production schema and GitHub source.
- **Route:** `/packing-assistant/admin/inventory.html`
- **Integration:** Admin Inventory navigation now opens the self-contained Inventory route while reusing the existing Admin authentication/session, dashboard layout, sidebar and Supabase project.
- **Restaurant Inventory:** Start dated count with staff name; barcode scan via phone camera; USB/Bluetooth keyboard scanners; fuzzy item search with Fuse.js across name/aliases; category grouping; add item; CSV/XLSX first-setup import; submit count.
- **Unknown barcode:** User searches/selects the item and the scanned barcode is permanently linked through `inv_link_barcode`.
- **Offline:** Count rows are queued in IndexedDB and automatically synchronized when connectivity returns. Pending rows block session submission until synchronized.
- **No overwrite/delete:** Stock counts are append-only. Recounts create new `inv_stock_counts` rows. Item removal is represented by `active=false` at the data-model level; the current UI does not hard-delete.
- **Reports:** Latest stock per item, count history, not-counted CSV, date/staff filters, browser-generated CSV.
- **Vegetables Inventory:** Placeholder only. The same schema supports `section='vegetable'` without schema changes.
- **Database tables:** `inv_items`, `inv_item_barcodes`, `inv_count_sessions`, `inv_stock_counts`.
- **Security:** All four inventory tables have RLS enabled and direct `anon`/`authenticated` table privileges revoked. Browser access is through explicitly granted inventory RPCs that validate the existing Admin session token. Security-definer functions use an empty search path and schema-qualified references.
- **Files:** `admin/inventory.html`, `admin/inventory.css`, `admin/inventory.js`, `admin/inventory-nav.js`, `.github/workflows/inventory-backup.yml`.
- **Backup:** Weekly GitHub Actions workflow dumps only the `inv_` tables, encrypts the dump with a GitHub secret, and stores the encrypted artifact for 30 days. Configure repository secrets `SUPABASE_DB_URL` and `INVENTORY_BACKUP_KEY`; the workflow never writes plaintext inventory data to the repository.
- **Dependencies:** html5-qrcode, Fuse.js and SheetJS are loaded from free public CDNs. No paid service/library was added.
- **Important:** The existing Admin authentication is custom-session based rather than Supabase Auth. Inventory authorization therefore validates the established Admin session RPC rather than inventing a second login system.
