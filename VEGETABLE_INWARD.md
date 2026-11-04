# Vegetable Inward

Goods received from vendors, weighed once, then sorted into A grade, B grade and
Dump. Sorting can happen later, so an entry can be saved with the total only
("Sorting pending") and finished the same day or afterwards.

This is a new module beside the existing vegetable count screens. It does not
change them.

---

## 1. Rules the module enforces

| Rule | Where it is enforced |
| --- | --- |
| One row = one trip. The same vendor and vegetable can come many times a day. | `veg_inward_entries` (no uniqueness on vendor + item + day) |
| The same vegetable from two vendors is always reported separately. | summary groups by item **and** vendor |
| Weights are integer grams. Typed kg is converted by string arithmetic with at most three decimals, never by floating point. | `veg_inward-api` (`grams()`), database `bigint` columns |
| A + B + Dump can never exceed the total. | database `check`, and the API before writing |
| Grades are all-or-nothing, and sorting is one-way. | database `check`; `complete_sorting` refuses different values with *Already sorted. Ask the admin to correct it.* |
| Entries are never hard deleted. | `before delete` trigger; the API only sets `deleted_at` + `delete_reason` |
| Percentages are A (or B, or Dump) of the **sorted** weight only. Pending weight is reported separately and never enters a percentage. | `veg_inward_summary` in the database |
| Every create, sort, edit and delete is recorded with the row before and after. | `veg_inward_audit` |
| The browser adds nothing up. | the admin screen renders summary rows as given; the exporter reads the same rows |

Business dates are Indian dates (`Asia/Kolkata`), not server dates.

## 2. File map

| File | Purpose |
| --- | --- |
| `vegetable-inward.html` / `.css` / `.js` | Staff entry screen (new, next to the count page) |
| `manifest-vegetable-inward.webmanifest` | Install target for the staff screen |
| `admin/vegetable-inward.html` / `.css` / `.js` | Admin dashboard, entries, vendors |
| `vegetable-inward-export.js` | Excel + PDF export used by the admin screen |
| `supabase/functions/veg-inward-api/index.ts` | The API |
| `supabase/migrations/20261104000100_vegetable_inward_v1.sql` | Tables, guards, summary |
| `supabase/migrations/20261104000200_vegetable_inward_api_helpers.sql` | Session check + item list helpers for the API |
| `supabase/tests/vegetable_inward_v1_test.sql` | Synthetic acceptance test (always rolled back) |
| `supabase/rollbacks/20261104000100_vegetable_inward_v1.sql` | Removes the module |

Links were added in one place each: the staff count page top bar and the admin
vegetable inventory actions row. No existing screen logic was changed.

## 3. Database objects

New objects only — no existing table, function or grant was altered.

* `veg_inward_vendors` — `id`, `name`, `name_key` (generated, unique on
  `lower(btrim(name))`), `active`, `created_at`. Vendors are deactivated, never
  deleted.
* `veg_inward_entries` — `id` (created on the phone), `item_id` → the live
  vegetable item table (`public.inv_vegetable_items`, restrict), `vendor_id` →
  vendors (restrict), `received_at`, `total_g`, `a_g`, `b_g`, `dump_g`,
  `sorted_at`, `notes`, `entered_by`, `deleted_at`, `delete_reason`,
  `created_at`, `updated_at`.
* `veg_inward_audit` — `entry_id`, `action` (`create`/`sort`/`edit`/`delete`),
  `before`, `after`, `actor`, `at`.
* `veg_inward_summary(p_from_date, p_to_date, p_item_id, p_vendor_id)` —
  `stable`, `security definer`, empty `search_path`. Returns one row per item
  (subtotal), one per item-and-vendor, and a grand total, with gram values as
  text and percentages to one decimal. Row cap 20,000 with `ROW_LIMIT_EXCEEDED`.
* `veg_inward_whoami(p_admin_token, p_staff_token)` — accepts the admin session
  or a staff session exactly the way the existing inventory RPCs check it.
* `veg_inward_items()` — the active vegetable list for the inward screens.
* Trigger helpers: `veg_inward_touch_updated_at()`,
  `veg_inward_block_hard_delete()`.

Row level security is on for all three tables. `public`, `anon` and
`authenticated` have no privileges on them and cannot execute the summary;
 `service_role` owns access. The item table is only read through
`veg_inward_items()`.

## 4. API

Entry rows are read as plain rows; vegetable and vendor names are joined inside
the function from two small lookups (`veg_inward_item_names()` and the vendor
table). Foreign-key embedding is deliberately not used, so the screen does not
depend on PostgREST's relationship cache.

Endpoint: `POST /functions/v1/veg-inward-api` (JWT verification off; the session
gate below is the authority). CORS allows the project site origin only. The
function logs the action name and the result code, nothing else.

The session gate runs before any table is touched and accepts **either** the
admin session (`admin_session`) **or** a staff session (`staff_session`,
the same passwordless token the vegetable count page already uses). Each action
declares who may call it:

| Action | Who | Notes |
| --- | --- | --- |
| `bootstrap` | staff, admin | vegetable list, active vendors, today's entries |
| `add_vendor` | staff, admin | trims and collapses spaces, max 60; the same name key returns the existing vendor |
| `create_entry` | staff, admin | idempotent on the phone id; a repeat returns the existing row with `duplicate: true` |
| `complete_sorting` | staff, admin | once only; identical values are success, different values return `ALREADY_SORTED` |
| `update_entry` | admin | reason required; before/after written to the audit |
| `delete_entry` | admin | reason required; soft delete |
| `list_entries` | admin | 50 per page, filters, stable order |
| `summary` | admin | the database summary |
| `export_rows` | admin | 1,000-row pages; the last page checks count and gram totals against the summary and returns `DATA_CHANGED` if they differ |
| `rename_vendor` | admin | added for the admin Vendors panel |
| `set_vendor_active` | admin | added for the admin Vendors panel |

`rename_vendor` and `set_vendor_active` are the two actions beyond the original
list: the admin screen has to rename and deactivate vendors, and no other action
covered it.

Session problems return `SESSION_EXPIRED` and the staff screen keeps the typed
entry on screen.

## 5. Offline behaviour (staff screen)

* A phone id is created before the first send; retries reuse it, so a retry can
  never create a duplicate.
* The form is written to browser storage on every change and restored after a
  reload or a crash with *Restored your unsaved entry*.
* If the call fails or the phone is offline the entry goes into an IndexedDB
  queue (`bigly-veg-inward-v1`) and is retried on reconnect, on the tab becoming
  visible, on a timer and from **Sync now**. The bottom bar always shows how many
  entries are waiting, or that the connection is down.
* Leaving with unsynced data asks for confirmation.
* "Saved" appears only after the server confirms.

## 6. Service worker behaviour (reported, not changed)

Both workers were left untouched.

* The staff worker (`sw.js`) precaches a fixed list that does not include the new
  page. Every navigation is network-first and stored on the way through, so the
  new page and its CSS/JS are available offline **after the first visit**; before
  the first visit, a completely offline launch shows the worker's plain offline
  response.
* The admin worker (`admin/sw.js`) behaves the same way for
  `admin/vegetable-inward.*`.
* Consequence: after installing the app offline for the first time, the staff
  member should open the inward page once while online. Adding the page to the
  precache list would remove that caveat but means editing `sw.js`, which this
  change deliberately did not do.

## 7. Reused assets

- The web app manifest (`manifest-vegetable-inward.webmanifest`) points at the existing vegetable icon set (`icons/vegetable-*.png`, maskable variants included); no new images were added.
- The admin screen loads ExcelJS, jsPDF and the AutoTable plugin from the same pinned CDN versions as the other export screens, and only after **Prepare** is tapped.

## 8. Rollback

`supabase/rollbacks/20261104000100_vegetable_inward_v1.sql` drops the module's
functions, triggers and three tables. It does **not** touch anything else. Export
the data first if the module has been used, because the three tables are dropped.

The edge function can be removed with `delete_edge_function` (slug
`veg-inward-api`). Front-end files are inert if the function is missing; the
links can be removed from the two existing pages.

## 9. Built, tested, untested

**Built:** database objects and helpers (applied, including
`veg_inward_item_names()`), API (deployed as version 3), staff screen, admin
dashboard, export module, links, this document.

**Tested:**

* Synthetic, rolled-back database test (`supabase/tests/vegetable_inward_v1_test.sql`):
  one trip of 80 kg sorted 40 / 30 / 10 reports A 50.0 %, B 37.5 %, Dump 12.5 %;
  a second trip of 20 kg sorted 10 / 6 / 4 makes the total 100 kg with A 50.0 %,
  B 36.0 %, Dump 14.0 %; a second vendor of the same item is a separate row; a
  pending trip counts in pending and moves no percentage; item subtotals and the
  grand total match; sorted above total is rejected; a partial grade set is
  rejected; a duplicate vendor name key is rejected; hard delete is blocked; a
  reversed date range is refused; `anon` and `authenticated` can neither read the
  tables nor execute the summary, and `service_role` can.
* Privileges and row level security read back after applying.
* Existing table row counts compared before and after the migration: unchanged.
* The helper functions were called through the connector: an unknown token
  returns no role, the item list returns the live vegetable list, and the
  name list returns every item including inactive ones.
* Front-end: 31 headless checks against a stubbed data layer, all passing —
  staff boot and build stamp, the live sorted/unaccounted line, an entry saved
  with integer grams and a phone-made id, the second-truck warning and its one
  confirm tap, the sorting dialog on a pending trip, the one-confirm-tap
  difference, a triple tap sending a single entry, the session-expired message
  keeping the typed values, draft restore after a reload, an offline save
  queuing and syncing once with the same id, the admin cards and grouped table
  with vendor subtotals, the presets and their date ranges, admin edit and
  delete with reasons, vendor rename and deactivate, no script errors, no
  horizontal overflow at 320 and 390 px.

**Not tested**

* Nothing has been run on a real phone by the user yet. The first phone attempt
  failed to load the list; the cause and the fix are in `PROJECT_STATUS.md`, and
  the fixed build has only been checked in a headless browser.
* The API has not been exercised end to end from a browser in this environment
  (the sandbox cannot reach the project domain, and the function only answers the
  site origin). Server responses in the front-end checks were stubbed.
* Excel and PDF output have not been opened in Excel or a PDF viewer here.
* The 20,000-row summary cap and the `DATA_CHANGED` path were not reproduced with
  real volume.
* The service worker offline caveat in section 6 was reasoned from the worker
  source, not measured on a phone.

## 10. Known weakness in the staff login (reported, not fixed)

The staff screens use a passwordless staff session: the page asks the database
for a session token and receives one without a PIN. That is the existing
behaviour of the vegetable count page, and the new screen does not change it.
Anyone who has the public app key and opens the page can therefore obtain a staff
session. The inward screens only expose what a staff entry needs (add a trip,
complete sorting), but it is worth deciding separately whether the counting and
inward screens should require the staff PIN that `inv_staff_login` already
supports.
