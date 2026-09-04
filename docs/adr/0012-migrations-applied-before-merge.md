# ADR-0012: Migrations applied to production before the code that needs them merges

- **Status**: Accepted
- **Date**: 2026-09-04
- **Depends on**: ADR-0005, ADR-0011

## Context

ADR-0011 deliberately left a gap open: database migrations are applied to production by hand, and
nothing verifies that the production schema matches `supabase/migrations/`. Merging a PR makes
Vercel deploy `main` to production immediately (ADR-0005). If that merge carries code that needs a
new column and nobody has run `supabase db push` first, production runs new code against an old
schema until a human notices — and nothing in CI catches it.

This has been harmless so far because there have been no schema changes since the cutover. The
Cohort 4 code port's first stage adds `priority` and `order_index` to `tasks` plus new `tags`,
`task_tags`, and `audit_logs` tables — the first schema change since this gap was identified — so
it is worth closing before that stage starts.

## Decision

**Migrations are applied to production before the code that needs them is merged**, and CI fails
the PR until that has happened.

A new `Migrations applied to production` job runs `supabase migration list --db-url
"$SUPABASE_DB_URL" --output-format json` and parses the result: an entry with a non-empty `local`
version and an empty `remote` version is a migration that exists in the repo but was never pushed.
The CLI's exit code cannot be used for this — it exits 0 even when local and remote disagree — so
the JSON payload is parsed instead. Parsing lives in `src/migrations/migrationDrift.ts`, a pure,
unit-tested module with no I/O; `scripts/checkMigrationsApplied.ts` is the thin runner that spawns
the CLI and turns drift into a non-zero exit code.

**This ordering is safe only for backward-compatible (additive) migrations** — a new nullable
column or a new table does not disturb the code already running against the old schema. Every
migration in this project so far is additive, and the whole Cohort 4 port is additive by design.

**Rule for destructive changes**: a migration that drops or renames anything must be split into two
separately merged PRs — first the code that stops using the thing, then the migration that removes
it. This ADR does not enforce that split in code; it is documented here and in
`docs/runbooks/migrations.md`.

The job runs on both `pull_request` and pushes to `main`, with no `if:` guard: the pre-merge run is
the gate, and the post-merge run catches a migration that was reverted out of the repo without
being rolled back in the database. It is independent of the other CI jobs (`needs:` nothing), so it
reports in parallel rather than gating on `fast` first.

This closes the second of the two gaps ADR-0011 deliberately left open. (The first — production
deploys not being gated on CI at all — remains open; see ADR-0011's consequences.)

## Consequences

- A schema change now has an explicit two-step order: push the migration to production, confirm
  `npm run check:migrations` is clean, then merge the code. `docs/runbooks/migrations.md` is the
  working procedure.
- `SUPABASE_DB_URL` is a new repo secret, holding the session-pooler connection string (IPv4,
  reachable from GitHub Actions runners) rather than the direct `db.<ref>.supabase.co` host in
  local `.env`, which is IPv6-only.
- Merging a PR is blocked until that secret exists, once `Migrations applied to production` is
  added to `main`'s required status checks.
- A destructive migration still requires human discipline to split into two PRs; nothing here
  enforces that mechanically.

## Alternatives rejected

- **Auto-run `supabase db push` from CI on merge to `main`.** Races Vercel's own auto-deploy — the
  schema and the code can still land in either order depending on which finishes first — and it
  hands a CI job write-DDL access to production for no real gain over doing it by hand ahead of
  the merge.
- **A schema-diff check (`supabase db diff`).** Would also catch drift introduced by hand-editing
  the schema through the Supabase dashboard, which `migration list` cannot see since it only
  compares version identifiers. Rejected because it needs a shadow database and Docker in CI —
  far more machinery than this failure mode warrants, given no hand-editing has happened in this
  project's history.

## Out of scope

- Detecting schema changes made by hand in the Supabase dashboard (see the rejected schema-diff
  alternative above).
- Gating the production *deploy* itself on CI — that is the other gap ADR-0011 left open, and is a
  Vercel configuration change, not a CI one.
- Applying any migration. This check only detects drift; it never writes to the database.
