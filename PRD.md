# PRD: DevCon PH Cohort 5 Task Bot

> **Current spec.** This describes the bot as it actually behaves today — live in production,
> re-platformed onto Vercel + Supabase, and rebuilt to be a carbon copy of **Devie**, another
> DevCon bot the cohort already uses daily. For the original v1 design this replaced, see
> [`docs/PRD-v1-original.md`](./docs/PRD-v1-original.md). For the decisions that connect the two,
> see `CONTEXT.md` and [`docs/adr/`](./docs/adr/) — most significantly
> [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md) (direct one-line commands, free-set
> statuses), [ADR-0013](./docs/adr/0013-remove-access-control-for-devie-parity.md) (every role
> and permission check removed), and
> [ADR-0014](./docs/adr/0014-devie-parity-pass-2.md) (task-ref keyword lookup, onsite-day
> defaults, Devie's reply formatting, the ported dashboard's Overview/settings pages, and the
> scheduled daily standup).

## 1. Overview

A Telegram-native task management system for DevCon PH's internship program. It replaces ad hoc
tools (Trello/Sheets/Asana-style workflows) with a bot that lives in Telegram — where the cohort
already communicates — plus a web dashboard for oversight, task management, and stats.

**Problem**: Interns and higher-ups currently track tasks across tools separate from where they
actually talk to each other (Telegram), causing friction and things falling through cracks.

**Goal**: Unify task tracking into Telegram, matching the tool (Devie) the cohort's higher-ups
already trust, with a dashboard for anyone who wants the full picture at a glance.

**Status**: live in production, serving the real Cohort 5 group. Built to be reusable — a future
cohort is a new cohort id, not a code change (§10).

## 2. Users

There is no role, tier, or permission split of any kind. Anyone who messages the bot is
registered automatically on first contact — no config file, no approval, nothing to wait on
(§7) — and every registered member can create a task, assign it to anyone else in their cohort,
read every task in the cohort, and set any status on any task, including their own.

**Cohort scoping is the one boundary that exists**, and it isn't a permission — it's tenancy. A
member of one cohort cannot see or act on another cohort's tasks; this is what lets one deployment
serve more than one cohort (§10) and what keeps the dry-run environment isolated from production.

**Nothing is verified beyond "has this Telegram account messaged the bot before."** There is no
review step, no approval gate, no confirmation before a destructive-feeling action, and no
audit trail beyond who performed each action (recorded, never gated on). This is a deliberate
choice, not an oversight: it matches Devie, and the maintainer's explicit call was that a later,
separate proposal may reintroduce access control if it's ever needed — see ADR-0013's
"Consequences" for the full list of what this gave up.

## 3. Task Data Model

| Field | Notes |
|---|---|
| id | Auto-generated, sequential, scoped per cohort |
| title | Required |
| description | Optional — the one-line `/addtask` grammar (§5) has no room for one; still settable via the dashboard |
| assignee | A cohort member, or unassigned if the creator didn't name one — no role restriction on who can be assigned |
| assigned_by | Whoever ran the command or dashboard action that created it |
| due_date | Required — defaults to the next Tue/Thu onsite day if not given |
| status | One of six free-set values (§4) — `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done` |
| priority | One of `low`, `medium`, `high`, `urgent` — defaults to `medium` |
| tags | Cohort-scoped labels, managed from the dashboard's kanban board |
| notes | A free-text log any member can add to, via `/update`'s `note:` rider or the dashboard |
| created_at / updated_at | Timestamps |

`blocked` is one of the six statuses now, not a separate flag — see §4.

## 4. Task Lifecycle

Six free-set statuses — **backlog, todo, in progress, in review, blocked, done** — with no
required order and no legal-transition check. **Any registered cohort member can set any status
on any task at any time**, including their own, and including moving a `done` task back to an
earlier status. There is no locked/final state.

- **`done` is a claim, not a verified fact.** Self-approval is possible by design — the person
  who did the work can mark their own task Done, with nothing checking or reviewing it.
- **There is no "cancelled" status.** The nearest equivalent to abandoning a task is moving it to
  `backlog`, or to `blocked` with a note explaining why.
- **`/done` and `/update <ref> done` mean different things.** `/done <ref>` sets `in_review` (send
  it for a look); `/update <ref> done` sets `done` (actually finished). This is a known, load-
  bearing quirk copied from Devie on purpose — see `USER_GUIDE.md`'s warning about it.
- **Overdue is a derived flag, not a status** — any open (not `done`) task past its due date shows
  as overdue wherever tasks are listed, and triggers the one-time overdue-crossing notification
  (§8). "Backlog," in cohort terminology, is just the `backlog` status, not overdue work — that
  distinction existed in the original design (v1 PRD §4) but no longer applies.

## 5. Telegram Bot — Commands

Ten commands, matching Devie's own surface exactly: `/start`, `/help`, `/tasks`, `/deadlines`,
`/addtask`, `/done`, `/complete`, `/completed`, `/update`, `/standup`. `USER_GUIDE.md` is the
source of truth for the full grammar and worked examples; this section is a summary of what each
one is for.

- **`/start`** — registers the caller (or refreshes their registration) and says hello. No role
  question, no group-membership check.
- **`/help`** — the full command list, identical for everyone.
- **`/addtask <title> [!priority] [by <date>] [@username]`** — creates a task in one line, in any
  order, defaulting to medium priority and the next Tue/Thu onsite day. When no explicit
  `!priority` flag is given, a natural-language priority or deadline phrase in the title (e.g.
  "high priority") is picked up automatically instead of being ignored. `@all` or a cohort id fans
  a task out to every member of that scope. A bare `/addtask` returns a usage example, not a form.
  Pasting a multi-task message (multiple `@mentions`, newlines, or a list-shaped paste) instead
  extracts and creates every task it can find, with no confirmation step and no roster validation
  on the assignee — matching Devie's own loose bulk-create behavior.
  An `@`-mention of the bot with a trigger phrase ("pls work on ...") reuses this exact grammar
  from ordinary chat, in DM or group.
- **`/tasks [@username | <cohort-id>]`** — every task in scope, grouped by member, with inline
  paging and filter buttons.
- **`/deadlines`** — open tasks due in the next 7 days.
- **`/update <ref>[,<ref>...] <status>`** — sets a status on one or many tasks at once
  (comma- or newline-separated), optionally riding a `link:<url>` and/or `note:<text>` onto the
  same call. Reports success/failure per task. `<ref>` may be a task number or a keyword matching
  a task's title — a keyword match with more than one candidate is shown as a disambiguation list
  rather than guessed; an unrecognized status word falls back to a Claude-assisted best guess
  instead of being rejected outright.
- **`/done`** / **`/complete`** (or **`/completed`**) — fixed-status shortcuts onto the same
  mechanism as `/update`, both accepting the same bulk-ref grammar.
- **`/standup`** — an on-demand report for the whole cohort, with buttons to switch between
  Overview, Active, Backlog, Done, and In review.

No wizards, no multi-step forms, no inline confirmation buttons for anything other than
`/tasks`/`/standup`'s paging and filters.

## 6. UX & Interaction Conventions

- **Task IDs are simple sequential integers**, scoped per cohort — short and easy to say out loud
  in a chat command like `/done 12`.
- **Actionable notifications**: every notification states the concrete next step (e.g. "Send
  `/done 12` when you're ready for review"), not just the bare fact.
- **Friendly empty and error states**: an invalid or inapplicable task ref gets a specific message
  rather than a generic failure.
- **Unknown command fallback**: an unrecognized command gets "Not sure what you're asking — try
  /help" in DM. In a group chat, the bot stays silent on anything that isn't a recognized command,
  an `@`-mention, or a message it's mid-processing — it doesn't reply to every message it
  technically receives, even with privacy mode off (see below).
- **Forgiving input**: command parsing trims stray whitespace and is case-insensitive.
- **One-tap onboarding link**: a direct `t.me/<BotUsername>` link opens the chat with `/start`
  ready to send.

**Group chat command support**: every command, including `/addtask`'s mention trigger and
bulk-paste, works directly inside the cohort's group chat, not just in DM. This requires the
bot's Telegram privacy mode **off** (`@BotFather` → `/setprivacy` → Disable), so it receives every
message in the group, not just ones starting with `/`. Consequence: task titles, notes, and full
detail post publicly into the group whenever a command runs there — an accepted tradeoff, not an
oversight; anyone who wants privacy can DM the bot instead.

## 7. Identity & Registration

Fully automatic, matching Devie's own `syncMember`: anyone who messages the bot — in DM or in the
group — is inserted into the roster on first contact and refreshed on every later one. There is
no config file to maintain, no group-membership check, and nothing to add by hand when someone
new joins the cohort. Telegram's own platform limit still applies — the bot can never initiate a
DM to someone who hasn't messaged it first — so a new member's very first message still has to
reach the bot somehow (a DM, or anything in the group once privacy mode is off) before it can DM
them proactively.

## 8. Notifications (proactive, via DM and group)

- **On any status change** (via `/update`, `/done`, `/complete`/`/completed`, single or bulk) —
  both the assignee and whoever originally assigned the task get a DM naming the new status,
  except whoever made the change. A bulk update collapses this to **one summary DM per
  recipient**, not one per task.
- **Due-date reminder** → about a day before the due date.
- **Overdue crossing** → a single, one-time notification the moment an open task crosses its due
  date, sent to both the assignee and the assigner.
- **Weekly digest** (Mondays) and **daily standup digest** — both DM'd individually and posted as
  a group summary. The group summary is deliberately **counts-only** — never task titles or
  descriptions — to give the cohort shared visibility without turning into a public callout of
  who's behind. This restraint holds even though the bot can read (and post detail into, via
  commands) the full group chat — it was never about read access, only about not automating a
  callout.
- **Standup, with character**: `/standup` (and a separate, secret-gated push endpoint) render a
  daily quote, a greeting, and emoji priority/status badges alongside the counts — matching
  Devie's own standup presentation. The push endpoint now also runs on a schedule (Supabase
  `pg_cron`, 00:05 UTC / 8:05am Asia/Manila daily), gated by an Auto-standup on/off switch on the
  dashboard's settings page (default off); the on-demand `/standup` command is unaffected by the
  switch either way.

No standup response-collection (a "what did you do yesterday" prompt-and-reply flow) and no
overdue-nagging loop — unchanged from the original design's deferrals (§11). All scheduled
notifications run on **Asia/Manila time**.

## 9. Website Dashboard

- **Audience**: any registered cohort member — the higher-up-only tier is gone, matching the bot.
- **Auth**: Telegram Login Widget (official, free) — no separate password system. Logging in
  still requires an existing roster row (i.e., having messaged the bot at least once); nothing
  distinguishes members further once logged in.
- **Features**: an Overview landing page at `/dashboard` (the app's `/` redirects there), a kanban
  board (drag-and-drop, tags), full task list/oversight filterable by status or member, task
  creation and editing, a settings page (Appearance, Bot Connection, Daily Standup — including the
  Auto-standup on/off switch), a team page, a paginated activity-log view, light/dark theming, and
  a stats view (tasks completed per member, completion rate).

## 10. Reusability

Built so a future cohort can reuse the system by adding a cohort id, not by a code change. Every
task, roster row, and registration is tagged with a cohort identifier; `/tasks`, `/deadlines`,
`/standup`, and the dashboard all default to showing only the current deployment's bound cohort
(§12). Past-cohort data isn't deleted, just not surfaced by default.

## 11. Out of Scope (Deferred)

Still deferred, unchanged from the original design: a Telegram Mini App, file/proof-of-work
attachments, CSV export of task history, recurring/template tasks, overdue-escalation nagging,
and standup response-collection (a "what did you do yesterday" prompt-and-reply flow — the
automated digest and the on-demand `/standup` are the only forms of "standup" this bot has).
Multi-tenant support beyond DevCon PH is likewise still out of scope. A ranked hierarchy or
peer-to-peer permission model is moot now that there's no role concept at all (§2) — reintroducing
any of that would be a new, separate proposal, per ADR-0013.

## 12. Technical Constraints

- **Hosting**: Vercel + Supabase, matching DevCon's other tooling — see
  [ADR-0001](./docs/adr/0001-replatform-to-vercel-supabase.md). Free-tier caveat: a Supabase
  project with no requests for 7 consecutive days pauses automatically; two Vercel Cron jobs exist
  partly to prevent that.
- **Scale**: a handful of cohorts of ~8-ish members each. No performance/scaling concerns at this
  size.
- **Platform limits acknowledged**: no bot-initiated DM without the recipient having messaged the
  bot at least once first — this is a hard Telegram limit, not a design choice (§7).
- **Group chat access**: the bot's Telegram privacy mode is disabled so it can receive commands,
  mention triggers, and bulk-paste input typed directly in the group (§6).
- **Timezone**: all scheduling and due-date logic uses Asia/Manila.
- **Date parsing**: due dates are natural language (`chrono-node`), anchored on a required `by`
  keyword (§5) so ordinary words in a title are never misread as a date. A past date is accepted,
  with a warning, not rejected.
- **Concurrency**: an optimistic `row_version` check on the tasks table catches two concurrent
  writers to the same task; no conflict-resolution UI beyond that.
- **Dashboard/bot parity**: the dashboard enforces the exact same rules as the bot — not a
  separate rule set, just a different interface onto the same `TaskService`.
- **Caller resolution is bound to one cohort per deployment** — each deployed instance (production,
  dry-run) serves exactly one cohort, resolved from an `ACTIVE_COHORT_ID` env var, so the same
  Telegram account existing in more than one cohort's roster can never resolve ambiguously within
  a single deployment.

## 13. Open Items

None currently tracked. The original v1 PRD's one open item (the assignment wizard's command
name) was resolved during v1 and later mooted entirely — there is no wizard any more (§5).
