# ADR-0004: Webhook transport, dedup, and dry-run strategy

- **Status**: Accepted, implemented — webhook cut over from the dry-run deployment to production
  2026-09-02
- **Date**: 2026-08-31
- **Depends on**: ADR-0001

## Context

ADR-0001 already decided the bot moves from long polling to a webhook — Vercel has no
long-lived process to sit in a poll loop. That decision leaves three things unresolved: how the
webhook is secured, how duplicate deliveries are handled, and how the switch gets tested without
risking the real cohort's data before it's proven.

## Decision

**Webhook security**: Telegram's own secret-token mechanism. The webhook is registered with a
secret string; Telegram echoes it back on every request as the `X-Telegram-Bot-Api-Secret-Token`
header, checked before trusting any incoming request. Closes the "anyone who finds the URL could
POST fake messages" gap.

**Duplicate delivery**: Telegram retries an update if the webhook doesn't respond fast/
successfully — the same message can arrive twice, which never happened under long polling. Fixed
via a `processed_telegram_updates` table, claimed by an **atomic `INSERT` with a unique
constraint on `update_id`** — a conflict means "already claimed," so the second delivery is a
no-op. This has to be one atomic operation, not a `SELECT` followed by an `INSERT`: two
concurrent retries of the same update could otherwise both pass a "not yet processed" check
before either finishes writing, defeating the dedup entirely.

**Dry run, one shared Supabase project, reused bot**: rather than a second bot and a second
Supabase project, the dry run is a second fake cohort (`cohort5-dryrun`) inside the same
database, using the multi-tenancy (`cohortId`) `TaskService`/`scheduler.ts`/`digestBuilder.ts`
already have as a first-class concept. The existing bot (`devcon_cohort5_taskbot`) is added to a
spare "dump" Telegram group the maintainer personally controls, with two accounts covering both
roles (Intern, HigherUp). A dedicated `dry-run` Vercel branch gets a **stable branch-domain**
(not Vercel's default per-deploy throwaway URL), registered with Telegram once — so redeploying
during development never requires re-registering the webhook. Testing during implementation is
done by pushing to this branch and exercising the dump group directly against the live deployed
URL; no local tunnel is needed; the webhook is a public URL by construction.

**One real gap this exposed**: `groupChatId` was a single global setting, not per-cohort — see
ADR-0006 for the `cohorts` table that fixes this, without which both the real and dry-run
cohorts' digests would go to the same Telegram group.

**Cutover from dry run to production** is a manual, written checklist (produced as an actual
document when implementation reaches this point): switch environment variables to production
Supabase/roster/group → call Telegram's API to repoint the webhook from the dry-run URL to
production → confirm the dry-run URL stops receiving traffic. This is manual because reusing one
bot token means only one webhook URL can be active at a time — there is no automatic hand-off.

**Branch flow, pre-cutover**: because `dry-run` is the only branch actually exercised against
live Telegram traffic (the dump group), every feature branch merges into `dry-run` first — not
`main`. Only after it's been exercised there does `dry-run` merge into `main`. Landing on `main`
first and periodically catching `dry-run` up (as happened for a stretch before this was written
down) inverts the safety net: it ships untested-against-Telegram code into the branch that will
become production, with `dry-run` only proving itself right after the fact. `main` stays the
integration point that eventually gets cut over to production; `dry-run` stays the gate it has
to pass through first.

## Consequences

**Accepted tradeoff**: two separate Supabase projects would have made a dry-run-code bug
*physically incapable* of touching real data. One shared project means a bug in untested new
code (a missing cohort filter, a bad migration) could theoretically reach real data — sharing
infrastructure trusts the very code being tested to protect itself. Chosen anyway to avoid the
free-tier 2-project cap (see ADR-0001) eating the account's entire allowance for two permanent
projects. Mitigation: cohort-scoping in the code must be airtight before the dry run begins —
the existing `sameCohort` checks are the load-bearing safety net.

## Alternatives rejected

- **A second Telegram bot for the dry run.** Unnecessary — `createBot.ts` doesn't lock itself to
  one group chat, so the existing bot can simply join a second group.
- **A second Supabase project for isolation.** Rejected in favor of cohort-based isolation inside
  one project, to preserve the account's free-tier project cap for other uses (CI contract tests,
  ADR-0005).
