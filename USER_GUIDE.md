# Using the DevCon Cohort 5 Task Bot

A guide for interns and higher-ups. No technical background needed.

## Getting started

1. Make sure a higher-up has added your Telegram username to the roster.
2. Message the bot (`@devcon_cohort5_taskbot`) and send `/start`.
3. Send `/help` any time to see this list of commands again from inside Telegram.

If `/start` says you're not on the roster, ask a higher-up to add you before trying again.

## Where you can use commands

Commands work both in a private message to the bot **and** directly in the cohort's group chat.

**Important**: if you run a command in the group chat (like checking a task's details, or adding
a note), the task's title, description, and any notes will be visible to everyone in the group —
it's not private. If you want to keep something private, do it in a DM with the bot instead.

## Everyone can:

| Command | What it does |
|---|---|
| `/help` | Shows the command list |
| `/mytasks` | Lists tasks assigned to you |
| `/alltasks` | Lists every task in the cohort, grouped by status |
| `/backlog` | Lists tasks that are open but not yet started |
| `/pending` | Lists tasks currently in review |
| `/blocked` | Lists blocked tasks — yours if you're an intern, the whole cohort's if you're a higher-up |
| `/task <id>` | Shows full details for one task, e.g. `/task 3` |
| `/dashboard` | Sends the link to the web dashboard |
| `/cancel` | Cancels whatever multi-step process (wizard) you're in the middle of |

## If you're an intern:

| Command | What it does |
|---|---|
| `/submit <id>` | Marks a task as submitted for review, e.g. `/submit 3` |
| `/blocked <id> <reason>` | Flags a task as blocked and why, e.g. `/blocked 3 waiting on API access` |
| `/unblocked <id>` | Clears a blocked flag |

`/blocked` does two different things depending on how you send it: with no arguments it lists
blocked tasks (see the "Everyone can" table above); with a task id and reason it flags that task
as blocked.

When a higher-up approves or sends back a task you submitted, you'll get a message about it
automatically — no need to check manually.

## If you're a higher-up:

| Command | What it does |
|---|---|
| `/assign` | Starts a step-by-step wizard to assign a new task (who, what, due date) |
| `/edit <id>` | Starts a wizard to edit an existing task's fields |
| `/note <id> <text>` | Adds a note to a task, visible to the assignee |
| `/approve <id>` | Approves a submitted task |
| `/revise <id>` | Sends a submitted task back for revision |
| `/canceltask <id>` | Cancels a task (asks for confirmation first) |

When an intern submits a task, you'll get a message with **Approve** / **Revise** buttons you can
tap directly — no need to type the command.

## The `/assign` and `/edit` wizards

These are conversations, not single commands — the bot asks you one question at a time (who,
what, due date, etc.) and you reply with plain text. Due dates understand natural language, e.g.
"next Friday" or "in 3 days" — you don't need to type an exact date. Send `/cancel` at any point
to back out without making changes.

## Automatic notifications

You don't need to ask for these — they happen on their own:

- A reminder the day before a task is due.
- A notice when a task crosses its due date without being finished (sent to both you and the
  higher-up who assigned it).
- A daily and weekly summary posted to the group chat. This summary is deliberately just counts
  (e.g. "3 tasks due today, 1 overdue") — it never names specific task titles, to avoid
  publicly calling anyone out.

## The web dashboard

Higher-ups can log in to a read-only dashboard using their Telegram account (no separate
password) to see every task at a glance — filterable by status or by intern. It doesn't support
creating or editing tasks yet; that's for the bot commands above. Ask whoever's running the
project for the current dashboard URL, or send `/dashboard` to the bot.

## Something not working?

If the bot doesn't respond, or a command gives an error you don't understand, contact whoever is
maintaining the bot for this cohort rather than guessing — some errors are permission checks
working as intended (e.g. an intern trying a higher-up-only command).
