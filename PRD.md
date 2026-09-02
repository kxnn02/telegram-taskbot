# PRD: DevCon PH Cohort 5 Task Bot

> **Partly superseded — read [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md)
> alongside this document.** The bot's commands became direct one-liners, and its six gated
> statuses were replaced by six free-set ones matching **Devie**, another DevCon bot this
> cohort's higher-ups already use. That deleted the submit → review → approve workflow this PRD
> was originally built around. Specifically superseded: **§4 Task Lifecycle**,
> **§5 Telegram Bot — Commands**, the role split in **§2 Users & Roles**, and the notification
> triggers in **§8**. The `status` field in **§3** changes values. §6 and §12 each carry one small
> inline correction (marked in place) for a UX convention or example that referenced a
> now-removed command; the rest of §6, plus §7, §9-§12, are otherwise unaffected.
>
> **Implemented** ([#35](https://github.com/kxnn02/telegram-taskbot/issues/35), the last of stages
> [#28](https://github.com/kxnn02/telegram-taskbot/issues/28)-#35 under spec
> [#27](https://github.com/kxnn02/telegram-taskbot/issues/27)) — the superseded sections below no
> longer describe the bot's actual behaviour; each carries an inline note pointing to the current
> behaviour, and the original text is kept below it as the historical record of v1's design. See
> also the re-platform ADRs (0001-0008) and `CONTEXT.md`, which cover a separate, now-unblocked
> change to the stack rather than the product.

## 1. Overview

A Telegram-native task management system for DevCon PH's internship program, starting with
Cohort 5 (~8 interns). It replaces ad hoc tools (Trello/Sheets/Asana-style workflows) with a
bot that lives in Telegram — where interns and higher-ups already communicate — plus a
lightweight website dashboard for oversight.

**Problem**: Interns and higher-ups currently track tasks across tools separate from where
they actually talk to each other (Telegram), causing friction and things falling through
cracks.

**Goal**: Unify task assignment, submission, and review into Telegram, with a dashboard for
higher-ups to see everything at a glance.

**Timeline**: v1 target — before Thursday. Small scope by design to hit this date without
compromising correctness.

## 2. Users & Roles

> **Superseded by [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md), implemented.**
> The role split below described v1's gated permission model. It no longer applies: any
> registered roster member — Intern or Higher-up — may create a task, assign it to anyone else
> on the roster, read every task in the cohort, and set any status on any task. **Three checks
> are still restricted to `HigherUp`: the `/edit` command, `TaskService.getStats`
> (`src/service/taskService.ts`, near line 354), and dashboard login
> (`src/web/telegramLoginHandler.ts`, near line 47).** There is no other role check left anywhere
> in `TaskService` or `createBot.ts`. The rest of this section (role assignment via the roster
> config, and the roster's shared use for the dashboard's Telegram Login Widget) is unaffected —
> only the permission table and the three notes below it are superseded. The rest of this
> section is kept below as the historical record of v1's design.

> **Superseded by [ADR-0010](./docs/adr/0010-group-gated-registration-and-roster-management.md),
> planning only.** The line below — *"No self-registration surface: identity is resolved against
> a known roster (see §7)"* — and the "Role assignment" paragraph describing a roster config are
> both superseded: `/start` now verifies group membership and lets the caller declare their own
> role, and roster management moves in-product, gated on live Telegram group-admin status rather
> than the roster role. `roster.config.json` no longer exists. The rest of this section is kept
> below as the historical record of that earlier design.

| Role | Description | Permissions |
|---|---|---|
| Intern | Cohort 5 participant | View own tasks, view all tasks (read-only), submit own tasks |
| Higher-up | Program admin/supervisor (equal power, no tiers) | Assign, edit, cancel, approve/revise any task, view all tasks, view stats |

No self-registration surface: identity is resolved against a known roster (see §7). No
peer-to-peer task assignment. No ranked hierarchy among higher-ups in v1.

**Role assignment**: a single roster config lists every known person for the cohort — Telegram
username mapped to role (Intern or Higher-up). This is the same roster used for identity
resolution in §7, not a separate list. This config is also what the dashboard's Telegram Login
Widget checks against to decide who is allowed to log in.

**Permission enforcement**: every command is checked against the caller's role before it runs.
Higher-up-only commands (`/pending`, `/note`, `/edit`, `/canceltask`, assignment,
`/approve`/`/revise`) must reject any caller not on the higher-up config list. `/submit
<task_id>` additionally checks that the task is actually assigned to the calling intern — not
just any valid task ID.

**Ownership is not restricted among higher-ups**: because higher-ups are equal power with no
tiers, any higher-up can `/edit`, `/canceltask`, `/approve`, or `/revise` *any* task, not just
ones they personally assigned — this prevents a task getting stuck if the original assigner is
unavailable. Notifications still route only to the original assigner (§8) to keep noise down,
but that's a routing choice, not a permission restriction — any higher-up can act regardless of
who gets notified.

**Assignment is intern-only**: the assignment wizard's "who?" step only accepts interns as the
assignee — a higher-up cannot assign a task to another higher-up. This is enforced by checking
the chosen assignee against the intern/higher-up config split, not left to convention.

## 3. Task Data Model

| Field | Notes |
|---|---|
| id | Auto-generated |
| title | Required |
| description | Required |
| assignee | Telegram user, required — must be an Intern (validated against the roster, §2, §7) |
| assigned_by | Telegram user (higher-up who created it) |
| due_date | Required |
| status | See §4. **Superseded values (ADR-0009, implemented)**: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done` — replacing the `Assigned`/`InProgress`/`Submitted`/`Approved`/`NeedsRevision`/`Cancelled` values described in §4 below. `blocked` is now one of these six status values, not the separate boolean flag §3's `blocked` row below describes. |
| notes | Free-text feedback log from higher-ups (via `/note`) |
| blocked | Boolean + reason text, set via `/blocked` (§5). A flag, not a status — can coexist
  with any lifecycle status. |
| created_at / updated_at | Timestamps |

No priority levels, no attachments/proof-of-work, no subtasks in v1.

## 4. Task Lifecycle

> **Superseded by [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md), implemented.**
> The gated lifecycle below (`Assigned -> In Progress -> Submitted -> Approved`/`Needs Revision`)
> is gone. Six free-set statuses replace it — `backlog`, `todo`, `in_progress`, `in_review`,
> `blocked`, `done` — and **any registered roster member may set any status on any task in their
> own cohort**, with no legal-transition check and no role gate (`/edit` stays the one
> exception, per §2). `in_review` and `done` are the direct descendants of `Submitted` and
> `Approved` — the review queue (`/pending`), the submission/status-change notifications, and the
> weekly digest all survive by retargeting onto these two statuses, not by deletion.
>
> Four regressions were accepted knowingly, in exchange for matching the tool the cohort's
> higher-ups already use daily (**Devie**):
> - **`Cancelled` is gone.** There is no way to mark a task abandoned; the nearest "parked"
>   meaning is `/update <ref> backlog`.
> - **`NeedsRevision` is gone.** Sending work back is `/update <ref> todo` plus a `/note`. "Came
>   back from review" is no longer distinguishable from "not started."
> - **The Approved edit-lock is gone.** A `done` task is editable and reopenable via `/edit` or
>   `/update <ref> <status>` at any time.
> - **Self-approval is possible by design.** Any roster member — including the assignee — can
>   set their own task to `done`. "Done" is a claim, not a verified fact.
>
> **Blocked becomes a status, not a flag.** `/blocked <ref> <reason>` (§5) now transitions a task
> into the `blocked` status rather than setting an orthogonal boolean, and stashes the prior
> status in `previous_status` so `/unblock <ref>` (replacing `/unblocked`) has a defined restore
> target. Overdue stays a derived flag, unchanged — see the "Overdue visibility" note below,
> which is otherwise unaffected by this ADR.
>
> The rest of this section — the original lifecycle diagram and per-status notes — is kept below
> as the historical record of v1's design.

```
Assigned -> In Progress -> Submitted -> Approved
                                      -> Needs Revision -> (back to In Progress)
```

- **Assigned**: created by a higher-up via the assignment wizard.
- **In Progress**: auto-set the first time the intern views this specific task via
  `/task <task_id>` — a clear, meaningful signal (they've actually looked at it), unlike
  inferring it from a general `/mytasks` list scan.
- **Submitted**: intern runs `/submit <task_id>`. No proof/attachment required — status change
  only. No intern-facing "unsubmit": considered and deliberately deferred — at cohort scale, an
  accidental submission is more easily fixed by messaging the reviewing higher-up directly than
  by building a dedicated undo command, and `Needs Revision` already covers the "send it back"
  case once a higher-up looks at it. Still editable by a higher-up while in this state (see
  `/edit` lock rule below).
- **Approved / Needs Revision**: higher-up decision. Needs Revision loops back to In Progress.
  Once **Approved**, a task is locked from `/edit` — this preserves an honest record of what was
  actually completed and approved, rather than allowing it to be rewritten after the fact.
  `/edit` remains available at every earlier stage (Assigned, In Progress, Submitted).
- **Cancelled**: a higher-up can cancel a task at any point before Approved (see §5,
  `/canceltask <task_id>`), for mistaken assignments or work that's no longer needed. Cancelled
  tasks are excluded from `/mytasks`, `/pending`, and stats, but kept in the database rather
  than deleted (for history/audit) and remain visible via `/alltasks` and `/task <task_id>`.

**Status-transition validation**: every command that changes a task's status (`/submit`,
`/approve`, `/revise`, `/canceltask`) checks the task's current status first and gives a clear,
specific explanation if the action doesn't apply — e.g. "Task 5 is still Assigned, not yet
submitted for review" or "Task 5 was already approved by @Maria" — rather than silently
succeeding into a wrong state or failing with a generic error. This also means two higher-ups
acting on the same task around the same time (§12, concurrency) fail gracefully for whoever
acts second, instead of confusingly double-processing it.

**Overdue visibility**: this is a status *flag*, not a separate lifecycle state — any task past
its due date and not yet Approved/Cancelled is shown as overdue (e.g. highlighted/marked) in
`/mytasks`, `/pending`, and the dashboard. **This is also what "backlog" means in this system**
— a term the cohort uses for past-due work — so `/backlog` (§5) is simply a filtered view onto
this same flag, not a separate concept.

**Blocked visibility**: also a flag, not a status (§3) — set by an intern via `/blocked
<task_id> <reason>` when they're stuck and need help, and cleared via `/unblocked <task_id>`
once resolved. Unlike overdue, this is intern-initiated and time-sensitive, so it triggers an
immediate notification to the assigning higher-up (§8) rather than waiting for passive
visibility to be noticed. Shown alongside the overdue flag wherever tasks are listed.

## 5. Telegram Bot — Commands

> **Superseded by [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md), implemented.**
> Full current command grammar is documented in `USER_GUIDE.md` and reconciled with `/help`'s
> output (`src/bot/format.ts`); this note is a summary, not the source of truth. The commands
> below are removed outright, with no alias — a caller typing one gets a one-line redirect to
> the replacement, not a generic "unknown command" fallback: `/submit` → `/done`, `/approve` →
> `/complete`, `/revise` → `/update <ref> todo`, `/canceltask` → `/update <ref> backlog`,
> `/unblocked` → `/unblock`, `/alltasks` → `/tasks`, `/backlog` → `/overdue` (the word "backlog"
> now names a status, so the old meaning of "overdue work" needed a different command name).
> `/assign`'s fixed four-step wizard is replaced by **`/addtask <title> [by <date>]
> [@username]`**, a one-line create command open to any roster member (not interns-only) with
> the wizard retained as the fallback when `/addtask` is sent bare. `/edit` gains a direct
> `/edit <ref> <field> <value>` form alongside its existing wizard, and is the one command still
> restricted to `HigherUp` (§2). `/update <ref> <status>` is new: a generic status setter,
> replacing `/submit`/`/approve`/`/revise`/`/canceltask`'s individual gated transitions, open to
> anyone and accepting a comma- or newline-separated batch of refs for a bulk update. `/done` and
> `/complete` are fixed-status shortcuts onto the same mechanism — `/done` sets `in_review`,
> `/complete` sets `done`, a deliberate wart copied from Devie rather than fixed (`/update <ref>
> done` sets `done`, so the word "done" means different things as a command name versus an
> argument). A new `@`-mention trigger (`@<bot> pls work on ...`) reuses `/addtask`'s exact
> grammar so a task can be created straight out of ordinary group chatter. The
> Approve/Revise/Mark-unblocked inline buttons are removed along with the review gate they
> encoded; only the due-date-confirmation Yes/No buttons and `/edit`'s field-choice menu buttons
> remain. The rest of this section is kept below as the historical record of v1's design.

Slash commands for everything except confirmations and binary decisions, which use inline
buttons (§6) — cheap to add since they're just an attachment on a message the bot already
sends, not a separate app. No Mini App in v1 (see §11, deferred) — that remains the bigger,
separate-frontend investment.

**Everyone**
- `/start` — required once per user so the bot is allowed to DM them (Telegram platform
  requirement). Also completes registration: the bot matches the caller's Telegram username
  against the roster (§2, §7) to link their Telegram ID to their known identity/role. If the
  username isn't on the roster, the bot replies with a clear "you're not on the roster yet —
  contact a higher-up" message rather than silently failing.
- `/help` — lists the commands available to the caller, scoped to their role. Since v1 is
  commands-only with no buttons, this is the primary way people discover what the bot can do,
  so it needs to exist from day one rather than relying on word-of-mouth.
- `/cancel` — aborts whatever multi-step wizard (assignment or edit) the caller currently has
  in progress, so nobody gets stuck mid-flow or has to fumble through with garbage input to
  escape it.
- `/alltasks` — read-only view of every task across the whole cohort, **grouped by assignee**
  (not a flat list) with status, flagging any that are overdue — this is the "tasks per member"
  view. Available to interns (team-wide transparency) as well as higher-ups, distinct from
  `/mytasks` which is scoped to the caller's own work.
- `/task <task_id>` — full detail view of a single task: description, assignee, assigned-by,
  due date, current status, and the complete notes history. Fills the gap that list views
  (`/mytasks`, `/alltasks`, `/pending`) don't cover — this is where an intern re-reads feedback
  left via `/note`, and where anyone reviews full context before acting on a task. Available to
  the assigned intern and any higher-up (consistent with the any-higher-up-any-task rule, §2).
- `/backlog` — filtered view of overdue ("backlog," in cohort terminology) tasks, flagged with
  how many days overdue. For an intern, their own overdue tasks; for a higher-up, overdue
  tasks across the whole cohort.

**Interns**
- `/mytasks` — list my **open** tasks (Assigned/In Progress/Submitted/Needs Revision) with
  status and due dates, flagging any that are overdue. Deliberately scoped to "what do I need
  to do," not a full history — Approved/Cancelled tasks aren't lost, they're just kept out of
  this view; see them via `/alltasks` or `/task <task_id>`.
- `/submit <task_id>` — mark a task Submitted (only if it's assigned to the caller).
- `/blocked <task_id> <reason>` — flag one of my tasks as blocked, with a reason, and
  immediately notify the assigning higher-up (§8). Available to any higher-up too, for flagging
  on an intern's behalf if raised outside the bot.
- `/unblocked <task_id>` — clear the blocked flag once resolved.

**Higher-ups** (any of the following can be used on *any* task, not just ones the caller
personally assigned — see the ownership note in §2)
- Assignment wizard (triggered by a command, e.g. `/assign`) — step-by-step prompts: who? →
  title? → description? → due date? Chosen over a single-line command to reduce malformed
  input, given there are no inline buttons to guide the flow. Abortable via `/cancel`. The
  "who?" step only accepts interns as valid assignees (§2, §3).

  **Due date input** (applies to both the assignment wizard and `/edit`): entered as natural
  language (e.g. "next Friday", "in 3 days", "Sept 5"), parsed with a natural-language date
  library (e.g. `chrono-node`) rather than requiring a strict format. Because natural language
  is inherently ambiguous (e.g. "Friday" could mean this week or next), the wizard **echoes
  back the parsed date with Yes/No inline buttons** before saving (e.g. "That's Friday, Sept 5,
  2026" with tappable Yes/No) rather than silently trusting the parse. Relative dates ("in 3
  days") resolve against Asia/Manila time (§8, §12).
- `/pending` — list all tasks in Submitted status awaiting review (a review queue, across all
  interns, not just ones the caller assigned), flagging any that are overdue.
- `/note <task_id> <text>` — attach a feedback note to a task without forcing a full
  Needs-Revision cycle. Sends the intern an immediate DM notification (§8) so quick feedback
  doesn't sit unseen.
- `/edit <task_id>` — change a task's assignee/title/description/due date via the same
  wizard pattern. Abortable via `/cancel`. Locked once a task is Approved (§4).
- `/canceltask <task_id>` — cancel a task outright (mistaken assignment, no longer needed).
  Deliberately a distinct name from the bare `/cancel` wizard-abort command (§6) — reusing the
  same name for "abort my form" and "destroy this task" was a real confusion/mistake risk given
  one is harmless and the other isn't, so they're kept unambiguous.
- `/approve <task_id>` / `/revise <task_id>` — mark a Submitted task Approved, or send it back
  as Needs Revision ("revise," not "reject," matching the softer language used elsewhere). Also
  reachable via Approve/Revise inline buttons attached directly to the submission notification
  (§8) — the higher-up can act in one tap without typing either command.
- `/dashboard` — DMs back the dashboard URL, so it's always easy to find again without having
  to remember or search for it.

## 6. UX & Interaction Conventions

v1 is slash-commands for everything except confirmations and binary decisions, which use
inline buttons — a deliberately targeted upgrade (§5), not a Mini App. These small interaction
details carry a lot of the actual "is this easy to use" experience — they're called out
explicitly rather than left to whatever falls out of implementation.

- **Task IDs are simple sequential integers** (Task 1, 2, 3...), scoped per cohort — not UUIDs.
  Short and easy to type/remember/say out loud in a chat command like `/task 12` (or, per
  ADR-0009, `/done 12`).
- **Actionable notifications**: every notification states the concrete next step, not just the
  fact — e.g. an assignment notification includes "Send `/task 12` for full details, `/done
  12` when done," not just "You've been assigned a task." ("Send," not "Reply" — this isn't
  Telegram's reply-to-message feature, just the next command to type.)
- **Friendly empty and error states**: `/mytasks` with nothing pending says something like "You
  have no tasks right now" rather than a blank list; an invalid or inapplicable task ID gets a
  specific message ("Task 47 doesn't exist" / "Task 47 isn't assigned to you") rather than a
  generic failure.
- **Unknown command fallback**: an unrecognized command (e.g. a typo like `/mytask`) gets "Not
  sure what you mean — try `/help`" instead of silence.
- **Forgiving input**: command parsing trims stray whitespace and is case-insensitive.
- **One-tap onboarding link**: instead of instructing people to manually find the bot, they're
  given a direct `t.me/<BotUsername>` link that opens the chat with `/start` ready to send.
- **Mid-wizard command interruption**: if someone sends a recognized command while a wizard
  (assignment or edit) is in progress, the bot treats it as an implicit "never mind" — it
  auto-cancels the wizard and runs the new command, rather than swallowing it as wizard input
  or rejecting it until an explicit `/cancel`. This matches what people actually expect: typing
  a command is clearly intentional.
- **Wizard auto-expiry**: an abandoned wizard (assignment or edit) auto-expires after ~20
  minutes of inactivity, with a gentle message ("that assignment timed out, run `/assign` again
  when ready") rather than lingering indefinitely and risking a stale step being misinterpreted
  later.
- **Confirm before destructive action** *(superseded — [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md), implemented)*:
  `/canceltask` is gone, so this confirmation no longer exists. There is no destructive
  "cancel a task" action left in v2's command set — see §4's accepted losses.
- **Buttons scope** *(superseded — [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md), implemented)*:
  the Approve/Revise decision and the Mark-unblocked button are both gone along with the review
  gate they encoded. Inline buttons now exist only for the due-date-confirmation Yes/No prompt
  and `/edit`'s field-choice menu — never for browsing or listing, unchanged.

**Group chat command support (revised from initial DM-only design)**: commands, including the
assignment/edit wizards, work directly inside the cohort's group chat, not just in DM — a
deliberate reversal decided after initial testing. This requires the bot's Telegram privacy mode
to be turned **off** (via `@BotFather` → `/setprivacy` → Disable), so the bot receives every
message in the group, not just ones starting with `/`, since a wizard's follow-up questions
(title, description, due date) are plain text. Consequence: task descriptions, notes, and full
task detail are now posted publicly into the group chat whenever a command is run there — this
is an explicit accepted tradeoff, not an oversight (see §8, §12 for the permission and privacy
implications this reverses). The bot ignores ordinary group conversation that isn't a command or
an active wizard reply — it doesn't reply to every message it now technically receives.

## 7. Identity & Registration

> **Superseded by [ADR-0010](./docs/adr/0010-group-gated-registration-and-roster-management.md),
> planning only.** Step 1 below — *"You collect each person's Telegram username upfront ... and
> put them in the roster config"* — is superseded: there is no upfront collection step anymore.
> `/start` verifies the caller is a member of the cohort's Telegram group, then lets them declare
> Intern or Higher-up and writes the roster row itself; a stranger who isn't in the group cannot
> register. Steps 2 and 3 below no longer describe the mechanism accurately either, since there is
> no roster config to match against or add a line to — see the ADR for the replacement design.
> The rest of this section is kept below as the historical record of that earlier design.

Originally designed around passively listening to the group chat to auto-capture identities.
Reconsidered: since role assignment already requires a maintained config list of known people
(§2), and Telegram requires everyone to DM the bot once regardless (a bot can never initiate a
DM to someone who hasn't messaged it first — a hard platform limit), passive group-chat
listening added real build complexity (privacy mode, message-watching, throwaway-group testing)
without a proportional benefit for a small, known, fixed cohort. Simplified to:

1. You collect each person's Telegram username upfront (one message to the cohort) and put them
   in the roster config (§2) — username mapped to role (Intern or Higher-up).
2. Each person DMs the bot and runs `/start` once. The bot matches their username against the
   roster to link their Telegram user ID to their known identity/role, and this is what unlocks
   the bot's ability to DM them notifications going forward.
3. Adding someone mid-cohort (e.g. a late-joining intern) is a one-line roster addition, not a
   code change.

This removes the need for the bot to be a member of the group chat at all, removes privacy-mode
configuration, and removes the throwaway-test-group rollout step — there's nothing left to test
that isn't just "does `/start` work," which is trivial to verify directly. The intern group chat
remains the organization's normal communication channel; it's simply no longer part of how this
system resolves identity.

## 8. Notifications (proactive, via DM)

> **Partly superseded by [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md),
> implemented.** "On submission" and "on approve/needs-revision decision" below collapse into
> one generic trigger: **on any status change** (`/update`, `/done`, `/complete`, or a bulk
> update), both the assignee and whoever originally assigned the task get a DM naming the new
> status — except whoever made the change, who obviously already knows. A bulk update collapses
> this to **one summary DM per recipient**, not one per task, even when many of a single
> recipient's tasks changed in the same command. "On assignment" and "on `/note` added" are
> unaffected. Due-date reminders, overdue crossing, the daily standup, and the weekly digest
> (below) are all unaffected — see CONTEXT.md's note that the digest's counts-only guarantee in
> particular was never in scope for this ADR.

- On assignment → notify the intern.
- On submission → notify the higher-up who assigned that task (not all higher-ups).
- On approve/needs-revision decision → notify the intern.
- On `/note` added → notify the intern immediately, so feedback isn't silent until they
  happen to check the task.
- Due-date reminder → ~1 day before due date.
- **Overdue crossing** → a single one-time notification the moment a task crosses its due date
  without being Submitted/Approved, sent to both the intern and the assigning higher-up. This
  is distinct from nagging: it fires exactly once per task, not repeatedly.
- On `/blocked` → notify the assigning higher-up immediately (this is time-sensitive, unlike
  most other flags — see §4).
- **Weekly digest** (Mondays) → interns get a summary of their open tasks; higher-ups get a
  summary of tasks pending their review, plus what was Approved in the past week. Suppressed
  entirely for anyone with nothing to report — an empty "you have no tasks" digest every week
  is noise, not help.

### Daily standup (10am)

Two parts, sent at the same time, both reusing the same underlying task data — not a new
data-collection feature, just a daily-cadence aggregation of what's already tracked:

1. **Individual DM digest** — each intern gets their own open tasks (same shape as the weekly
   digest, daily instead); each higher-up gets a summary of what's pending review, blocked, or
   overdue across the cohort. Suppressed for anyone with nothing to report, same as the weekly
   digest.
2. **Group chat summary** — a single message posted to the cohort's group chat: aggregate
   counts (e.g. "5 on track, 2 overdue, 1 blocked") plus one line per intern (name + short
   status). Deliberately **counts/status-level only** — no task descriptions, no feedback notes
   — to give the cohort shared visibility and a natural daily rhythm without turning into a
   public callout of who's behind. This still deliberately stays counts-only even though the bot
   now has full read access to the group chat for command support (§6) — the group summary's
   restraint was about avoiding a public callout, not a technical read-access limitation, so that
   reasoning still applies unchanged.

No standup response-collection in v1 (i.e. no "what did you do yesterday" prompt-and-reply
flow) — this is a genuinely separate feature from the automated digest above; revisit as a v2
if the daily digest alone doesn't feel like enough.

No overdue-nagging *loop* in v1 (i.e. no repeated reminders) — the due-date reminder, the
one-time overdue-crossing notification, passive overdue flags on every list command (§4), and
now the daily standup digest together cover awareness without pestering anyone.

All scheduled notifications (due-date reminders, daily standup, weekly digest) run on
**Asia/Manila time**, since that's where the whole cohort is based — due dates are interpreted
in this timezone too.

## 9. Website Dashboard

- **Audience**: higher-ups only. Interns interact exclusively through Telegram.
- **Auth**: Telegram Login Widget (official, free) — no separate password system.
- **Features**:
  - Full task list/oversight across all interns and statuses, filterable/groupable by intern
    ("tasks per member") and by status (done / to-be-reviewed / blocked / overdue-backlog).
  - Task creation and editing (mirrors bot capabilities, nicer for bulk/complex edits).
  - Stats view: tasks completed per intern, completion rate, average time-to-submit, and tasks
    completed this week — derived from existing task data, no extra tracking needed.

## 10. Reusability

Built so a future cohort can reuse the system by swapping config (e.g. group chat ID), not by
code changes. Cohort 5 is the first deployment, not a one-off hardcoded build.

**Data lifecycle across cohorts**: every task is tagged with a cohort identifier. When a new
cohort's config is activated, `/tasks` (formerly `/alltasks`), `/mytasks`, `/pending`, and the dashboard default to
showing **only the current cohort's data** — this keeps the current cohort's view clean and
uncluttered rather than mixing in a prior cohort's history. Past cohort data is not deleted,
just not surfaced by default, so it remains available directly in the database if ever needed.

## 11. Out of Scope for v1 (Deferred to v2)

- **Telegram Mini App** — richer embedded web UI inside Telegram. Deferred because it requires
  a separate frontend, Telegram `initData` auth, and more build time than the Thursday deadline
  allows. The backend/data model is designed so this can be layered on later without a rewrite.
- File/proof-of-work attachments on submission.
- CSV export of task history (e.g. for an end-of-cohort report to leadership).
- Recurring/template tasks.
- Overdue escalation nagging.
- Standup response-collection (prompt-and-reply "what did you do yesterday" flow) — v1 has an
  automated daily digest only (§8), not conversational check-ins.
- Ranked hierarchy among higher-ups / peer-to-peer task assignment.
- Multi-tenant support for organizations other than DevCon PH.

## 12. Technical Constraints

- **Hosting**: free-tier only. No budget for paid infrastructure. This was left as an open menu
  ("e.g. Railway/Render, Neon/Supabase") rather than a decision, and the codebase went on to
  answer it implicitly by picking a file-backed synchronous SQLite driver, long polling, and an
  in-process cron — which together require an always-on host with a persistent disk. **Now
  decided**: Vercel + Supabase, matching DevCon's Cohort 4 operations dashboard. See
  [ADR-0001](./docs/adr/0001-replatform-to-vercel-supabase.md). Free-tier caveat to plan around:
  a Supabase project with no database requests for 7 consecutive days is paused automatically.
- **Scale**: ~8 interns, small number of higher-ups. No performance/scaling concerns at this
  size.
- **Platform limits acknowledged**: no bot-initiated DMs without a prior `/start` — this is why
  registration requires that one-time step (§7) regardless of how identity is otherwise known.
- **Group chat access**: the bot needs membership in the cohort's group chat, both to post the
  daily standup summary (§8) and to receive commands/wizard input typed directly in the group
  (§6). This requires the bot's Telegram **privacy mode disabled** (`@BotFather` →
  `/setprivacy` → Disable) so it receives every group message, not just slash commands — a
  reversal of the original send-only, no-read-access plan, made deliberately after initial
  testing surfaced that commands needed to work in-group, not just via DM.
- **Timezone**: all scheduling and due-date logic uses Asia/Manila.
- **Date parsing**: due dates are entered as natural language and parsed with a
  natural-language date library (e.g. `chrono-node`), with the parsed result always echoed back
  for user confirmation before saving (§5), to offset the ambiguity risk of free-text dates.
- **Concurrency**: last-write-wins for concurrent edits to the same task. No conflict
  resolution UI — acceptable given only a handful of higher-ups editing occasionally.
- **Dashboard/bot parity**: the dashboard enforces the exact same rules as the bot — it is not a
  separate rule set, just a different interface onto the same backend. *(Superseded parenthetical
  — [ADR-0009](./docs/adr/0009-devie-parity-command-redesign.md): the "any higher-up can act on
  any task, assignees must be interns, edit locked after Approved" example list described v1's
  gated rules; current-cohort-only-by-default is the only part of that example still accurate.
  See §2/§4 for what replaced it. This parity principle is scheduled to reach the dashboard in
  Phase 6.3, [#17](https://github.com/kxnn02/telegram-taskbot/issues/17), which is blocked on
  this ADR shipping first.)*

## 13. Open Items to Resolve During Implementation

- Exact command name for the assignment wizard trigger (e.g. `/assign`).
