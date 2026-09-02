# DevCon Cohort 5 Task Bot

A Telegram-native task management system for DevCon PH's internship program: interns and
higher-ups assign, track, and review tasks directly inside Telegram (DM or the cohort's group
chat), plus a web dashboard for higher-up oversight, task creation/editing, and stats.

See [`PRD.md`](./PRD.md) for the full product spec and design decisions, and
[`CONTEXT.md`](./CONTEXT.md) for the "why" behind the technical choices. For how to actually use
the bot day-to-day, see [`USER_GUIDE.md`](./USER_GUIDE.md).

> **Re-platform in progress.** This codebase is being re-platformed onto Next.js + Vercel +
> Supabase — see [`CONTEXT.md`](./CONTEXT.md) and [`docs/adr/`](./docs/adr/) for the full
> reasoning, and GitHub issues
> [#11](https://github.com/kxnn02/telegram-taskbot/issues/11)-[#17](https://github.com/kxnn02/telegram-taskbot/issues/17)
> for the spec and phased implementation plan. As of Phase 2 (#13), storage is Supabase Postgres
> (SQLite has been removed) but the bot still runs as an Express + `node-cron` + Telegram
> long-polling process, not yet the webhook/Vercel/Next.js target — the setup and running
> instructions below describe that current in-between state.

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
npm run dev             # the bot
npm run dashboard:dev   # the web dashboard (separate process, separate terminal)
```

Both need to be restarted manually after a code change or a roster edit — neither has hot reload
(the roster is loaded once at process startup).

**Testing the dashboard's login locally**: Telegram's Login Widget refuses to render its button
on `localhost` or any domain not registered for the bot via `@BotFather` → `/setdomain`. For
local testing, expose the dashboard through a temporary HTTPS tunnel (e.g.
[cloudflared](https://github.com/cloudflare/cloudflared): `cloudflared tunnel --url
http://localhost:3000`), register the resulting `*.trycloudflare.com` domain with `/setdomain`,
then open the dashboard through that URL instead of `localhost`. The domain changes each time the
tunnel restarts, so `/setdomain` needs re-running per test session — this isn't needed once the
dashboard has a permanent deployed domain.

## Testing

```bash
npm test          # run the fast suite once (in-memory fakes only, no network)
npm run test:watch
npm run typecheck  # tsc --noEmit
npm run test:live  # contract tests against the real Supabase project — needs
                    # SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY; see ADR-0005
```

## Project structure

```
src/
├── domain/        # Framework-free core types (Task, Role, Caller, ...)
├── service/        taskService.ts — THE seam: all business rules live here.
│                    Both the bot and the dashboard call into this, never the
│                    repositories directly.
├── storage/        TaskStorePort + Supabase/in-memory implementations
│                    (see supabase/migrations/ for schema)
├── config/         Roster loading
├── date/           chrono-node due-date parsing (Asia/Manila)
├── notifications/  Scheduled jobs: overdue-crossing, due-date reminders,
│                    daily/weekly digests (node-cron)
├── bot/            Telegram bot: commands, wizards, formatting, notifications
└── web/            Dashboard: Express server, Telegram Login Widget auth,
                     task oversight/creation/editing, and stats views
```

## Issue tracker

Work is tracked as GitHub issues on this repo. See `docs/agents/issue-tracker.md` for
conventions.
