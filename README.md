# DevCon Cohort 5 Task Bot

A Telegram-native task management system for DevCon PH's internship program: interns and
higher-ups assign, track, and review tasks directly inside Telegram (DM or the cohort's group
chat), plus a web dashboard for higher-up oversight, task creation/editing, and stats.

See [`PRD.md`](./PRD.md) for the full product spec and design decisions, and
[`CONTEXT.md`](./CONTEXT.md) for the "why" behind the technical choices. For how to actually use
the bot day-to-day, see [`USER_GUIDE.md`](./USER_GUIDE.md).

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
| `DATABASE_PATH` | no (defaults to `./data/taskbot.sqlite`) | SQLite file location |
| `ACTIVE_COHORT_ID` | no (defaults to `cohort-5`) | Cohort treated as "current" |
| `GROUP_CHAT_ID` | no | Cohort group chat id, for daily/weekly digests |
| `DASHBOARD_URL` | no | URL shown by the bot's `/dashboard` command |
| `ROSTER_PATH` | no (defaults to `roster.config.json`) | Path to the roster JSON file |
| `BOT_USERNAME` | yes, for the dashboard | Must match the bot behind `BOT_TOKEN` |
| `DASHBOARD_PORT` | no (defaults to `3000`) | Port the dashboard listens on |

**Roster**: `roster.config.json` in the repo root is a committed placeholder — do not put real
Telegram usernames in it, since the repo is public. For real usernames, create a
`roster.local.json` (already gitignored) with the same shape, and point `ROSTER_PATH` at it.
Adding a late-joining intern is a one-line edit to that file, no code change or restart-of-logic
needed beyond restarting the process (see below).

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
npm test          # run the full suite once
npm run test:watch
npm run typecheck  # tsc --noEmit
```

## Project structure

```
src/
├── domain/        # Framework-free core types (Task, Role, Caller, ...)
├── service/        taskService.ts — THE seam: all business rules live here.
│                    Both the bot and the dashboard call into this, never the
│                    repositories directly.
├── db/             SQLite (node:sqlite) schema + repositories
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
