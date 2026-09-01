# ADR-0007: Scheduled jobs and operational tasks

- **Status**: Accepted, implemented (issue #15)
- **Date**: 2026-08-31
- **Depends on**: ADR-0001, ADR-0006

## Context

ADR-0001 decided `node-cron` moves to Supabase `pg_cron` + `pg_net`. That covers the four
existing notification jobs, but three more operational needs surfaced during planning that
`node-cron` never had to handle: wizard-state rows (ADR-0006) need cleanup since Postgres has no
row-TTL; a paused Supabase project (auto-pause after 7 days of inactivity, free tier) needs an
external nudge to stay alive, but a job *inside* Supabase can't run if Supabase itself is paused;
and the free tier has no automatic backups at all.

## Decision

**Six jobs on Supabase `pg_cron` + `pg_net`**, each calling an authenticated `/api/jobs/*`
endpoint: hourly overdue-crossing check, daily due-tomorrow reminder, daily digest, weekly
digest, daily wizard-state cleanup (rows older than the 20-minute expiry), daily dedup-table
cleanup (`processed_telegram_updates`). All authenticate via **one shared internal-secret header**
— the same pattern reused for every machine-to-machine call in this system, rather than a
different scheme per endpoint (overkill at this scale).

**Digest idempotency**: the daily/weekly digest jobs use the same atomic-claim pattern as webhook
dedup (ADR-0004) — one row per `(cohort_id, digest_type, period_key)` in `alert_throttle`,
claimed via a unique-constraint `INSERT` before sending. If `pg_net` retries a call that actually
succeeded but timed out in transit, the retry finds the row already claimed and skips sending —
without this, a retried digest could post to the group twice.

**Two jobs on Vercel Cron instead of `pg_cron`**, since they must run even if Supabase itself is
paused: `/api/jobs/keep-alive` (pings the database twice weekly — comfortably inside Vercel
Hobby's once-per-day cron minimum interval, and the ±59-minute timing imprecision on Hobby
doesn't matter for a "touch it within 7 days" job) and `/api/jobs/weekly-backup` (exports all
tables as JSON, commits to a private GitHub repo — reuses infrastructure this project already
depends on, gets free version history as a side effect, and needs no new service).

**Error observability**: the bot DMs the maintainer on job failure, throttled via the same
`alert_throttle` claim pattern (once per problem, not once per recurrence). This is the real
safety net, not "check Vercel's logs" — Vercel's Hobby plan retains runtime logs for only 1 hour.

## Consequences

Every scheduled job in the system — notification jobs, cleanup jobs, keep-alive, backup — now
follows one of two authentication patterns (shared internal secret) and one idempotency pattern
(unique-constraint claim), rather than each job inventing its own approach. The keep-alive and
backup jobs living outside Supabase's own `pg_cron` is a deliberate exception, not an
inconsistency — they exist specifically to remain reachable when Supabase itself cannot run
anything.

## Implementation notes (issue #15)

**Only four of the six jobs got `/api/jobs/*` HTTP endpoints**, not six: wizard-state cleanup and
dedup-table cleanup ended up as pure-SQL `pg_cron` jobs with no application logic and no endpoint
at all — a plain scheduled `DELETE`, following the precedent
`20260831090000_wizard_state_cleanup_cron.sql` already set (deliberately pulled forward from this
issue, since that table wasn't safe to introduce without its cleanup). Both cleanups have nothing
for an HTTP endpoint to *do* beyond running SQL a schedule can run directly, so an endpoint would
only add authentication surface and a network hop for no benefit. The four notification jobs
(overdue-crossing, due-soon reminder, daily digest, weekly digest) do have real application logic
(cohort/roster iteration, digest formatting, self-DM-on-error) and so get real endpoints, per this
ADR's original decision.

**The "one shared internal-secret header" reused for every machine-to-machine call** turned out to
need two schemes, not one identical header: `pg_net`-triggered endpoints get a custom
`x-internal-job-secret` header (we control `pg_net`'s request), but Vercel Cron cannot be
configured with a custom header at all (`vercel.json`'s `crons` entries take only `path` and
`schedule`) — so `keep-alive`/`weekly-backup` instead check Vercel's own built-in
`Authorization: Bearer $CRON_SECRET` convention. The verification *mechanism* (timing-safe compare,
`src/webhook/internalSecret.ts`) is still the one shared piece of code backing both.

**Digest idempotency keys are single-text strings**, not a `(cohort_id, digest_type, period_key)`
composite unique constraint — `alert_throttle` (already created in
`20260831064536_init_schema.sql`) has a single `throttle_key text primary key` column, so the
tuple is encoded as `digest:{cohortId}:{daily|weekly}:{periodKey}` instead.

**Job endpoints act on exactly one cohort** (`ACTIVE_COHORT_ID`), not every cohort in the roster —
unlike the old `startScheduler`'s `for (const cohortId of cohortIds(roster))` loop. Each deployed
instance already serves exactly one cohort (`api/telegram/webhook.ts`'s cohort-binding doc
comment); looping every roster cohort from a job endpoint would let the dry-run deployment's cron
reach into the real cohort's data purely because both live in the one shared Supabase project.

**Error-DM throttle key has no timestamp** (`error:{jobName}:{cohortId}`), but is still
re-claimable: `AlertThrottleStorePort.claimWithWindow` re-permits sending once 24 hours have
elapsed since the last DM for that key, rather than the key going silent forever after the first
alert. This keeps "once per problem, not once per recurrence" true for a problem that persists
across many runs within a day, without ADR-0007's basic pattern needing a human to manually clear
a row before the maintainer hears about a *new* day's recurrence of the same failure.

## Alternatives rejected

- **A single combined cron system** (everything on Vercel Cron, or everything on `pg_cron`).
  Rejected: Vercel Hobby's once-per-day cap can't run the hourly overdue-crossing check (already
  noted in ADR-0001's alternatives analysis); `pg_cron` can't run if Supabase is paused, which is
  exactly the failure mode keep-alive and backup exist to prevent.
