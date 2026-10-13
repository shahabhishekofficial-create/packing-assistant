# Changelog

## 2026-10-13 — Expense Management SQL review revision
- Revised migration and rollback review files; added a rollback-only safety test script.
- Added atomic claim create/reopen functions, after-reopen expense release, hard-delete blocking, India-local date fallback, common balance view, and role revokes/grants.
- No live migration, tests, backup, deployment, UI build, or cache/version changes were performed.
