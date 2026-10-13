# Changelog

## 2026-10-13 — Expense Management SQL review revision
- Revised migration and rollback review files; added a rollback-only safety test script.
- Added atomic claim create/reopen functions, after-reopen expense release, hard-delete blocking, India-local date fallback, common balance view, and role revokes/grants.
- No live migration, tests, backup, deployment, UI build, or cache/version changes were performed.


## 2026-10-13 — Expense SQL review approved edits
- Seed default employee as Abhishek. Safety test now checks anon/authenticated/PUBLIC EXECUTE access and attempts a real expense SELECT as anon.
- No test has been run yet. Claim-number counter reset is allowed only after a passing safety test and after confirming no real claims exist.
- Supabase plan selection remains ambiguous ([Free / Pro]); backup status unknown and no backup created through connected tools.
