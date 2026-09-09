# Using the task bot

For everyone in Cohort 5. No technical background needed.

The bot shows up in Telegram as **Devie**, and its handle is **`@devcon_cohort5_taskbot`** — that
handle is the reliable way to tell it apart from the original Devie bot, which has the same
display name and picture on purpose.

It is a deliberate copy of that original Devie: same commands, same statuses, same
trust-everyone approach. If something feels unusually open — no roles, no approval step — that's
copied behaviour, not a bug.

## Getting started

Message the bot and send `/start`. That's it — you're registered. No role to pick, nothing to
wait for.

You need a Telegram **username** for this to work (the bot identifies you by it). If a command
tells you to set one, do it in Telegram's settings and try again.

Send `/help` any time for the command list, or type `/` to get Telegram's autocomplete menu.

## Cheat sheet

| Command | What it does |
|---|---|
| `/addtask <title> [!priority] [by <date>] [@user]` | Create a task |
| `/tasks` | Every task in the cohort, grouped by person |
| `/tasks @username` | Just one person's tasks |
| `/deadlines` | Open tasks due in the next 7 days |
| `/update <ref> <status>` | Set any status on any task |
| `/done <ref>` | Send a task **for review** (⚠️ not "finished") |
| `/complete <ref>` | Mark a task **actually finished** |
| `/standup` | Today's report for the whole cohort |

`<ref>` is a task number (`12`, `t12`, `T-012`) **or** a word from its title (`/done login bug`).

## Where commands work

Both in a private message to the bot and directly in the cohort's group chat.

**In the group, everyone sees it.** Task titles and note text you type there are public to the
group. DM the bot for anything you'd rather keep to yourself.

## Everyone can do everything

No intern/higher-up split, no permission gate, no review step. Anyone who has messaged the bot
can create a task, assign it to anyone, and move any task to any status — including their own.
Nothing double-checks it. This is deliberate, copied from Devie.

## Creating a task

`/addtask fix the login bug` — assigned to you, due the next onsite day (Tuesday or Thursday),
medium priority.

Add any of these, in any order:

| Add | Effect |
|---|---|
| `by next Friday` | A due date in plain language (`in 3 days`, `Sept 5` also work) |
| `!urgent` | Priority — `!low`, `!medium`, `!high`, `!urgent` |
| `@jean` | Assign to someone else |

So: `/addtask fix the login bug @jean !high by next Friday`.

A few things worth knowing:

- **`by` is required for a due date.** The bot only looks for a date *after* the word `by`, so a
  title that happens to mention a month or weekday (`fix bug in march module`) is never misread.
  Without `by`, you get the next-onsite-day default.
- **Plain-language priority is picked up too.** `/addtask fix the login bug, high priority` works
  without the `!` flag.
- **Past dates are allowed**, with a `⚠️ That due date is already in the past.` warning, so a typo
  doesn't slip by.
- **Bare `/addtask`** returns a usage example rather than starting a form.

**Assign to everyone**: `/addtask <title> @all` creates one copy for every member of the cohort.
Passing a cohort id instead of `@all` does the same for that cohort — only useful if this
deployment ever serves more than one, which today it doesn't. `/tasks <cohort-id>` filters the
same way.

**From ordinary chat**: `@`-mention the bot followed by `pls work on`, `please work on`,
`add task`, `new task`, or `todo`, then the same grammar. Good for the moment someone says "can
you also fix X" in the group:

> @devcon_cohort5_taskbot pls work on fix the login bug by next Friday

**Pasting a list**: paste a multi-line message, several `@mentions`, or something list-shaped
("Action Plan:", blank-line-separated items) and the bot tries to pull out every task and create
them all at once. There's no confirmation step and it doesn't check that the names are real
people. If a paste misbehaves, send one `/addtask` per task instead.

## Changing a status

Six statuses: **backlog, todo, in progress, in review, blocked, done**. Any of them, on any task,
any time — including moving a finished task back.

```
/update t23 todo
/update 23 done
/update t23 blocked note: waiting on API access
```

You can lead with the status (`done t23`), and attach `link:<url>` and/or `note:<text>` to leave
a link or note at the same time.

### ⚠️ `/done` does not mean done

This is the one thing people get wrong.

- **`/done <ref>`** → sets **In review** ("I've finished working on this, please look at it")
- **`/complete <ref>`** (or `/completed`) → sets **Done** (actually finished)
- **`/update <ref> done`** → also sets **Done**

So the word "done" means two different things depending on whether it's the command or the
argument. That's inherited from Devie, wart and all. Remember: **`/done` = send for review,
`/complete` = finished.**

### Bulk updates

All three commands take several refs at once, comma- or line-separated:

```
/update t21,t22,t23 done          -> all three to Done
/update t21 todo, t22 review      -> a different status each
/done t21,t22,t23
```

You get a per-task ✓/✗ report — one bad ref doesn't stop the rest:

> `/update t14,t15,t16 in review`
> → `3/3 updated.` · `t14 ✓ In review` · `t15 ✓ In review` · `t16 ✓ In review`

If you update several of someone else's tasks at once, they get **one** summary DM, not one per
task.

### Blocking

There's no `/blocked` command — blocked is just a status:

```
/update 3 blocked note: waiting on API access
```

Unblock by setting whatever status now makes sense (`/update 3 in progress`).

### Notes and edits

No `/note` or `/edit` command. Attach notes with `note:<text>` on a status update. To change a
title, description, due date, or assignee, use the dashboard — the bot can't edit those fields.

To park a task you no longer need, `/update` it to `backlog`, or to `blocked` with a note. There's
no "cancel" or locked state.

## What the bot sends you, unasked

| When | Where | What |
|---|---|---|
| Any status change | DM | To the assignee and whoever assigned it — not to whoever made the change |
| 8:05am daily | **Group** | The standup card: everyone's open work, grouped by person |
| 9:00am | DM | "Due tomorrow" reminder |
| 10:00am | DM | Your own open tasks — nothing about anyone else's |
| Mondays 8:10am | DM | What *you* completed in the last 7 days |
| When it happens | DM | A one-time alert when a task crosses its due date, to assignee and assigner |

The rule behind this: **anything personal is a DM, anything cohort-wide is the group's morning
standup card, and nothing appears in both.** So your DMs are about your work only, and the one
group post is the shared picture.

The morning standup card sorts everyone's open tasks into three buckets:

- ⚠️ **Overdue** — past its due date
- 🔄 **Doing** — actively being worked on
- 👀 **For approval** — sent for review, waiting on someone to look

The card is switched on or off from the dashboard's settings page. `/standup` works on demand
either way, and has buttons to flip between Overview, Active, Backlog, Done, and In review.

## The dashboard

Anyone registered with the bot can log in with their Telegram account — no separate password.
Ask whoever runs the bot for the current URL. Five pages:

| Page | What's there |
|---|---|
| **Overview** | Counts at a glance — total, completed, in progress, in review, blocked, urgent, overdue |
| **Board** | Kanban board: drag tasks between statuses, add tags, **create and edit tasks** |
| **Team** | Everyone in the cohort, editable |
| **Activity** | A log of what changed |
| **Settings** | Appearance, bot connection, and the daily standup on/off switch |

The Board is where you edit a task's title, description, due date, or assignee — the fields the
bot can't touch. There's no admin tier: logging in just requires having messaged the bot.

## Something not working?

Contact whoever maintains the bot for the cohort rather than guessing. Nothing is
permission-gated, so an unexpected rejection is almost certainly a real bug, not an intentional
restriction.
