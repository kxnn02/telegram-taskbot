# DevCon Cohort 5 Task Bot

A Telegram-native task management system for DevCon PH's internship program: interns and
higher-ups assign, track, and review tasks directly inside Telegram (DM or the cohort's group
chat), plus a web dashboard for higher-up oversight, task creation/editing, and stats.

See [`PRD.md`](./PRD.md) for the full product spec and design decisions, and
[`CONTEXT.md`](./CONTEXT.md) for the "why" behind the technical choices. For how to actually use
the bot day-to-day, see [`USER_GUIDE.md`](./USER_GUIDE.md).

> **Re-platform complete, live in production.** This codebase now runs on Next.js + Vercel +
> Supabase — see [`CONTEXT.md`](./CONTEXT.md) and [`docs/adr/`](./docs/adr/) for the full
> reasoning, and GitHub issues
> [#11](https://github.com/kxnn02/telegram-taskbot/issues/11)/[#17](https://github.com/kxnn02/telegram-taskbot/issues/17)
> (both closed) for the spec and phased implementation plan. The bot runs on a Telegram webhook
> (`/api/telegram/webhook`), scheduled jobs run on Supabase `pg_cron`/`pg_net` plus two
> Vercel Cron jobs, and the dashboard is the Next.js app under `app/`. The real Cohort 5 group is
> on production; the `dry-run` branch deployment is the pre-production gate every change is
> exercised through first, on its own bot and its own cohort
> ([ADR-0011](./docs/adr/0011-post-cutover-dry-run-loop.md),
> [runbook](./docs/runbooks/dry-run-loop.md)).
> The setup and running instructions below still cover local development (`npm run dev` against
> the same Supabase-backed stack), not a separate legacy mode.

## Requirements

- Node.js >= 22.5.0
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | yes | From `@BotFather` |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service-role key (bypasses RLS; see ADR-0006) |
| `ACTIVE_COHORT_ID` | yes | The single cohort this deployment serves — every live request (bot commands, dashboard login) binds to this id; see CONTEXT.md's cohort-binding note |
| `GROUP_CHAT_ID` | no, unused | Superseded by the `cohorts` table (ADR-0006) as of Phase 3 — kept only as a historical placeholder |
| `DASHBOARD_URL` | no | URL shown by the bot's `/dashboard` command |
| `ROSTER_PATH` | no (defaults to `roster.config.json`) | Path to a local roster JSON file — used only by `loadRoster`'s `createBot` fallback and by tests; production reads the roster from Supabase (ADR-0003) |
| `BOT_USERNAME` | yes, for the dashboard | Must match the bot behind `BOT_TOKEN` |
| `DASHBOARD_PORT` | no (defaults to `3000`) | Port the dashboard listens on |

**Roster**: per [ADR-0010](./docs/adr/0010-group-gated-registration-and-roster-management.md),
`roster.config.json` has been deleted and the roster is no longer collected upfront or seeded from
a file. A roster row is created when someone runs `/start` inside the cohort's Telegram group;
roster management (adding, removing, changing a role) is done in-product via `/roster`, gated on
live Telegram group-admin status. See the ADR for the full design and the row shape it replaces.

## Running locally

```bash
npm run dev        # the bot, long polling (LOCAL-DEV-ONLY — see src/bot/index.ts; the
                    # deployed bot runs on the webhook at api/telegram/webhook.ts instead)
npm run next:dev    # the Next.js dashboard (separate process, separate terminal)
```

Both talk to the same real Supabase project as production (same roster/cohort tables) — there is
no separate local data store. The bot process needs restarting manually after a code change (no
hot reload); the dashboard's `next dev` reloads on save as usual.

**Testing the dashboard's login locally**: Telegram's Login Widget refuses to render its button
on `localhost` or any domain not registered for the bot via `@BotFather` → `/setdomain`. For
local testing, expose the dashboard through a temporary HTTPS tunnel (e.g.
[cloudflared](https://github.com/cloudflare/cloudflared): `cloudflared tunnel --url
http://localhost:3000`), register the resulting `*.trycloudflare.com` domain with `/setdomain`,
then open the dashboard through that URL instead of `localhost`. The domain changes each time the
tunnel restarts, so `/setdomain` needs re-running per test session.

## Testing

```bash
npm test          # run the fast suite once (in-memory fakes only, no network)
npm run test:watch
npm run typecheck  # tsc --noEmit
npm run test:live  # contract tests against the real Supabase project — needs
                    # SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; see ADR-0005
```

## Shipping a change

CI (typecheck + the fast suite) gates the merge; it cannot tell you whether a real person in a
real group gets a sensible reply. That is what the dry-run loop is for — push the branch to the
`dry-run` deploy target, drive it by hand in the dump group as the dry-run bot, then merge:

```bash
git push --force-with-lease origin HEAD:dry-run   # deploys to the dry-run branch URL
# exercise it in the dump group, then open/merge the PR into main
```

Merging to `main` deploys straight to production and the live cohort. Full setup, smoke list and
rollback steps: [`docs/runbooks/dry-run-loop.md`](./docs/runbooks/dry-run-loop.md).

```bash
npm run webhook:register -- --target dry-run --check   # inspect a webhook without writing
npm run seed:roster                                    # seed the dry-run cohort
```

## Project structure

```
src/
├── domain/        # Framework-free core types (Task, Role, Caller, ...)
├── service/        taskService.ts — THE seam: all business rules live here.
│                    Both the bot and the dashboard call into this, never the
│                    repositories directly.
├── storage/        TaskStorePort + Supabase implementations
│                    (see supabase/migrations/ for schema)
├── config/         Roster loading
├── date/           chrono-node due-date parsing (Asia/Manila)
├── notifications/  Scheduled job bodies: overdue-crossing, due-date reminders,
│                    daily/weekly digests, roster reconciliation — triggered by
│                    Supabase pg_cron/pg_net, not run in-process
├── jobs/           Shared dependency wiring for the /api/jobs/* endpoints
├── bot/            Telegram bot: commands, wizards, formatting, notifications
└── web/            Dashboard building blocks: Telegram Login Widget auth,
                     session cookies, oversight/stats data, consumed by app/

api/
├── telegram/       Webhook entrypoint (api/telegram/webhook.ts)
└── jobs/            Vercel Function endpoints for every scheduled job,
                      including the two Vercel-Cron-triggered ones
                      (keep-alive, weekly-backup)

app/                Next.js (App Router) dashboard: login, task list/detail,
                     stats, and their API routes
```

## Issue tracker

Work is tracked as GitHub issues on this repo. See `docs/agents/issue-tracker.md` for
conventions.
