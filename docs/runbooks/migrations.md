# Runbook: applying a database migration

Migrations are applied to production by hand, and CI only *detects* drift — it never writes to the
database (ADR-0012). The ordering below is what keeps that safe: the schema always lands before
the code that depends on it.

## The procedure

1. **Write the migration file** in `supabase/migrations/`, named the same way as the existing
   files (a sortable timestamp prefix).
2. **Push it to production**:
   ```bash
   supabase db push --db-url "$SUPABASE_DB_URL"
   ```
   Use the direct connection string from local `.env` here — the session-pooler URL is for the
   read-only `migration list` check below and for CI, not for running DDL.
3. **Confirm the check is clean**:
   ```bash
   npm run check:migrations
   ```
   This should print `N migration(s) in sync with production.` If it instead reports the migration
   you just pushed as unapplied, the push above did not reach the database you're checking —
   compare hosts in both connection strings before retrying.
4. **Push the code** that depends on the new schema, open the PR, and merge as normal. The
   `Migrations applied to production` CI job will pass because the schema is already there.

Never reverse steps 2 and 4 — merging code that expects a column before that column exists is
exactly the failure mode this check exists to catch.

## What a red check means

`Migrations applied to production` failing on a PR means `supabase/migrations/` contains a file
that was never pushed to production. Two ways to get here:

- **You forgot step 2 above.** Run `supabase db push` against production, then re-run
  `npm run check:migrations` locally to confirm before pushing again.
- **`SUPABASE_DB_URL` itself is wrong** (rotated password, wrong host). The check fails the same
  way whether the migration is genuinely missing or the check can't see the real database — verify
  by running `npm run check:migrations` locally against the same connection string CI uses (the
  session-pooler URL, not the direct host) before assuming the migration itself is the problem.

The job also runs on every push to `main`, not just PRs — a green PR followed by a red push to
`main` usually means a migration file was reverted out of the repo without also being rolled back
in the database (the reverse drift: applied in the database, absent from the repo).

## The destructive-change rule

This check only understands additive migrations — a new nullable column or a new table doesn't
disturb code already running against the old schema, so pushing the migration first is always
safe. **A migration that drops or renames anything is not safe to push first**: production code
still running the old query would break the instant the migration lands, before the new code that
stops using the old shape has even merged.

Split a destructive change into two separately merged PRs:

1. **Code first** — ship the code that stops reading/writing the column, table, or shape being
   removed. Merge and let it deploy.
2. **Migration second** — once the old code is confirmed gone from production, write and push the
   migration that actually drops it, following the procedure above.

This rule isn't enforced by the CI job — `migration list` has no way to tell an additive migration
from a destructive one. It's a human judgment call at PR-review time.

## Local setup

`npm run check:migrations` reads `SUPABASE_DB_URL` from the environment (via `dotenv/config`, so
local `.env` works). It must never print the value — passwords included — so if you're debugging a
failure locally, treat any CLI error output pasted into a PR or chat as needing a scrub pass first,
same as the value itself.
