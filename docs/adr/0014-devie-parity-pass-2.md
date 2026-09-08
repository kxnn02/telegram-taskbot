# ADR-0014: Devie parity pass 2 — seven gaps closed after a line-by-line re-read

- **Status**: Accepted, implemented (#125-#131 complete)
- **Date**: 2026-09-08
- **Supersedes**: the coming-Friday default in `PRD.md` §3/§5, the "not on a schedule" standup
  note in §8, and the pre-port dashboard's continued existence alongside the ported one
  (`CONTEXT.md`'s "sixth change" entry, S5 below).
- **Tracked as**: [#124](https://github.com/kxnn02/telegram-taskbot/issues/124), stages
  [#125](https://github.com/kxnn02/telegram-taskbot/issues/125)-[#131](https://github.com/kxnn02/telegram-taskbot/issues/131).

## Context

The Cohort 4 carbon-copy port (#101-#107, #106) shipped and closed, but a line-by-line re-read of
`DEVCONC4/DevieBot` against this repo on 2026-09-07 found the bot and dashboard were not fully
aligned. [ADR-0009](./0009-devie-parity-command-redesign.md) had already matched Devie's command
surface and status model; this pass closes what that first read missed underneath it: task-ref
ergonomics, `/addtask` defaults, reply formatting, half the dashboard, and — the most visible
daily gap — the standup never actually running on a schedule.

The reference clone (`DEVCONC4/DevieBot` at commit `453d1a7`) lived only in the audit session's
scratchpad and was discarded with it; every Devie line number and quoted string in the seven
tickets below was read from that clone and would need a fresh `git clone` to re-verify.

## Decision

Seven independent stages, filed as child tickets of #124 and merged separately:

- **S1** ([#125](https://github.com/kxnn02/telegram-taskbot/issues/125)) — `/done`, `/complete`,
  and `/update`'s single-ref path resolves a task by title-keyword substring match when the ref
  isn't a valid number (`findTaskByRef`, `src/bot/taskLookup.ts`), matching multiple candidates
  with a "which one?" list rather than guessing. A numeric ref that doesn't exist gets a "not
  found" card, never a keyword fallback.
- **S2** ([#126](https://github.com/kxnn02/telegram-taskbot/issues/126)) — `/addtask`'s single-task
  path now defaults to the next Tuesday/Thursday onsite day (`getNextOnsiteDay`) instead of the
  coming Friday, matching every other create path. `cleanTaskTitle` (ported by #102, previously
  unwired) now runs on every `/addtask` title with no explicit `!priority` flag, so natural-
  language priority/deadline phrases in the title are honored. `/update` falls back to a
  Claude-assisted status guess (`parseStatus`, via the injected `TextModel`) on an unrecognized
  status word instead of rejecting it outright.
- **S3** ([#127](https://github.com/kxnn02/telegram-taskbot/issues/127)) — every bot reply adopts
  Devie's exact wording and HTML formatting (bold, emoji, worked examples), replacing plain text
  across help, usage blocks, confirmations, and batch summaries. `/start` becomes a pure alias for
  `/help`. Four duplicated private `esc()` copies and one exported copy consolidate into
  `src/bot/html.ts`.
- **S4** ([#128](https://github.com/kxnn02/telegram-taskbot/issues/128)) — Devie's Overview page is
  built at `/dashboard`, and `/` redirects to it. Previously `/dashboard` was a 404.
- **S5** ([#129](https://github.com/kxnn02/telegram-taskbot/issues/129)) — the pre-port dashboard
  (`/`, `/stats`, `/tasks/new`, `/tasks/[id]/edit`, most of `app/_components/`) is deleted now that
  S4 gives `/` somewhere to redirect to. Pure deletion, no behavior added or rewritten.
- **S6** ([#130](https://github.com/kxnn02/telegram-taskbot/issues/130)) — the settings page gains
  Appearance (the existing topbar dark-mode toggle, surfaced as a setting), Bot Connection (webhook
  status, Register, Sync Bot Commands), and Daily Standup (Preview, Test) sections — the last of
  these shipped with no schedule yet, deliberately: S7 is what gives its on/off switch something to
  gate.
- **S7** ([#131](https://github.com/kxnn02/telegram-taskbot/issues/131)) — the daily standup
  actually runs on a schedule now: `cohorts.standup_enabled` (default `false`) plus a Supabase
  `pg_cron` job (`job-standup-push`, `5 0 * * *` — 00:05 UTC / 8:05am Asia/Manila) calling the
  existing `standup-push` endpoint, gated on the flag inside `handleStandupPushEndpoint`'s `POST`
  branch only (never in `sendStandupPush` itself, which the settings page's Test button reuses and
  must ignore the flag). This is the one deliberate exception to #124's "no migrations in this
  pass" rule — see "Alternatives rejected" below for the scheduler choice.

  S7 also surfaced and fixed two bugs found during its own manual dry-run gate, unrelated to the
  schedule itself but shipped in the same PR: a Telegram send failure (e.g. a 429) inside the
  settings page's Test Standup route was an uncaught throw, producing a bare 500 with no JSON body
  that the dashboard's `res.json()` calls couldn't parse — surfacing as a spinner that hung forever
  instead of an error state. Fixed by catching the Telegram call and returning `{ok:false}`/502
  (matching `webhook/route.ts`'s existing pattern) plus a `safeJson()` wrapper on the dashboard side
  so any non-JSON response recovers into an error state. The fix also exposed that nothing in the
  codebase retried a rate-limited or transient Telegram API call — every send failed immediately,
  which is what turned routine dry-run testing into a stuck "Failed to send" once the test group's
  flood limit tripped. `attachAutoRetry()` (`src/bot/attachAutoRetry.ts`, wrapping grammy's official
  `@grammyjs/auto-retry`, capped at 3 retries / 30s max delay) is now attached everywhere this repo
  constructs a real `Bot` — the production bot, all `/api/jobs/*` job builders, and all three
  dashboard settings routes — so a 429 or 5xx is retried with backoff instead of failing outright,
  closing the same risk for a large `/addtask @all` fan-out or two scheduled jobs landing close
  together in production.

## Consequences

**What this buys.** The bot and dashboard are now aligned with Devie on every finding the 2026-09-07
audit recorded, not just the command surface and status model ADR-0009 already matched. The
standup — the most visible daily difference between the two bots — now delivers itself the same
way Devie's does (cron-job.org there, `pg_cron` here), rather than only firing when a human
remembers to trigger it by hand.

**What this costs.** Nothing functionally: every stage is additive or a straight port, and D1-D4
(recorded in #124, not re-litigated here) drew the line on which of Devie's *behaviors* to adopt
versus which of this repo's own extras to keep. The one schema change (S7's
`cohorts.standup_enabled` column) is additive per [ADR-0012](./0012-migrations-applied-before-merge.md)'s
migration gate.

**What's still deferred.** S7's live-Telegram visual confirmation of the Test Standup button was
blocked at merge time by Telegram flood control on the dry-run test group (from the session's own
repeated testing, not a code defect) — verified instead via `standupPush.test.ts`'s 11 passing
unit tests (card rendering, HTML formatting, enable/disable paths) and confirmed live via the
first real production `pg_cron` firing after merge.

## Alternatives rejected

**Scheduler choice for S7** (the maintainer's decision, 2026-09-07 — not to be revisited):

- **Vercel Cron.** Rejected: it cannot send a custom header, so the standup endpoint would need a
  second auth scheme alongside the `x-internal-job-secret` every other job endpoint already uses,
  and it is the one scheduling path in this project never proven to actually fire
  ([#43](https://github.com/kxnn02/telegram-taskbot/issues/43), still open).
- **cron-job.org** (Devie's own choice). Rejected in favor of the proven in-repo path: four
  notification jobs already run on `pg_cron`/`pg_net` (`20260901010000_notification_jobs_cron.sql`)
  and have worked reliably since #37, and `call_job_endpoint` already sends the exact header the
  standup endpoint verifies — literally zero authentication change, versus onboarding and trusting
  a new third-party scheduler for one endpoint.
- **`pg_cron`** — chosen. Same infrastructure, same auth scheme, same operational story as every
  other scheduled job in this codebase.
