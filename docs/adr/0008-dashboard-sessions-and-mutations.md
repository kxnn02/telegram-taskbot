# ADR-0008: Dashboard sessions and mutation style

- **Status**: Accepted, implemented (sessions — issue #16 / Phase 5; mutation style — Phase 6 /
  issue #17, closed, live in production)
- **Date**: 2026-08-31
- **Depends on**: ADR-0001

## Context

`CONTEXT.md` already flags the dashboard's in-memory session `Map` as incompatible with a
serverless deploy target — stateless per-request instances don't share memory. Separately, the
Next.js rewrite introduces a choice the Express dashboard never had: whether mutations go through
REST-style API routes or Next.js Server Actions.

## Decision

**Sessions**: a signed, stateless cookie, reusing the same HMAC-signing pattern already built and
tested for Telegram's Login Widget verification (`telegramAuth.ts`). Session data (username,
role, expiry) lives inside the cookie itself, cryptographically signed — no database table or
extra service needed. Chosen over a Supabase-table-backed session (the alternative) because the
dashboard has ~8 trusted users and doesn't need instant forced early-logout; a revocation/
blocklist table is a reasonable future add if that's ever needed, not designed in now.

**Dashboard identity stays individual Telegram login**, not switched to match Cohort 4's shared
admin password — stack-consistency (ADR-0001) was about hosting/infra, not copying every
implementation detail. Per-person login gives a real audit trail ("who actually approved this")
that a shared password throws away, and it's already built and tested.

**Mutations use REST-style API routes, not Server Actions.** The webhook (ADR-0004) and job
endpoints (ADR-0007) are forced to be plain HTTP endpoints regardless — Telegram and `pg_net`
cannot call a Server Action — so REST gives one consistent calling convention across the whole
app instead of two different mutation mechanisms living side by side. It also keeps continuity
with the existing dashboard test style (supertest-equivalent against real endpoints).

## Consequences

No new service or table is needed just to hold sessions. The one-consistent-convention choice on
mutations means Server Actions' developer-experience niceties (no manual fetch/serialization) are
traded away everywhere, not just where they wouldn't have applied anyway — accepted since the
webhook and job endpoints would have made a fully-Server-Actions app impossible regardless.

## Alternatives rejected

- **Supabase-table-backed sessions.** Would allow instant revocation, not needed at this scale;
  deferred as a future add rather than built now.
- **Next.js Server Actions for dashboard mutations.** Rejected specifically because the app can
  never be all-Server-Actions anyway (webhook/job endpoints are forced to be REST), so using them
  for dashboard mutations only would introduce a second mutation mechanism for no consistency
  benefit.
