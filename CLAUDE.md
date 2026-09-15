# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`CONTEXT.md` (how it's built and why) and the relevant `docs/adr/` record, before exploring code.
`README.md` has the directory map and env-var table; don't re-derive them here.

Use the glossary's exact vocabulary (Caller, Roster, Registration, Cohort, Overdue, Bucket) in
issue titles, test names, and proposals. If your conclusion contradicts an ADR, say so explicitly
("Contradicts ADR-000X — worth reopening because…"); never silently override one.

## Commands

```bash
npm test                                   # fast suite — in-memory fakes, no network
npx vitest run src/bot/format.test.ts      # one file
npx vitest run src/bot/format.test.ts -t "formats a task"   # one test
npm run typecheck                          # all three tsconfigs — this is the lint (no ESLint/Prettier)
npm run build:next                         # catches webpack bundling tsc can't see; CI runs it
npm run test:live                          # contract tests vs real Supabase (live creds)
npm run dev                                # local bot, long polling (manual restart per change)
npm run next:dev                           # dashboard, separate terminal
npm run check:env / check:migrations       # what the build / CI check, locally
npm run webhook:register -- --target dry-run --check
```

`npm run build` compiles `src/` → `dist/` for the local long-polling bot only — it is not the
deploy build. Node >= 22.12.0 (CI pins 22.12.0).

## Architecture

Three entry points, one seam:

- `api/telegram/webhook.ts` (bare Vercel Function, thin adapter, deps memoized at module scope)
  → `src/webhook/webhookHandler.ts`. Order is load-bearing: timing-safe secret header check →
  `update_id` validation → `claimUpdate` dedup (duplicate returns **200** so Telegram stops
  retrying) → roster refresh → `bot.handleUpdate`.
- `app/**` (Next.js dashboard) → `src/web/nextDashboardDeps.ts`.
- `api/jobs/*` (scheduled) → `src/jobs/jobEndpoint.ts`.

All three go through `src/service/taskService.ts`. **Only `src/storage/supabase*Store.ts` touches
Supabase** — a dashboard page needing new data gets a new service method, never a query from
`src/web/`. **Only the bot and job layers call Telegram**; services return `ServiceResult`
(`ok`/`fail`), never send messages. **User-facing text lives in formatters**, not services —
`src/bot/format.ts` is the one place status vocabulary is spelled out; `esc()` in `src/bot/html.ts`
is the only HTML escaper.

Command dispatch is plain grammy `bot.command(...)` in `src/bot/createBot.ts` — no router, no
command table. Handlers wrap in `withCaller`, which auto-registers the sender on first contact.
The first registered middleware is an outermost try/catch `bot.use`, because `bot.handleUpdate()`
never consults `bot.catch` (only long polling does).

`components/` holds shadcn/ui primitives — regenerate, don't hand-edit.

## Deployments

Two Telegram bots, two deployments, **one shared Supabase project**, keyed only by
`ACTIVE_COHORT_ID` (prod `cohort-5`, dry run `cohort5-dryrun`) plus per-branch `BOT_TOKEN` /
`BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET`. One cohort per deployment, always — pass
`ACTIVE_COHORT_ID` explicitly; the no-cohort `Roster.find` overload exists only for tests.

`dry-run` is a disposable deploy pointer, never merged from:
`git push --force-with-lease origin HEAD:dry-run`; the PR still targets `main`. Merging to `main`
deploys straight to production and the live cohort. A local `.env` must point at the **dry-run**
bot and cohort — the dashboard's Test Standup button posts to whichever group it names.

Scheduled work runs two ways on purpose (ADR-0007): Supabase `pg_cron` POSTs five jobs with
`x-internal-job-secret` (schedules live in `supabase/migrations/*_cron.sql`), while `vercel.json`
crons keep-alive and weekly-backup with `Authorization: Bearer $CRON_SECRET` because they must run
when Supabase is paused. `handleJobEndpoint` accepts **both GET and POST** for exactly that reason.
`api/jobs/standup-push.ts` is the deliberate exception: GET renders a preview, POST sends.

## Gotchas

- **Three tsconfigs.** `src/` and `api/` are NodeNext — relative imports need an explicit `.js`
  extension. `app/` is `moduleResolution: bundler` and imports `src/` **without** extensions;
  `next.config.ts`'s `extensionAlias` is what lets webpack follow the difference.
- Migrations are applied to production **by hand before the code merges** (ADR-0012,
  `docs/runbooks/migrations.md`). CI only detects drift. Never let `SUPABASE_DB_URL` reach output.
- `src/config/requiredEnv.ts` is the authoritative env manifest and is deliberately *not* derived
  from `.env.example`; a missing name fails the Vercel build, not requests (ADR-0015).
- Every table has RLS on with zero policies — the service-role key bypasses it; the absent
  policies are the deny-by-default backstop.

## Traps — these look like bugs and must not be "fixed"

- `/addtask` reads a due date only after an explicit ` by `, walked last-to-first, accepted only if
  chrono consumes all trailing text. Do not simplify to a whole-string scan.
- `/done` sets **In review**; `/complete` / `/completed` / `/update <ref> done` set **Done**.
  Copied from Devie on purpose.
- `sendStandupPush` ignores `standup_enabled` deliberately — the check lives in the endpoint's POST
  branch only, so the dashboard Test button works while the schedule is off.
- `/standup`'s cert tip uses `selectRandomCertTip` while the scheduled push and dashboard preview
  use date-seeded `selectCertTipForDate`. Do not unify them (#184 vs #180).
- Standup groups **by person**, not by status — a deliberate divergence from Devie. `bucketOf` and
  `STANDUP_BUCKET_ORDER` order differently on purpose.
- Notification bookkeeping is written **after** a successful send, never before.
- There is **no access control** — no roles, no permissions, no approval gate (ADR-0013). Cohort
  scoping is tenancy, not permission. Re-adding auth is a new proposal, not a bug fix.

## Testing

Vitest, tests co-located as `src/**/*.test.ts` (`*.live.test.ts` = contract tests, excluded from
the fast suite). `npm test` never touches the network: `inMemory*Store` fakes back everything and
the NLP layer runs against a fake `TextModel`. Bot dispatch is tested through a real grammy `Bot`
injected via `createBot({bot})`, driving `bot.handleUpdate()` on hand-built updates —
**a synthetic `/command` message needs a `bot_command` entity**, or grammy's command filter misses
it and everything falls through to the fallback handler. View logic stays pure: `src/web/*View.ts`
takes data plus a `now` and returns what to render, with no `new Date()` inside.

## Agent conventions

- **Issues**: specs and tickets are GitHub issues at `kxnn02/telegram-taskbot`, via the `gh` CLI.
  PRs are not a request surface. See `docs/agents/issue-tracker.md`.
- **Labels**: exactly five, no renaming — `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs**: `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`. New ADRs copy the most
  recent record's shape, number sequentially, add a table row, and link from `CONTEXT.md`;
  superseded ADRs are kept, never deleted.
