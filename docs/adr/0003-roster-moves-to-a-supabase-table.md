# ADR-0003: The roster moves from a JSON file to a Supabase table

- **Status**: Accepted (planning only — not yet implemented)
- **Date**: 2026-08-31
- **Depends on**: [ADR-0001](./0001-replatform-to-vercel-supabase.md)
- **Amended by**: [ADR-0010](./0010-group-gated-registration-and-roster-management.md) — the
  roster is still a Supabase table as decided here, but `roster.config.json`, kept committed by
  this ADR's Decision below, was later deleted; it stopped being read or seeded by anything once
  roster rows are created by `/start`.

## Context

The **Roster** — who belongs to a cohort and in what role (`Intern` or `HigherUp`) — is loaded
once at process startup by `src/config/roster.ts`, which does a `readFileSync` on
`roster.config.json`. The committed file is a placeholder; real Telegram usernames live in
`roster.local.json`, which is gitignored because the repo is public.

That arrangement does not survive the move to Vercel: **a gitignored file is not in the
deployment.** The roster has to come from somewhere else.

The original reasoning for a plain file (PRD §2/§7) was that adding a late-joining intern should
be "a one-line edit, not a code change". `roster.ts`'s own docblock anticipates this change:
*"swap this loader for a DB-backed one later without touching callers."*

## Decision

The roster becomes a **table in Supabase**. `loadRoster` reads from it and becomes async like
everything else behind the store seam; the `Roster` domain object it returns is unchanged, so
callers are unaffected.

`roster.config.json` **stays committed** — no longer as something the app reads, but as the
documented shape of a roster and the seed for standing up a new cohort.

> **Update (ADR-0010):** `roster.config.json` was later deleted. Once cohorts bootstrap
> themselves — the first person to `/start` can claim Higher-up — nothing seeds the roster from a
> file anymore, and the row shape it documented now lives in ADR-0010 instead.

## Consequences

- Adding a late-joining intern becomes editing a row in the Supabase table editor: no redeploy,
  no restart, no file to get onto a host. This serves the PRD's stated goal better than the file
  did, since under Vercel a file edit would have required a redeploy.
- The roster is no longer reviewable in git history. Who was in a cohort, and when their role
  changed, stops being answerable from the repo. Accepted: it was already unreviewable in
  practice, since the real roster lived in a gitignored file.
- Real Telegram usernames now live in the same place as task data, under the same access rules
  (see [ADR-0002](./0002-authorization-stays-in-taskservice.md)) rather than in a file on a disk.
- Roster reads are no longer free. v1 read the file exactly once per process; a serverless
  deployment resolves the roster per invocation, so it needs caching within a request at minimum.
  Sizing it at ~8 rows makes this a non-issue in practice, but it is a real change in shape.

## Alternatives rejected

- **An environment variable holding the roster JSON.** Smallest change, but editing means pasting
  JSON into Vercel's dashboard and redeploying — strictly worse than the file was, against the
  PRD's own criterion.
- **An encrypted roster file committed to the repo.** Keeps git reviewability, but adds key
  management for an eight-name list, and still requires a redeploy to change.
