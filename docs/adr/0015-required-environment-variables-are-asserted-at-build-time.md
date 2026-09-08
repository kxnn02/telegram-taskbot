# ADR-0015: Required environment variables are asserted at build time

- **Status**: Accepted
- **Date**: 2026-09-08
- **Depends on**: ADR-0005, ADR-0007, ADR-0012

## Context

On 2026-09-07 the bot returned 500 to every Telegram update for 17 hours. `GROQ_API_KEY` was
missing from the deployment's environment, and the `TextModel` construction that depended on it
threw during setup — not just for the bulk-task-extraction, status-parsing, and intent-routing
paths that actually needed the key, but for every command, because the throwing constructor sat
upstream of the whole webhook handler. The outage was discovered only during an unrelated
readiness check, not because anything alerted on it. Two properties made this expensive rather
than merely annoying:

- **The failure was total, not scoped.** A key needed by one feature took down every feature,
  because nothing isolated the blast radius to the code path that actually depended on it.
- **The failure was invisible.** Vercel's Hobby plan retains runtime logs for about an hour
  (ADR-0007), so by the time anyone went looking, the only evidence left was the outage itself.

The identical fault — a missing `GROQ_API_KEY` — had already hit the dry-run environment days
earlier. Nothing generalized that near-miss into a fix before it recurred in production.

## Decision

Two changes together close this gap: one stops a missing variable from taking down more than it
should, the other stops a missing variable from reaching a deployment at all.

**The build-time gate.** `src/config/requiredEnv.ts` is the manifest: a plain array of
`{ name, environments, why }` entries, one per environment variable that a request served by
`api/**` or `app/**` cannot survive without. `scripts/checkRequiredEnv.ts` is the thin runner —
it reads `process.env`, calls the manifest's pure `findMissingEnv`, and prints
`formatMissingEnvReport` before exiting non-zero if anything required for the current
`VERCEL_ENV` is absent. `vercel.json`'s `buildCommand` runs it before `next build`
(`npm run check:env && npm run build:next`), so a missing variable fails the deployment outright
and the previous, working deployment keeps serving traffic instead of being replaced by a broken
one. The check only runs when `VERCEL_ENV` is `production` or `preview`; any other value —
including unset, which is what both CI and local dev see — skips it, because those runs have no
access to the deployment's real environment variables anyway. This is deliberately **not** wired
into `npm run build:next` or `npm run build` directly: CI runs `build:next` with no secrets
configured, and folding the check into that script would fail every CI build regardless of what
a real deployment's environment actually looks like.

**Construct-lazily, degrade-on-use.** `src/nlp/buildTextModel.ts` no longer throws from a
constructor when `GROQ_API_KEY` is absent. It returns a `ThrowingTextModel` — a `TextModel`
implementation that defers the failure to the moment something calls `complete()`, rather than
raising it the moment the object is built. This is safe rather than merely quieter: every caller
in `src/nlp/parse.ts` already wraps its `complete()` call in a `try`/`catch` and degrades —
`parseBulkTasks` falls back to its heuristic parser, `parseStatus` returns `null` — because that
handling exists for the ordinary case of the real model call failing (a timeout, a malformed
response, a rate limit). A missing key now takes the exact path those parsers were already
written and tested to handle, instead of a distinct, untested failure mode that happened to
short-circuit everything upstream of it.

Together these mean a missing `GROQ_API_KEY` can no longer reach a deployment silently (the build
gate catches it before traffic is served), and even if some other required variable's absence
were missed, the language-parsing dependency specifically degrades a feature rather than crashing
every command.

Deferred, not rejected: DMing the maintainer when dependency construction fails at runtime
(candidate B in #142) would catch a case the build gate cannot — a variable that is present at
build time but later becomes wrong (rotated, revoked, or a downstream service change). The
mechanism already exists on the jobs side: `guardSetup` and `SetupFailureReporter` in
`src/jobs/jobEndpoint.ts:109-169`, plus `makeSetupReporter` in `src/jobs/buildJobDeps.ts:173-199`,
are wired into `keep-alive` and `weekly-backup` only. Extending that to the remaining job
endpoints and to the webhook is one piece of work, tracked separately as **#43**, and this ADR
leaves it there deliberately rather than folding it in here.

## Consequences

- Every variable a deployed code path depends on now has exactly one place it is declared:
  `src/config/requiredEnv.ts`. The README's environment-variable table points to it rather than
  repeating the list, so the two cannot drift the way the README's `GROQ_API_KEY` row and the
  code's actual dependency on it just did.
- A schema change to the manifest — adding a variable a new feature needs — takes effect on the
  very next deploy with no separate registration step, unlike ADR-0012's migrations, which need a
  human to push them ahead of the merge.
- The build gate protects `production` and `preview` only. Local development and CI remain
  ungated, which is intentional (see Decision), but means a missing variable is still only caught
  the first time code actually deploys to one of those two environments.
- A dependency that degrades on use (`ThrowingTextModel`) is only as safe as its callers' error
  handling. Any new caller of `TextModel.complete()` that does not catch and degrade would
  reintroduce a version of the original outage for itself, scoped to whatever it does.

## Alternatives rejected

- **Querying the Vercel API from GitHub Actions to check the target environment's configured
  variables.** Needs a `VERCEL_TOKEN` repository secret, and checks a different moment than the
  one that matters: the build already runs inside the exact target environment being deployed, so
  asking a separate CI job to ask Vercel about that same environment is an indirect way to learn
  something the build step already knows for free.
- **Deriving the manifest from `.env.example`.** That file also documents local-only, script-only,
  and historical names — `GROUP_CHAT_ID` is explicitly no longer read, `DRYRUN_*` variables belong
  on a laptop, `PROD_*` variables are read only by `scripts/registerWebhook.ts` — none of which a
  deployed request depends on. Deriving the gate from it would fail deployments over variables
  that were never required in the first place.

## Out of scope

- A variable that is deleted or rotated *after* a successful deploy. The build gate only runs at
  build time; it cannot see an environment change that happens afterward.
- The `/api/jobs/*` endpoints' own pre-flight hole — extending runtime setup-failure reporting
  beyond `keep-alive` and `weekly-backup` is `#43`, not this ADR.
- Any variable Vercel does not expose to the build step. If one is ever found, the response is an
  `environments: []` entry in `src/config/requiredEnv.ts`, documented as runtime-only, not a
  weakening of the gate itself.
