# Archive: superseded design notes

These sections were removed from `CONTEXT.md` when it was trimmed to describe only the system as
it stands today. They are kept because they record *why the code once looked the way it did* —
reasoning that is not captured in any ADR — and because a future parity pass could otherwise
"restore" a design that was deliberately replaced.

**Nothing here describes current behaviour.** Every section below was superseded by a later
decision; the supersede banner at the top of each one says by which. For current behaviour see
[`CONTEXT.md`](../CONTEXT.md), [`PRD.md`](../PRD.md), and [`docs/adr/`](./adr/).

The wider v1 product spec is archived separately at [`PRD-v1-original.md`](./PRD-v1-original.md).

---

### node:sqlite instead of better-sqlite3

> **Superseded by [ADR-0001](./adr/0001-replatform-to-vercel-supabase.md).** SQLite is being
> replaced by Supabase Postgres. The reasoning below stands as the record of why v1 looks the way
> it does — and note what it missed: choosing a *file*-backed, *synchronous* driver silently
> decided the hosting question (a persistent disk, an always-on process) years before anyone asked
> it. That, not the driver, was the error.

The PRD didn't mandate a specific SQLite driver. `better-sqlite3` needs a native compile
toolchain that wasn't available in the build environment used for the initial implementation, so
`node:sqlite`'s built-in `DatabaseSync` is used instead. This is a real, deliberate substitution,
not an oversight — revisit only if a feature genuinely needs something `node:sqlite` lacks.

### Digests stay counts-only even with full group read access

> **Superseded by issue #143 / #144 (2026-09-08).** The group digest this section is about no
> longer exists: the daily digest is DM-only, and the one remaining proactive group post is the
> 8:05am standup card, which *does* name task titles per person. The privacy reasoning below did
> not survive intact — see `CONTEXT.md`'s "One home per piece of information" section for what
> replaced it, and note that the concern below (not automating a public callout of who is behind)
> was traded away deliberately, in exchange for the cohort having one shared morning view.
>
> The banner this section carried before that, kept for the record:
>
> > **Unaffected by [ADR-0009](./adr/0009-devie-parity-command-redesign.md).** This decision
> > survives the command/status redesign untouched — ADR-0009's own "Consequences" section says
> > so explicitly. Called out here, visibly, rather than left to be inferred from the absence of
> > a supersede banner.

The daily/weekly group digest (`src/notifications/digestFormat.ts`) reports only per-intern
counts (on-track / overdue / blocked), never task titles or descriptions — even though the bot
can now read (and post detail into, via commands) the full group chat. The reasoning in the PRD
was about avoiding an involuntary public callout of what someone is behind on, which is a
different concern from read access; a command a person explicitly runs in the group is a choice
they made, but an automated daily post naming a struggling intern's actual task isn't. This is
enforced two ways, not just by convention: the digest's internal per-intern data type has no
field that could hold a task title (so leaking one is a type error, not just a style violation),
and there's a test asserting the rendered text can't contain one.

### Scheduling: node-cron in-process, not an external job system

> **Superseded, implemented ([ADR-0001](./adr/0001-replatform-to-vercel-supabase.md) /
> [ADR-0007](./adr/0007-scheduled-jobs-and-operational-tasks.md), issue #15).** Scheduling
> now runs on Supabase `pg_cron` + `pg_net` calling the four `/api/jobs/*` notification-job
> endpoints (`src/jobs/notificationJobs.ts` wraps the same `runOverdueCrossingCheck`/
> `runDueSoonReminderCheck`/`runDailyDigest`/`runWeeklyDigest` bodies below, unchanged, scoped to
> one cohort per call), plus two pure-SQL `pg_cron` cleanup jobs (wizard-state, dedup-table) and
> two Vercel-Cron jobs (`keep-alive`, `weekly-backup`) that must survive a paused Supabase project.
> `startScheduler`/`node-cron` are gone entirely — see ADR-0007's "Implementation notes" for the
> judgment calls made along the way (single-cohort binding, the two-header-scheme split, the
> error-DM throttle window).

Due-date reminders, overdue-crossing checks, and the daily/weekly digests run as `node-cron` jobs
inside the same long-lived bot process, all resolved against Asia/Manila time. For an ~8-person
cohort, an external job queue or scheduler service would be pure infrastructure overhead — a
single in-process scheduler is simpler to reason about and sufficient at this scale. This does
mean the bot process needs to actually stay running for reminders/digests to fire; see the
README's deploy notes once the project moves off local `npm run dev`.

### /edit is single-field, /assign stays a fixed 4-step chain

> **Further superseded by [ADR-0013](./adr/0013-remove-access-control-for-devie-parity.md).**
> `/edit` and the wizard system described below (both the `/assign` and `/edit` chains, and the
> `awaiting_field_choice` menu) are deleted outright, not merely made a fallback — there is no
> "field-choice menu" or "bare command opens a form" path left at all. Kept below only as the
> record of what the wizard system looked like before it was removed.

> **Superseded by [ADR-0009](./adr/0009-devie-parity-command-redesign.md).** `/assign` is
> replaced by a one-line `/addtask`, and `/edit` gains a direct
> `/edit <ref> <field> <value>` form. Both wizards described below survive, but as the
> *fallback* taken when the command is sent bare — not as the primary path. The reasoning below
> stands as the record of why the four-step chain was chosen, and note what it missed: four
> required fields only forced a four-step chain because the description was mandatory, which
> ADR-0009 relaxes.

`/edit <id>` now opens with an inline-keyboard menu ("Which field?") instead of walking all four
fields with `"-"` to skip — issue #5. `WizardState.step` gained `awaiting_field_choice` as the
starting step for kind `"edit"` (kind `"assign"` still starts at `awaiting_assignee`); the field
tapped is recorded as `WizardData.editField` and drives which single shared step handler
(`awaiting_assignee`/`title`/`description`/`due_date`) runs before going straight to
`finishWizard`. The due-date field still routes through `awaiting_due_date_confirm` for both
wizards — that Yes/No step was never edit-only. This also fixed a pre-existing bug where
`WizardManager.start()` set kind `"edit"`'s initial step to `awaiting_title` while the command
handler actually prompted for assignee first — dead code (`WizardData.fieldsToCollect`, never
read anywhere) was removed rather than reconciled.

### `/blocked` overloads the existing command name (issue #6)

> **Further superseded by [ADR-0013](./adr/0013-remove-access-control-for-devie-parity.md).**
> There is no `/blocked` command at all any more, in either its list-view or set-flag form.
> Blocking a task is just `/update <ref> blocked`, same as setting any other status, optionally
> with a `note:<text>` rider; listing blocked tasks means reading `/tasks` or `/standup`'s
> "Backlog"/detail sections. Kept below as the record of the overload this replaced.

> **Partly superseded by [ADR-0009](./adr/0009-devie-parity-command-redesign.md).** The
> dual-purpose overload survives exactly as described below. What changes underneath it is that
> `blocked` becomes a *status* rather than an orthogonal boolean flag, so `/blocked <id> <reason>`
> now sets a status and stashes the prior one in `previous_status`. A second route to the same
> state also appears — `/update <ref> blocked` — which is why ADR-0009 makes the reason optional.

Issue #6 asked for a new read-only `/blocked` (no arguments) list command, mirroring
`/backlog`/`/pending`. But `/blocked <task_id> <reason>` already existed (PRD §5, intern-facing:
flags a task as blocked). Rather than invent a different name for the list view — which the
ticket didn't ask for and which would fragment the "blocked" vocabulary the cohort already uses —
`bot.command("blocked", ...)` in `createBot.ts` now dispatches on argument presence: no arguments
lists (delegates to `TaskService.listBlocked`); `<task_id> <reason>` still sets the flag via
`TaskService.setBlocked`, unchanged. Both are documented as one entry in `USER_GUIDE.md`'s intern
table with a note explaining the split, plus the plain list entry in the "Everyone can" table.

This also required widening `TaskService.listBlocked`, which previously rejected any non-
`HigherUp` caller outright (it only existed to feed the higher-up daily digest). It now follows
the same scope-by-role shape as `listBacklog`: cohort-wide for a higher-up, filtered to the
caller's own tasks for an intern — never rejected, matching the ticket's "intern sees only their
own blocked tasks" requirement. `formatBlocked` (already used by the weekly/daily digest) is
reused as-is for the command reply, unchanged, consistent with `/backlog`/`/pending` always
showing the assignee regardless of caller role.

### "Mark unblocked" inline button reuses `clearBlocked` as-is, no new rule (issue #9)

> **Superseded by [ADR-0009](./adr/0009-devie-parity-command-redesign.md).** The button is
> removed along with the Approve/Revise buttons it was modelled on — all three encoded the
> higher-up review gate that ADR-0009 deletes. `clearBlocked` itself survives, reached by
> `/unblock <ref>`, and now restores `previous_status` rather than clearing a boolean. The
> one-entry-point-per-rule principle below is unaffected and still worth keeping.

Issue #9 asked for a one-tap alternative to typing `/unblocked <task_id>` on the blocked-flag
notification a higher-up already receives (PRD §8). The button (`unblock:<id>` callback data,
attached via the same `InlineKeyboard` pattern as the Approve/Revise buttons) does not add any
new business logic: its handler in `createBot.ts` calls `TaskService.clearBlocked` — the exact
same method `/unblocked` already calls — so the two entry points can never disagree about what
clearing a blocked flag means or when it's allowed.

Permission gating mirrors the existing Approve/Revise callback precedent exactly: the callback
handler checks the resolved caller is a registered `HigherUp` before calling the service, the
same shape as the `decision:(approve|revise)` handler, even though `clearBlocked` itself also
permits the assignee intern to self-clear (used by the typed `/unblocked` command). This isn't a
gap — the button only ever reaches a higher-up in the first place, since it's attached to a
notification that's only ever sent to the assigning higher-up; an intern can still self-clear via
the typed command, unchanged.

**Race / already-unblocked edge case**: tapping the button after the flag was already cleared —
by the typed command, by someone else's tap, or on a different device — is not treated specially.
`clearBlocked` already returns a clear failure (`"Task N isn't currently marked blocked."`) when
called on a task that isn't blocked, and the callback handler edits the notification message to
show that error text in place, the same as any other failed decision (e.g. re-tapping
Approve/Revise on an already-decided task). No optimistic-locking or "someone already handled
this" special-casing was added — the existing status-check-first behavior the PRD already
requires for `/submit`/`/approve`/`/revise`/`/canceltask` (§4) covers this uniformly, and the
notification message simply reflects whatever the service says happened (or didn't).

### Wizard chat scoping stored as a `WizardData` field, not a `wizard_state` column (issue #52/#53, finding F3)

`WizardState` used to record no chat, so `bot.on("message:text")` looked up in-progress wizard
state by Telegram user id alone — any text that person sent in *any* chat was treated as the
next answer to their form. Starting `/addtask` in a DM, then sending an ordinary sentence in the
cohort group, made the bot answer in the group as though that sentence were the assignee.

The fix adds an optional `chatId` to `WizardData` (`src/bot/wizard.ts`) rather than a new column
on the `wizard_state` table: `SupabaseWizardStateStore` already maps the whole `WizardData` object
into that table's `data` jsonb column (ADR-0006), so a new field round-trips for free — no SQL
migration needed. `chatId` is set when a bare `/addtask` or bare `/edit` starts a wizard, and
checked everywhere wizard input is accepted: the free-text step handler, the mid-wizard command
auto-cancel, and the `editfield:`/`duedate:` callback handlers. A mismatched chat is treated as if
no wizard existed (free text) or answered with "That form was started in another chat." (a
callback) — the form itself is left untouched in its own chat. `chatId === undefined` matches any
chat, so wizard rows already in the database when this deploys keep working instead of becoming
permanently unusable.

Bare `/addtask` run directly in a group is unaffected: the wizard still runs publicly there and
still expects its next answer from that same group, per the existing group-chat-support decision.

### Roster registration moves from a config file to group-gated `/start` (ADR-0010)

> **Superseded in full by [ADR-0013](./adr/0013-remove-access-control-for-devie-parity.md).**
> Every mechanism described below — the group-membership check, the role-picking buttons,
> `/roster`, group-admin-gated roster edits, and the zero-higher-ups recovery path — is deleted.
> `/start` now just auto-registers the sender and says hello; there is no role to pick and no
> roster command left to administer one. Kept below as the record of the design ADR-0013 replaced.

Role assignment used to mean editing a gitignored roster file and re-seeding Supabase by hand —
nobody in the cohort could do it. As of ADR-0010 (implemented, spec #83, tickets #85-#91, merged
via PR #93, live in production since 2026-09-02), `/start` checks that the caller is a member of
the cohort's Telegram group, then lets them self-declare Intern or Higher-up and writes the
roster row itself; roster management (changing a role, removing a member) stays out of
self-declared reach by gating it on live Telegram group-admin status instead of the roster role,
via the `/roster` command. See the ADR for the full design, including why the Bot API can't
enumerate group members and why invite links and admin-derived roles were rejected.

**Bootstrap note**: the very first registrant(s) in a freshly cut-over cohort will have no
Higher-up yet, so the self-promotion guard that normally blocks re-declaring a role is inactive
until one exists — anyone can re-run `/start` and tap the other role button to correct
themselves. Once a cohort has at least one Higher-up, that recovery path closes for everyone with
an existing roster row, and role changes must go through `/roster role @user <role>` instead.

