# Changelog

A running log of what's shipped, for interns, higher-ups, and anyone else following along. Not a
technical changelog — see `git log` or the GitHub issues for that level of detail. See
`PRD.md` for the full design and `CONTEXT.md` for why things were built the way they were.

## 2026-09-01 — Devie-parity command redesign: direct commands, free-set statuses

Every command is now a one-line direct command, and the old submit → review → approve/revise
workflow is gone. This matches **Devie**, another DevCon bot the cohort's higher-ups already use
daily — see [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md) for the full reasoning
and [#27](https://github.com/kxnn02/telegram-taskbot/issues/27) for the spec.

- **Create a task in one line**: `/addtask <title> [by <date>] [@username]`, or `@`-mention the
  bot with "pls work on ..." in a group chat. The old `/assign` step-by-step wizard survives only
  as the fallback for a bare `/addtask`.
- **Six free-set statuses** — `backlog`, `todo`, `in progress`, `in review`, `blocked`, `done` —
  replace the gated `Assigned → In Progress → Submitted → Approved`/`Needs Revision` lifecycle.
  Any roster member can set any status on any task with `/update <ref> <status>`, or the
  `/done`/`/complete` shortcuts. `/update` also accepts a bulk, comma- or newline-separated list
  of refs, with per-task ✓/✗ reporting and one collapsed notification DM per recipient.
- **Read access opens up**: `/tasks` (renamed from `/alltasks`), `/mytasks`, `/pending`, and
  `/task <ref>` are available to everyone, not scoped by role. `/edit` is now the only
  higher-up-restricted command.
- **`/blocked` becomes a status**, not a flag, so `/unblock <ref>` (renamed from `/unblocked`)
  restores whatever status a task was in before it was blocked.
- **Renames, no aliases** (no installed user base yet, so nothing needed a deprecation window):
  `/alltasks` → `/tasks`, `/backlog` → `/overdue` (since "backlog" is now a status name),
  `/unblocked` → `/unblock`. `/submit`, `/approve`, `/revise`, and `/canceltask` are gone outright
  — each replies with a one-line pointer to its replacement rather than the generic "unknown
  command" fallback, since this is exactly where old muscle memory needed a redirect.
- **Telegram's command menu is now registered** (`setMyCommands`) — typing `/` in the app now
  autocompletes every live command, which had never worked before this round.

Four regressions were accepted knowingly to get this parity — see ADR-0009's "Consequences"
section: there's no more `Cancelled` or `NeedsRevision` status, a finished task is no longer
locked from editing, and self-approval is now possible (anyone, including the assignee, can mark
their own task Done). The daily/weekly digest's counts-only guarantee is untouched by any of this.

This ships **before** the production cutover ([#17](https://github.com/kxnn02/telegram-taskbot/issues/17)),
since no real user has ever used the bot yet, which is exactly what made the no-alias
simplification above possible.

## 2026-08-31 — Re-platform planned (nothing shipped yet)

v1 plus the post-v1 bot improvements (#1-#9) are done and closed, but the bot was never deployed
anywhere permanent. Working through the deployment question surfaced that it had already been
decided implicitly by library choice (a file-backed SQLite database, Telegram long polling, and
an in-process job scheduler all require an always-on host) rather than explicitly. Decision: move
onto the same stack DevCon's other tooling already runs — Next.js, Vercel, and Supabase — so this
tool can be handed over and run by anyone in the org, not just whoever maintains today's host.

This round was **planning only** — a full spec, database schema, system architecture, dry-run
strategy, and CI/CD design (there was no CI before this), recorded as [ADR-0001 through
ADR-0008](./docs/adr/) and filed as GitHub issues
[#11](https://github.com/kxnn02/telegram-taskbot/issues/11) (spec) through
[#17](https://github.com/kxnn02/telegram-taskbot/issues/17) (the six implementation phases). No
code has changed — the bot and dashboard still run exactly as described elsewhere in this file
until implementation begins.

## 2026-08-30 — v1 complete: full task lifecycle, notifications, and dashboard

Everything planned for launch is built and working. All four tracked issues are closed:

- **Core bot** ([#1](https://github.com/kxnn02/telegram-taskbot/issues/1)) — registration via
  `/start`, the `/assign` and `/edit` step-by-step wizards, the full task lifecycle
  (assign → submit → approve/revise, blocked/unblocked, cancel), and DM notifications on every
  status change. Works both in a private chat with the bot **and** directly inside the cohort's
  group chat.
- **Scheduled notifications** ([#2](https://github.com/kxnn02/telegram-taskbot/issues/2)) — a
  reminder the day before a task is due, a one-time notice when a task goes overdue, and daily +
  weekly digests. The group chat's digest deliberately only shows counts, never task titles, to
  avoid publicly calling anyone out.
- **Dashboard login & oversight view** ([#3](https://github.com/kxnn02/telegram-taskbot/issues/3))
  — higher-ups can log in with their Telegram account (no separate password) and see every task
  in the cohort, filterable by status or by intern.
- **Dashboard task management & stats** ([#4](https://github.com/kxnn02/telegram-taskbot/issues/4))
  — higher-ups can now also create and edit tasks from the dashboard, with the exact same rules
  the bot enforces, plus a stats view (tasks completed per intern, completion rate, average
  time-to-submit, tasks completed this week).

**Confirmed working live**, not just by automated tests: bot commands in the group chat, and
dashboard login with real task data.

**Not yet done**: the dashboard's new create/edit/stats pages haven't had a manual pass yet
(only covered by automated tests so far). The bot and dashboard are also still running locally,
not deployed anywhere permanent — see `README.md` for local setup, and this file will get an
entry once a real deployment happens.

## 2026-08-31 — Post-v1 bot/backend improvements

Four small bot-side improvements shipped, based on a review of the bot's rough edges after v1
launched (dashboard visual design was deliberately left out of this round — that's being handled
separately):

- **`/blocked` list command** ([#6](https://github.com/kxnn02/telegram-taskbot/issues/6)) — see
  every currently-blocked task on demand (cohort-wide for higher-ups, your own for interns),
  instead of only seeing blocked tasks inside the weekly digest.
- **Pagination for `/alltasks` and `/mytasks`**
  ([#7](https://github.com/kxnn02/telegram-taskbot/issues/7)) — long task lists now come back 10
  at a time instead of one giant wall of text, with a page number to see more.
- **"Did you mean @y?" on assignee typos**
  ([#8](https://github.com/kxnn02/telegram-taskbot/issues/8)) — mistyping a username while
  assigning or editing a task now suggests the closest real match in the cohort instead of just
  rejecting it outright.
- **One-tap "Mark unblocked" button**
  ([#9](https://github.com/kxnn02/telegram-taskbot/issues/9)) — clearing a blocked flag from a
  notification is now one tap, the same way approving/revising a submission already was.

Also fixed earlier the same week (no ticket needed): the `/assign` and `/edit` wizard prompts now
mention that typing `@` triggers Telegram's own autocomplete for usernames.

All four verified independently (typecheck clean, full test suite green — 218 tests by the end of
this round) before merging. The GitHub issue tracker is now empty — nothing else planned.

## Earlier — planning

The project's design went through an extensive back-and-forth before any code was written,
including one notable reversal: the bot was originally meant to be DM-only, with the group chat
only ever receiving a read-only daily summary. After early testing, that was changed so commands
also work directly in the group chat — see `CONTEXT.md` for the full reasoning and the tradeoff
that came with it. Full narrative is in `PRD.md`.
