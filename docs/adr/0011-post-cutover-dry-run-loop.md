# ADR-0011: Post-cutover dry-run loop on a second bot

- **Status**: Accepted; code and docs implemented, awaiting the one-time manual setup in
  `docs/runbooks/dry-run-loop.md` (BotFather bot, dump-group id, Vercel branch env vars)
- **Date**: 2026-09-03
- **Depends on**: ADR-0004, ADR-0005

## Context

ADR-0004 built a real pre-production gate: every feature branch merged into `dry-run` first, was
exercised by hand in a "dump" Telegram group against the live deployed branch domain, and only
then merged to `main`. That gate worked because the project's one bot token had its single
webhook pointed at the `dry-run` branch deployment.

The production cutover (2026-09-02) repointed that webhook at production. A bot token can hold
exactly one webhook at a time, so the same mechanism that made the dry run possible now makes it
impossible: production owns the real bot's webhook permanently, and taking it back for a test
would mean taking the live cohort's bot offline for the duration.

The gate is therefore gone, and nothing replaced it. What remains between a code change and the
live cohort is branch protection requiring `Typecheck + fast suite` — `tsc`, the in-memory-fake
suite, and a Next.js build. Those catch type errors and broken business rules; they cannot catch
anything that only shows up when a real Telegram client talks to a real deployment: a malformed
reply, a wizard that strands a user mid-flow, a command menu that no longer matches the handlers,
a group-membership check that behaves differently in a real group than in a fake one. Merging a
PR auto-deploys `main` to production (ADR-0005), so the first person to exercise a change in
Telegram is currently a cohort member.

## Decision

**A second Telegram bot, dedicated to the dry run.** The dry-run deployment stops sharing the
real bot and gets its own @BotFather bot, its own token, and its own webhook secret. Two bots
means two webhooks can be live simultaneously, which removes the hand-off that made ADR-0004's
arrangement mutually exclusive with production. The `dry-run` branch's Vercel environment sets
`BOT_TOKEN`/`BOT_USERNAME`/`TELEGRAM_WEBHOOK_SECRET` to the dry-run bot's values and
`ACTIVE_COHORT_ID` to the dry-run cohort, so the deployment is bound to the dry-run cohort by the
same single-cohort mechanism every deployment already uses (CONTEXT.md's cohort-binding note).
A second bot was not worth it pre-cutover — with one deployment there was nothing to run in
parallel — and is the cheapest thing that works now.

**`dry-run` becomes a disposable staging pointer, not a merge stage.** ADR-0004's
feature → `dry-run` → `main` chain existed because `dry-run` was the only deployed branch, so it
had to accumulate everything heading for production. That is no longer true, and keeping the
chain would couple unrelated changes' merge order: one change parked in `dry-run` awaiting a
verdict would block every later change from reaching `main` cleanly. Instead a branch is put
under test by overwriting the pointer —
`git push --force-with-lease origin <feature-branch>:dry-run` — and the PR still targets `main`
as normal. `dry-run` holds exactly one thing under test at a time and is never merged *from*.

**Webhook registration becomes a checked-in script with guardrails**
(`npm run webhook:register`, `scripts/registerWebhook.ts`), not a `curl` recovered from shell
history. Registering a webhook is this project's most dangerous routine operation: one command
against the wrong token silently moves the live cohort's bot, with no error raised anywhere —
Telegram just starts delivering updates elsewhere. Two tokens and two URLs now sit adjacent in
the same `.env`, which is precisely the shape that gets copy-pasted wrong. The decision of what
to register is a pure, unit-tested function (`src/ops/webhookRegistration.ts`) that refuses when:

- the token resolves (via `getMe`) to a bot other than the one the target declares — the check
  that actually matters, because it validates what the token *is* rather than which variable it
  was read from;
- the dry-run target's URL is the production deployment's host;
- the URL is not HTTPS, or any required value is unset.

Repointing production additionally requires an explicit `--confirm-production` flag, so the one
invocation that can cause an outage cannot be reached by a mistyped argument.

**The registered URL carries Vercel's protection-bypass secret.** This project has Vercel
Authentication enabled for every non-custom domain, so an unmodified URL is answered by Vercel's
SSO page and Telegram's POSTs never reach the function. Production already works this way; the
dry-run deployment uses the same project-level bypass value as a query param.

**Scripts are typechecked.** `tsconfig.api.json` now includes `scripts/`, which was previously
covered by no tsconfig at all — a guardrail script that CI never compiles is not a guardrail.

## Consequences

The dry-run bot has to be kept at BotFather parity with the real one — notably group privacy
mode off, or it cannot see the non-command replies that every wizard depends on, and dry runs
would pass on flows that break in production for reasons that have nothing to do with the code.
The runbook makes this an explicit setup step.

`dry-run` being force-pushed means its history is disposable and must never be merged from; the
branch is a deploy target, not a line of development.

**This ADR deliberately does not close two adjacent gaps**, both of which predate it and neither
of which the dry-run loop addresses:

- Production deploys are still not gated on CI. Vercel deploys `main` on merge, while the
  contract suite against the real Supabase project runs afterwards in GitHub Actions — a green
  merge and a broken production deploy can coexist.
- Database migrations are still applied by hand, with nothing verifying that the production
  schema matches `supabase/migrations/`.

## Alternatives rejected

- **Keep sharing one bot and swap the webhook per test.** The literal thing that stopped working
  at cutover. Every dry run would be a deliberate production outage of unknown length.
- **A local tunnel (ngrok or similar) against the real bot.** Still requires stealing the one
  webhook, and adds a moving part that does not resemble production — the webhook is a public
  URL by construction (ADR-0004), so a tunnel buys nothing here.
- **A second Vercel project for the dry run.** Would also work, but the branch deployment already
  provides an isolated URL and build; a second project duplicates env-var management for no
  additional isolation, since both would still share the one Supabase project (ADR-0004).
- **A second Supabase project so dry-run data is physically separate.** Unchanged from ADR-0004:
  rejected to stay inside the free tier's two-project cap. Cohort-scoping remains the load-bearing
  isolation.
