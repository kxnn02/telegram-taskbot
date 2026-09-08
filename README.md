# DevCon Cohort 5 Task Bot

A Telegram-native task management system for DevCon PH's internship program: anyone in the cohort
assigns, tracks, and updates tasks directly inside Telegram (DM or the cohort's group chat), plus
a web dashboard for oversight, task creation/editing, and stats. There's no role split — every
registered member has the same access to everything, matching **Devie**, the DevCon bot this one
is a carbon copy of.

See [`PRD.md`](./PRD.md) for the current product spec (the original v1 spec this replaced is
archived at [`docs/PRD-v1-original.md`](./docs/PRD-v1-original.md), for comparison), and
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

> **No more roles, no more access control.** ADR-0013 (issue #106) deletes Intern/Higher-up
> entirely: anyone who messages the bot is auto-registered on first contact, matching Devie's own
> `syncMember` — no group-membership check, no role button, no `/roster`/`/whoami`/`/edit`/
> `/dashboard`/`/cancel` commands, no wizards. Any registered member can act on any task in their
> own cohort, and dashboard login only requires being a known member. See
> [ADR-0013](./docs/adr/0013-remove-access-control-for-devie-parity.md) for the full reasoning —
> this was the last of a six-part Cohort 4 carbon-copy port (`CONTEXT.md` has all six).
>
> **Dashboard toolchain: Tailwind v4 + shadcn/ui, a real kanban board, settings, team, and
> activity-log pages, and light/dark theming.** Issue #105 mapped the *same* DEVCON design tokens
> already used everywhere else (`src/web/styles.ts`) onto Tailwind's `@theme` — no new colors, no
> new fonts — then added the kanban board (drag-and-drop via dnd-kit, tags), the settings page and
> its `audit_logs` writer, the fully-editable team page (no roles, no permissions — see above), a
> light/dark toggle, and a dedicated, paginated activity-log page. See `CONTEXT.md`'s "sixth
> change" entry for the five sub-stages.
>
> **`/standup` gained Devie's character**: a daily quote, a greeting, and emoji priority/status
> badges (issue #107), plus a separate secret-gated push endpoint that can post the same card into
> the group on demand, and — as of issue #131, below — on a daily schedule too.
>
> **Devie parity pass 2** ([ADR-0014](./docs/adr/0014-devie-parity-pass-2.md), spec
> [#124](https://github.com/kxnn02/telegram-taskbot/issues/124), stages
> [#125](https://github.com/kxnn02/telegram-taskbot/issues/125)-[#131](https://github.com/kxnn02/telegram-taskbot/issues/131),
> all closed) closed seven gaps a line-by-line re-read against Devie found: task refs resolve by
> title keyword, not just number; `/addtask` defaults to the next Tue/Thu onsite day instead of the
> coming Friday, and reads natural-language priority out of a title; `/update` falls back to a
> Claude-assisted status guess on an unrecognized word; every bot reply adopts Devie's exact
> wording and HTML formatting; the pre-port dashboard is deleted in favor of a ported Overview page
> at `/dashboard`; the settings page gained Appearance, Bot Connection, and Daily Standup sections;
> and the daily standup now actually runs on a schedule (Supabase `pg_cron`, `5 0 * * *`), gated by
> the on/off switch the settings page ships alongside it. See `CONTEXT.md`'s "ninth change" entry
> for the full stage-by-stage breakdown.

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
| `TELEGRAM_WEBHOOK_SECRET` | yes | webhook secret-header check (ADR-0004) |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service-role key (bypasses RLS; see ADR-0006) |
| `ACTIVE_COHORT_ID` | yes | The single cohort this deployment serves — every live request (bot commands, dashboard login) binds to this id; see CONTEXT.md's cohort-binding note |
| `GROUP_CHAT_ID` | no, unused | Superseded by the `cohorts` table (ADR-0006) as of Phase 3 — kept only as a historical placeholder |
| `BOT_USERNAME` | yes, for the dashboard | Must match the bot behind `BOT_TOKEN` |
| `SESSION_SECRET` | yes | dashboard session cookie (ADR-0008) |
| `INTERNAL_JOB_SECRET` | yes | pg_net-triggered /api/jobs/* auth |
| `MAINTAINER_USERNAME` | yes | self-DM-on-error target (ADR-0007) |
| `CRON_SECRET` | yes | Vercel-Cron-triggered keep-alive and weekly-backup |
| `DASHBOARD_PORT` | no (defaults to `3000`) | Port the dashboard listens on |
| `GROQ_API_KEY` | yes | Used by `src/nlp/groqTextModel.ts` (issue #102) — the active `TextModel` implementation — for bulk-task extraction, status parsing, and intent routing via `qwen/qwen3.6-27b` on Groq's free tier. Get one at https://console.groq.com. The module's test suite runs against a fake `TextModel` and needs no key |
| `ANTHROPIC_API_KEY` | no, unused | `src/nlp/anthropicTextModel.ts` (issue #102's original `claude-haiku-4-5` choice) is kept but not wired up — the account behind it has no billing credit |
| `BACKUP_GITHUB_TOKEN` | yes, production only | weekly backup commits |
| `BACKUP_GITHUB_REPO` | yes, production only | weekly backup destination |

`src/config/requiredEnv.ts` is the authoritative list of variables a deployed environment must
have; a name missing from a target environment fails the Vercel build rather than reaching a
request.

**Roster**: no config file, no upfront collection, and no in-product management command any more.
Per [ADR-0013](./docs/adr/0013-remove-access-control-for-devie-parity.md), a roster row is created
(and refreshed) automatically the moment someone messages the bot — the same auto-registration
Devie's own `syncMember` does. There's nothing left to seed by hand and no `/roster` command to
administer it with.

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
├── domain/        # Framework-free core types (Task, Caller, ...)
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
├── bot/            Telegram bot: commands, formatting, notifications
└── web/            Dashboard building blocks: Telegram Login Widget auth,
                     session cookies, oversight/stats data, consumed by app/

api/
├── telegram/       Webhook entrypoint (api/telegram/webhook.ts)
└── jobs/            Vercel Function endpoints for every scheduled job,
                      including the two Vercel-Cron-triggered ones
                      (keep-alive, weekly-backup)

app/                Next.js (App Router) dashboard: login, task list/detail,
                     stats, board, settings, team, and activity-log pages,
                     and their API routes. app/globals.css is the Tailwind
                     v4 theme (DEVCON tokens, issue #105 5a; light/dark
                     variants added in 5e).

components/ui/      shadcn/ui primitives (generated via `npx shadcn add`,
                     not hand-written — regenerate rather than hand-edit)
components/kanban/  Kanban board, task cards/dialog (issue #105 5b)
components/settings/ Settings page panel (issue #105 5c)
components/team/    Team page panel (issue #105 5d)
components/activity/ Dedicated activity-log page panel (issue #105 5e)
lib/                 shadcn's cn() utility
components.json      shadcn/ui CLI configuration
```

## Issue tracker

Work is tracked as GitHub issues on this repo. See `docs/agents/issue-tracker.md` for
conventions.
