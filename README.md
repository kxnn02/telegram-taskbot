# DevCon Cohort 5 Task Bot

A Telegram task manager for DevCon PH's internship program. The cohort assigns, tracks, and
updates tasks inside Telegram — in a DM or the group chat — with a web dashboard for the full
picture. It's a deliberate copy of **Devie**, the DevCon bot the cohort already uses, down to the
commands and the trust-everyone model: no roles, no permissions, no approval steps.

**Live in production**, serving the real Cohort 5 group. Next.js on Vercel, Postgres on Supabase.

## Which doc do I want?

| I want to… | Read |
|---|---|
| Use the bot | [`USER_GUIDE.md`](./USER_GUIDE.md) |
| Know what shipped recently | [`CHANGELOG.md`](./CHANGELOG.md) |
| Know what it's supposed to do | [`PRD.md`](./PRD.md) |
| Work on the code | [`CONTEXT.md`](./CONTEXT.md) — how it's built and why |
| Know why a choice was made | [`docs/adr/`](./docs/adr/) |
| Ship or roll back a change | [`docs/runbooks/`](./docs/runbooks/) |

## How it fits together

```
Telegram ──webhook──> api/telegram/webhook.ts ─┐
                                               ├─> src/service/taskService.ts ──> Supabase
Dashboard ─────────> app/ (Next.js) ───────────┤       (all business rules)
                                               │
Supabase pg_cron ──> api/jobs/* ───────────────┘
```

`taskService.ts` is the one seam: the bot, the dashboard, and the scheduled jobs all go through
it, so they can't disagree about what a task's state means. Nothing else touches the database.

## Setup

Requires **Node.js >= 22.12.0** and a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
npm install
cp .env.example .env   # then fill it in
```

### Environment variables

[`src/config/requiredEnv.ts`](./src/config/requiredEnv.ts) is the authoritative list — a name
missing from a deployed environment fails the Vercel build instead of breaking requests at
runtime (ADR-0015). `.env.example` documents every name, including the local-only and script-only
ones. The essentials:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | The bot this instance runs as |
| `BOT_USERNAME` | Must match `BOT_TOKEN`'s bot; used by the dashboard login |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook secret-header check (ADR-0004) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Database access (service role bypasses RLS — ADR-0006) |
| `ACTIVE_COHORT_ID` | The one cohort this deployment serves — the only thing separating dry-run data from live data |
| `SESSION_SECRET` | Dashboard session cookie (ADR-0008) |
| `INTERNAL_JOB_SECRET` | Auth for `pg_cron`-triggered `/api/jobs/*` |
| `CRON_SECRET` | Auth for Vercel-Cron-triggered keep-alive and weekly backup |
| `MAINTAINER_USERNAME` | Who gets DM'd when a job fails (ADR-0007) |
| `GROQ_API_KEY` | The language parser (bulk extraction, status guessing, standup quote) |
| `BACKUP_GITHUB_TOKEN` / `BACKUP_GITHUB_REPO` | Weekly backup, production only |

⚠️ **`BOT_TOKEN` and `ACTIVE_COHORT_ID` in a local `.env` must point at the dry-run bot and
cohort**, never production — a local dashboard's "Test Standup" button posts to whichever group
they name. See [`docs/runbooks/dry-run-loop.md`](./docs/runbooks/dry-run-loop.md).

**Roster**: nothing to seed. A roster row is created the moment someone messages the bot
(ADR-0013).

## Running locally

```bash
npm run dev        # the bot, via long polling (local only — deployed, it runs on the webhook)
npm run next:dev   # the dashboard, a separate process in a separate terminal
```

Both talk to the same real Supabase project as production — there is no local data store, which is
why the dry-run cohort matters. The bot process needs a manual restart after a code change; the
dashboard hot-reloads.

**Testing dashboard login locally** takes one extra step: Telegram's Login Widget refuses to
render on `localhost`. Expose the dashboard over HTTPS
([cloudflared](https://github.com/cloudflare/cloudflared): `cloudflared tunnel --url
http://localhost:3000`), register the resulting domain with `@BotFather` → `/setdomain`, then
open that URL. The domain changes each time the tunnel restarts, so `/setdomain` needs re-running
per session.

## Testing

```bash
npm test           # fast suite: in-memory fakes, no network
npm run typecheck  # all three tsconfigs
npm run test:live  # contract tests against the real Supabase project (ADR-0005)
```

## Shipping a change

CI gates the merge (typecheck, fast suite, and a check that every migration is already applied to
production — ADR-0012). What CI *can't* tell you is whether a real person in a real group gets a
sensible reply. That's the dry-run loop: the same code on the `dry-run` branch, driven by a
separate bot in a dump group, against a separate cohort.

```bash
git push --force-with-lease origin HEAD:dry-run   # deploys to the dry-run URL
# drive it by hand in the dump group, then open and merge the PR
```

**Merging to `main` deploys straight to production and the live cohort.** Full smoke list and
rollback steps: [`docs/runbooks/dry-run-loop.md`](./docs/runbooks/dry-run-loop.md).

Useful scripts:

```bash
npm run webhook:register -- --target dry-run --check   # inspect a webhook without writing
npm run check:migrations                               # what CI checks, locally
npm run check:env                                      # what the build checks, locally
npm run seed:roster                                    # seed a cohort
```

## Project structure

```
src/
├── domain/        Framework-free types — Task, Caller, roster, overdue, clock
├── service/       taskService.ts — THE seam: every business rule lives here.
│                  Plus roster/settings/tag/activity-log services for the dashboard.
├── storage/       One port per table, each with a Supabase and an in-memory
│                  implementation (schema lives in supabase/migrations/)
├── bot/           Telegram commands, argument parsing, reply formatting, standup
├── notifications/ Bodies of the scheduled reminder and digest jobs
├── jobs/          Dependency wiring and auth for the /api/jobs/* endpoints
├── web/           Dashboard auth, session cookies, and pure view builders
├── nlp/           TextModel port + Groq implementation (language parsing)
├── date/          chrono-node due-date parsing, Asia/Manila
├── config/        Required-env manifest and roster loading
├── ops/           Guarded webhook registration
├── migrations/    Migration-drift detection for CI
└── webhook/       Webhook request handling and dedup

api/               Vercel Functions: the Telegram webhook, and one endpoint
                   per scheduled job

app/               Next.js App Router dashboard — five pages (overview, board,
                   team, activity, settings) plus login and API routes.
                   app/globals.css holds the Tailwind v4 DEVCON theme.

components/        shadcn/ui primitives (regenerate, don't hand-edit) plus the
                   kanban, settings, team, and activity panels
supabase/          Migrations, including the pg_cron schedules
scripts/           One-off and CI scripts
docs/              ADRs, runbooks, and agent conventions
```

## Issue tracker

Work is tracked as GitHub issues on this repo. Conventions:
[`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
