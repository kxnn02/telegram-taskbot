# ADR-0006: Database schema and concurrency control

- **Status**: Accepted (planning only — not yet implemented)
- **Date**: 2026-08-31
- **Depends on**: ADR-0001, ADR-0002, ADR-0003

## Context

Moving from SQLite to Supabase Postgres needs a concrete schema, not just "the same tables on a
different engine." Two things the SQLite version got away with by accident need explicit
handling on Postgres: `taskService.ts`'s `submitTask`/`approveTask`/etc. all do a
read-check-then-write with nothing preventing interleaving — safe only because SQLite ran
single-process; genuinely unsafe once concurrent Vercel function invocations are possible. And
`groupChatId` was a single global setting, which breaks as soon as a second (dry-run) cohort
needs to exist alongside the real one (ADR-0004).

## Decision

**Tables**:
- `cohorts` (cohort_id PK, name, group_chat_id) — new, gives each cohort (including the dry-run
  one) its own group chat rather than one global setting.
- `roster` (id, username, role, cohort_id FK, unique on cohort_id+username) — replaces
  `roster.config.json` per ADR-0003.
- `tasks`, `notes`, `overdue_notifications`, `registrations`, `cohort_counters` — mirror the
  current SQLite schema 1:1, Postgres-typed (`timestamptz` instead of ISO text, native boolean
  and date). The composite PK `(cohort_id, id)` on `tasks`, fed by the atomic
  `cohort_counters` increment, is unchanged.
- `processed_telegram_updates` — webhook dedup (ADR-0004).
- `wizard_state` — replaces the in-memory `Map` in `src/bot/wizard.ts` (documented there as a v1
  tradeoff that can't survive serverless: a different disposable instance could handle each
  message mid-wizard). Cleaned up daily via `pg_cron` (ADR-0007) since the 20-minute expiry has
  no built-in Postgres row-TTL equivalent.
- `alert_throttle` — backs self-DM-on-error throttling and digest-send idempotency (ADR-0007).

**`status` stays text + a CHECK constraint**, not a native Postgres enum — easier to extend
later without an `ALTER TYPE` migration, matching this project's history of iterating rules after
real usage (e.g. `/blocked` overloading, the Levenshtein threshold).

**Concurrency**: a generic `row_version` integer column on `tasks`, incremented on every write
and checked on every update ("was the version still what I read?"). Zero rows affected by an
update means someone else already changed it, surfaced as an explicit conflict error instead of
a silent overwrite. Chosen as one uniform column over one-off per-action checks, so every kind of
edit is protected the same way, not just the specific actions someone happened to think to
guard.

**RLS**: every table has Row Level Security enabled with zero policies — a deny-by-default
backstop per ADR-0002, not the primary authorization layer (that stays in `TaskService`).

## Consequences

Postgres-typed columns and RLS-as-backstop are net simplifications over hand-rolled SQLite type
coercion. The `row_version` column adds one write-path check everywhere `tasks` is mutated, in
exchange for closing a real correctness gap that only appears once concurrent invocations are
possible — a class of bug that was latent, not theoretical (confirmed by reading
`taskService.ts`'s existing read-check-then-write code).

## Alternatives rejected

- **Native Postgres enum for `status`.** More type-safety at the database layer, but every future
  status-rule change (this project has had several) would need an `ALTER TYPE` migration; text +
  CHECK keeps that change as ordinary application code plus a one-line constraint update.
- **Per-action concurrency checks** (e.g. only guarding `approveTask`). Rejected — protects only
  the specific write paths someone thought to guard, leaving others silently vulnerable.
