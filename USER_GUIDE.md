# Using the DevCon Cohort 5 Task Bot

A guide for everyone in the cohort. No technical background needed.

This bot is a carbon copy of **Devie**, another DevCon bot the cohort already uses daily — same
commands, same statuses, same "trust everyone" philosophy. If something here feels unusually
open (no roles, no approval step), that's not a bug — it's what Devie does too.

## Getting started

1. Message the bot (`@devcon_cohort5_taskbot`) and send `/start`. That's it — you're registered.
   There's no role to pick and nothing to wait on; every later message you send keeps your
   registration up to date automatically.
2. Send `/help` any time to see the command list again, or start typing `/` to see Telegram's own
   autocomplete menu.

If `/start` (or any command) says you need a Telegram username first, set one in Telegram's
settings and try again — the bot identifies you by username, so it needs one to exist.

## Where you can use commands

Commands work both in a private message to the bot **and** directly in the cohort's group chat —
including `@`-mentioning the bot to create a task (see below).

**Important**: if you run a command in the group chat (like checking a task list, or updating a
status with a note), that task's title and any note text is visible to everyone in the group —
it's not private. Use a DM with the bot if you want to keep something private.

## Everyone can do everything

There's no intern/higher-up split, no permission gate, and no review step anywhere. Any person
who messages the bot can create a task, assign it to anyone, and move any task to any status —
including their own. Nothing double-checks this: it's a deliberate choice, matching Devie exactly.

## Creating a task

**`/addtask <title> [!priority] [by <date>] [@username]`** creates a task in one line, in any
order. Examples:

- `/addtask fix the login bug` — assigned to you, due the next onsite day (Tuesday or
  Thursday), medium priority.
- `/addtask fix the login bug by next Friday` — a specific due date, in natural language
  ("next Friday", "in 3 days", "Sept 5" all work).
- `/addtask fix the login bug !urgent` — flagged urgent (`!low`, `!medium`, `!high`, `!urgent`
  are the four levels; no flag means medium).
- `/addtask fix the login bug @jean` — assigned to `@jean` instead of you.
- `/addtask fix the login bug @jean !high by next Friday` — all three together, in any order.

The word **`by`** is required to set a due date — the bot only looks for a date after `by`, so a
title that happens to mention a month, weekday, or time (`fix bug in march module`, `call sat
about the API`) is never misread as a date. No `by` clause means the next-onsite-day default
applies (the next Tuesday or Thursday), and the title is kept exactly as typed — unless it
contains a natural-language priority or deadline phrase (`fix bug, high priority`), which is
picked up automatically the same way an explicit `!flag`/`by` clause is.

Send bare **`/addtask`** with no text to get a short usage example back, reminding you of the
grammar above.

A due date in the past is accepted, not rejected — backdating a task is legitimate — but the
reply warns you with "⚠️ That due date is already in the past." so a typo doesn't go unnoticed.

**Assigning to everyone, or to a group**: `/addtask <title> @all` assigns one copy of the task to
every registered member of the cohort. `/addtask <title> <cohort-id>` (e.g. the cohort's own id)
does the same for everyone in that cohort — useful if this deployment ever serves more than one
cohort.

**Mention trigger**: in a group chat (or DM), `@`-mention the bot followed by one of `pls work on`,
`please work on`, `add task`, `new task`, or `todo`, then the same one-line grammar as `/addtask`.
For example:

> @devcon_cohort5_taskbot pls work on fix the login bug by next Friday

does exactly what `/addtask fix the login bug by next Friday` does. This is meant for the moment
someone says "can you also fix X" in chat — you can turn it straight into a task without switching
to a slash command.

**Pasting several tasks at once**: paste a multi-line message, a message with more than one
`@mention`, or something that reads like a list ("Action Plan:", "Note:", blank-line-separated
items) and the bot tries to extract every task in it and create them all in one go, instead of
treating the whole thing as one task's title. There's no confirmation step and no roster check on
the assignee — every task it can pull out gets created, even if a name in it matches nobody. If a
paste isn't behaving the way you expect, it's simpler to send one `/addtask` per task.

## Reading tasks

| Command | What it does |
|---|---|
| `/tasks` | Every task in the cohort, grouped by member, with paging and filter buttons attached. |
| `/tasks <cohort-id>` | Filter to one cohort's tasks (only matters if this deployment serves more than one). |
| `/tasks @username` | Filter to one member's tasks. |
| `/deadlines` | Open tasks due in the next 7 days, soonest first. |
| `/standup` | An on-demand standup report for the whole cohort, with buttons to switch between Overview, Active, Backlog, Done, and In review. |

## Changing a task's status

Six statuses exist: **backlog, todo, in progress, in review, blocked, done**. Anyone can set any
status on any task in the cohort with:

**`/update <ref> <status>`** — e.g. `/update t23 todo`, `/update 23 done`. Recognised status
words: `backlog`, `todo`/`in progress`/`in review`/`review`, `blocked`, `done`/`complete`/
`finished`. You can also lead with the status instead of the ref (`done t23`), and attach
`link:<url>` and/or `note:<text>` after the status to leave a link or a note on the task at the
same time, e.g. `/update t23 blocked note: waiting on API access`.

**`<ref>` doesn't have to be a task number.** A word or phrase that appears in a task's title
works too — `/done login bug` finds the not-yet-done task whose title contains "login bug", the
same as typing its number. If more than one task matches, you're shown the short list of
candidates and asked to repeat the command with the number instead; a number that doesn't exist
is reported as not found, with no keyword fallback.

Two shortcuts exist for the two moves people make constantly:

- **`/done <ref>`** — marks a task **In review**. (Not Done — see the warning below.)
- **`/complete <ref>`** (or **`/completed <ref>`**) — marks a task **Done**.

**⚠️ `/done` does not mean done.** This is the one thing people get wrong: `/done <ref>` puts a
task *In review*, the same as saying "I'm done working on this, please look at it." To actually
mark it finished, use `/complete <ref>`. This mirrors Devie exactly, wart and all — `/update <ref>
done` (the generic command, not the shortcut) *does* set the status to Done, so the word "done"
means two different things depending on whether it's the command name or the argument. It's
confusing on purpose-by-inheritance, not a bug — just remember: **`/done` = send for review,
`/complete`/`/completed` = actually finished.**

**Bulk updates**: `/update`, `/done`, and `/complete`/`/completed` all accept more than one task
ref at once, comma-separated:

- `/update t21,t22,t23 done` — sets all three to Done.
- `/update t21 todo, t22 review` — a different status per task, comma-separated.
- Or one `<ref> <status>` pair per line (send a multi-line message) instead of commas.
- `/done t21,t22,t23` and `/complete t21,t22,t23` work the same way with their fixed status.

You'll get a per-task ✓/✗ report back — a bulk update doesn't stop partway through just because
one ref in the list was wrong; every valid one still goes through, and you're told which ones
didn't. If you're updating several of someone else's tasks in one go, they get a single summary
DM listing everything that changed, not one DM per task.

Worked example — you're clearing out a backlog and moving three tasks into review at once:

> `/update t14,t15,t16 in review`
>
> → `3/3 updated.`
> → `t14 ✓ In review`
> → `t15 ✓ In review`
> → `t16 ✓ In review`

## Blocking a task

There's no separate `/blocked`/`/unblock` command any more — blocked is just one of the six
statuses. Flag a task as blocked, with a reason, the same way you'd change any other status:

> `/update 3 blocked note: waiting on API access`

and restore it later with whatever status makes sense, e.g. `/update 3 in progress`. Whoever
assigned the task and its assignee both get a DM whenever a status changes, blocked included.

## Notes and editing

There's no dedicated `/note` or `/edit` command any more. Attach a note to a task by riding it
along on a status update — `/update <ref> <status> note:<text>` (see above) — and if you need to
correct a task's title, description, due date, or assignee, the fastest way today is through the
web dashboard (see below); nothing in the bot itself edits those fields directly.

Nothing locks once a task is Done — you can move it to any other status at any time, including
back to a status that reopens it. There's no separate "cancel a task" command; if a task is no
longer needed, `/update` it to `backlog` (the nearest "parked" status) or `blocked` with a note
explaining why.

## Automatic notifications

You don't need to ask for these — they happen on their own:

- Whenever anyone changes a task's status (including via a bulk `/update`), the assignee and the
  person who originally assigned it both get a DM — except whoever made the change themselves.
- A reminder the day before a task is due.
- A notice when a task crosses its due date without reaching Done.
- A daily standup and a weekly summary posted to the group chat. Both are deliberately
  counts-only (e.g. "3 tasks due today, 1 overdue") and never name specific task titles, to avoid
  publicly calling anyone out.

## The web dashboard

Anyone registered with the bot can log in using their Telegram account (no separate password) to
see every task at a glance — filterable by status or by member — with a kanban board, tags,
settings, team, and activity-log views, plus cohort-wide stats. There's no separate admin tier on
the dashboard any more than there is in the bot: logging in just requires being a known cohort
member. Ask whoever's running the project for the current dashboard URL.

The settings page's Daily Standup section is where the automatic daily standup post gets turned
on or off (it posts every morning once enabled, on top of the on-demand `/standup` command,
which always works regardless of the switch).

## Something not working?

If the bot doesn't respond, or a command gives an error you don't understand, contact whoever is
maintaining the bot for this cohort rather than guessing. Nothing is permission-gated any more, so
an unexpected rejection is almost certainly a genuine bug, not an intentional restriction.
