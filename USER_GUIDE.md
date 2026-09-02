# Using the DevCon Cohort 5 Task Bot

A guide for interns and higher-ups. No technical background needed.

## Getting started

1. Make sure a higher-up has added your Telegram username to the roster.
2. Message the bot (`@devcon_cohort5_taskbot`) and send `/start`.
3. Send `/help` any time to see the command list again from inside Telegram, or start typing `/`
   to see Telegram's own autocomplete menu for every command.

If `/start` says you're not on the roster, ask a higher-up to add you before trying again.

## Where you can use commands

Commands work both in a private message to the bot **and** directly in the cohort's group chat —
including `@`-mentioning the bot to create a task (see below).

**Important**: if you run a command in the group chat (like checking a task's details, or adding
a note), the task's title, description, and any notes will be visible to everyone in the group —
it's not private. If you want to keep something private, do it in a DM with the bot instead.

## Everyone can do everything

There's no separate intern/higher-up command set any more. Anyone on the roster can create a
task, assign it to anyone else, and move any task to any status — the only exception is `/edit`
(see below), which stays higher-up-only. That's a deliberate choice, matching how **Devie**
(another DevCon bot the higher-ups already use daily) works: it trusts people to do the right
thing instead of gating every action behind a review step.

## Creating a task

**`/addtask <title> [by <date>] [@username]`** creates a task in one line. Examples:

- `/addtask fix the login bug` — assigned to you, due the coming Friday.
- `/addtask fix the login bug by next Friday` — a specific due date, in natural language
  ("next Friday", "in 3 days", "Sept 5" all work).
- `/addtask fix the login bug @jean` — assigned to `@jean` instead of you.
- `/addtask fix the login bug @jean by next Friday` — both together, in either order.

The word **`by`** is required to set a due date — the bot only looks for a date after `by`, so a
title that happens to mention a month, weekday, or time (`fix bug in march module`, `call sat
about the API`) is never misread as a date. No `by` clause means the coming-Friday default
applies, and the title is kept exactly as typed.

Send bare **`/addtask`** with no text to get the old step-by-step form instead (who, title,
description, due date) — useful if you want to add a description, since the one-line form
doesn't have room for one. The form expires after 20 minutes of inactivity; if you answer after
it's expired, the bot tells you and asks you to send `/addtask` (or `/edit <ref>`) again.

A due date in the past is accepted, not rejected — backdating a task is legitimate — but the
reply (from `/addtask`, `/edit <id> duedate <value>`, and the step-by-step form's confirmation
prompt) warns you with "⚠️ That due date is already in the past." so a typo doesn't go unnoticed.

**Mention trigger**: in a group chat (or DM), `@`-mention the bot followed by one of `pls work
on`, `please work on`, `add task`, `new task`, or `todo`, then the same one-line grammar as
`/addtask`. For example:

> @devcon_cohort5_taskbot pls work on fix the login bug by next Friday

does exactly what `/addtask fix the login bug by next Friday` does. This is meant for the
moment someone says "can you also fix X" in chat — you can turn it straight into a task without
switching to a slash command.

## Reading tasks

| Command | What it does |
|---|---|
| `/task <ref>` | Full detail on one task — description, assignee, due date, status, notes. `<ref>` is a task id, written as `23` or `t23`. |
| `/tasks [page]` | Every task in the cohort, grouped by assignee. Long lists come back 10 at a time — `/tasks 2` for the next page. |
| `/tasks @username` | Filter to one member's tasks. |
| `/tasks intern` or `/tasks higherup` | Filter to tasks assigned to that role. |
| `/mytasks` | Your own open tasks. |
| `/overdue` | Tasks past their due date. |
| `/pending` | Tasks currently In review. |
| `/deadlines` | Open tasks due in the next 7 days, soonest first. |
| `/blocked` | Blocked tasks, cohort-wide. |
| `/standup` | An on-demand version of the daily standup report, cohort-wide, whenever you want it. |
| `/dashboard` | Sends the link to the web dashboard. |
| `/cancel` | Cancels whatever multi-step form (wizard) you're in the middle of. |

## Changing a task's status

Six statuses exist: **backlog, todo, in progress, in review, blocked, done**. Anyone can set any
status on any task in the cohort with:

**`/update <ref> <status>`** — e.g. `/update t23 todo`, `/update 23 done`. Recognised status
words: `backlog`, `todo`/`to-do`, `in progress`/`inprogress`/`wip`, `in review`/`review`,
`blocked`, `done`/`complete`/`completed`.

Two shortcuts exist for the two moves people make constantly:

- **`/done <ref>`** — marks a task **In review**. (Not Done — see the warning below.)
- **`/complete <ref>`** — marks a task **Done**.

**⚠️ `/done` does not mean done.** This is the one thing people get wrong: `/done <ref>` puts a
task *In review*, the same as saying "I'm done working on this, please look at it." To actually
mark it finished, use `/complete <ref>`. This mirrors Devie exactly, wart and all — `/update
<ref> done` (the generic command, not the shortcut) *does* set the status to Done, so the word
"done" means two different things depending on whether it's the command name or the argument.
It's confusing on purpose-by-inheritance, not a bug — just remember: **`/done` = send for
review, `/complete` = actually finished.**

**Bulk updates**: `/update`, `/done`, and `/complete` all accept more than one task ref at once,
comma-separated:

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

## Blocking and unblocking

- **`/blocked <ref> <reason>`** — flags a task as blocked and why, e.g. `/blocked 3 waiting on
  API access`. This immediately notifies the person who assigned the task.
- **`/blocked`** with no arguments — lists every blocked task in the cohort (this is the same
  command name doing two different things depending on whether you give it arguments).
- **`/unblock <ref>`** — restores the task to whatever status it was in before it got blocked.

## Notes and editing

- **`/note <ref> <text>`** — attaches a feedback note to a task, e.g. `/note 3 looks good, ship
  it`. The assignee gets notified immediately.
- **`/edit <ref> <field> <value>`** — **higher-ups only**. Directly changes one field: `field`
  is `assignee`, `title`, `description`, or `duedate`. Example: `/edit 12 duedate next Monday`.
- **`/edit <ref>`** with no field/value — **higher-ups only**. Opens a menu asking which field
  to change, then walks you through it one step at a time. Send `/cancel` at any point to back
  out without saving.

Nothing locks once a task is Done — you can edit or reopen a finished task at any time. There's
no separate "cancel a task" command any more either; if a task is no longer needed, just
`/update` it to `backlog` (the nearest "parked" status) or `blocked` with a note explaining why.

## Automatic notifications

You don't need to ask for these — they happen on their own:

- Whenever anyone changes a task's status (including via a bulk `/update`), the assignee and the
  person who originally assigned it both get a DM — except whoever made the change themselves.
- A reminder the day before a task is due.
- A notice when a task crosses its due date without reaching Done.
- When someone flags a task as blocked, the assigning person gets a DM.
- A daily standup and a weekly summary posted to the group chat. Both are deliberately
  counts-only (e.g. "3 tasks due today, 1 overdue") and never name specific task titles, to avoid
  publicly calling anyone out.

## The web dashboard

Higher-ups can log in using their Telegram account (no separate password) to see every task at a
glance — filterable by status or by intern — and can also create new tasks, edit an existing
task's fields, and view cohort-wide stats (tasks completed per intern, completion rate) directly
from the dashboard, using the same rules the bot enforces. Ask whoever's running the project for
the current dashboard URL, or send `/dashboard` to the bot.

## Something not working?

If the bot doesn't respond, or a command gives an error you don't understand, contact whoever is
maintaining the bot for this cohort rather than guessing. Almost nothing is permission-gated any
more, so an unexpected rejection is more likely a genuine bug than an intentional restriction —
the one exception is `/edit`, which is intentionally higher-ups only.
