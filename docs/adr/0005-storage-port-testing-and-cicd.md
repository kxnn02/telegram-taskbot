# ADR-0005: Storage port, testing strategy, and CI/CD

- **Status**: Accepted (planning only — not yet implemented)
- **Date**: 2026-08-31
- **Depends on**: ADR-0001

## Context

`TaskService` currently talks to SQLite through repository modules with no interface between
them. Converting to Supabase means every call site becomes async and every query is rewritten
into the `supabase-js`/PostgREST idiom. Doing the async conversion and the database swap as one
undifferentiated change makes either kind of regression hard to isolate. SQLite was explicitly
rejected as an intermediate step to de-risk this ("lets not do sql lite anymore, we will use
supabase") — the isolation has to come from elsewhere. Separately, this repo has **no CI at all**
today — a pre-existing gap, not something the re-platform introduced, but one this work should
close since a rewrite of this size needs a safety net.

## Decision

**Storage port + in-memory fake first.** Define a storage interface ("port") that captures
everything `TaskService` does against the database. Build an in-memory fake implementing that
port, convert `TaskService` to async against the *fake* (offline, no real Supabase yet), then
plug in a real Supabase adapter behind the same interface second, verified by a contract-test
suite. SQLite is dropped for good once the port exists — never run in parallel with Supabase as
a safety net. 15 of the current 19 test files exercise business rules through `TaskService`'s own
methods (never touch SQLite directly), so they need only their one setup line changed; the 4
files tied to Express/SQLite plumbing are genuinely rewritten.

**Contract tests run against the one shared Supabase project, not a second one** — each contract
test runs inside a database transaction that is rolled back at the end, so it exercises the real
project with zero permanent footprint. This was chosen specifically to avoid needing a second
Supabase project for CI, keeping the account's free-tier 2-project cap unused for anything beyond
the one shared project (ADR-0004).

**CI**: GitHub Actions runs typecheck + the fast in-memory-fake suite on every push/PR. The
contract-test suite (needs live network access) runs additionally on every push to `main` only.
Branch protection on `main` requires these checks to pass before merge.

**Schema changes are versioned SQL migration files via the Supabase CLI, checked into the repo**
— including the `pg_cron` job schedules (ADR-0007), not just table DDL — reviewable in git
history like every other decision here, not made by hand in Supabase's dashboard.

**Deploys**: Vercel's native GitHub integration auto-deploys — `main` → Production, the dedicated
`dry-run` branch → its stable branch-domain Preview (ADR-0004), other branches → normal
throwaway previews.

## Consequences

The async conversion (the riskiest single diff in this project's history — it touches the one
seam every caller depends on) is verified once against a fast, deterministic fake before it ever
touches a network call, and the real-database behavior is verified separately by a much smaller,
slower contract suite. A regression in either shows up as a failure in exactly one of the two
suites, not an ambiguous failure in a combined one.

## Alternatives rejected

- **Keep SQLite running temporarily during the async conversion**, treating "async" and
  "database swap" as separate deploys. Explicitly rejected by the user — introduces a
  maintenance burden (two storage backends alive at once) for a safety property the in-memory
  fake already provides for free.
- **A second Supabase project dedicated to CI.** Would work, but spends the free tier's last
  project slot on something the transaction-rollback approach achieves without it.
