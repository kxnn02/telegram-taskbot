# Context

Why this project is built the way it is. See `PRD.md` for the full product spec; this file
covers technical decisions and the reasoning behind them, for anyone (human or agent) picking
up the codebase later.

> **In flux — read `docs/adr/` first.** v1 shipped feature-complete but was never deployed. The
> deployment decision has now been taken and it supersedes several decisions recorded below:
> the project is being re-platformed onto Vercel + Supabase
> ([ADR-0001](./docs/adr/0001-replatform-to-vercel-supabase.md),
> [ADR-0002](./docs/adr/0002-authorization-stays-in-taskservice.md),
> [ADR-0003](./docs/adr/0003-roster-moves-to-a-supabase-table.md),
> [ADR-0004](./docs/adr/0004-webhook-transport-and-dry-run-strategy.md) — webhook + dedup + dry
> run, [ADR-0005](./docs/adr/0005-storage-port-testing-and-cicd.md) — storage port, testing, CI/CD,
> [ADR-0006](./docs/adr/0006-database-schema-and-concurrency.md) — schema + concurrency,
> [ADR-0007](./docs/adr/0007-scheduled-jobs-and-operational-tasks.md) — jobs, keep-alive, backups,
> [ADR-0008](./docs/adr/0008-dashboard-sessions-and-mutations.md) — sessions + mutation style).
> Superseded sections are marked inline. **None of it is implemented yet** — the code described
> below is still the code that exists. The full spec and phased implementation plan are tracked as
> GitHub issues [#11](https://github.com/kxnn02/telegram-taskbot/issues/11)-[#17](https://github.com/kxnn02/telegram-taskbot/issues/17).

## Glossary

- **Caller** — the identity (username, role, cohortId) of whoever is making a request, resolved
  from a Telegram user id via registration. Used throughout `taskService.ts` as the actor for
  every business rule (permission checks, ownership).
- **Roster** — the list of who belongs to a cohort and in what role (`Intern` or `HigherUp`).
  Membership is roster-based, not inferred from who's present in the group chat — a fixed, known
  cohort made this simpler than passive membership tracking.
- **Registration** — the one-time link between a Telegram user id and a roster username, created
  by `/start`. A roster entry can exist before someone has registered; an unregistered roster
  member is told to `/start` first.
- **Overdue-crossing** — the moment a task's due date passes while it's still open (not
  Approved/Cancelled). Notified exactly once via `overdue_notifications` bookkeeping, not
  re-sent on every subsequent overdue check.
- **Counts-only** — the digest/group-summary convention of reporting numbers (e.g. "3 due today,
  1 overdue") without task titles, descriptions, or per-task detail. See the privacy decision
  below.

## Architectural decisions

### The service layer is the one seam

`src/service/taskService.ts` holds every business rule (permissions, status transitions,
validation) and is the only thing that talks to `src/db/*Repository.ts`. The bot layer
(`src/bot/`), the notification scheduler (`src/notifications/`), and the dashboard (`src/web/`)
all call into this service layer — none of them query the repositories directly, and none of
them re-implement a rule the service layer already owns. This was chosen so business logic has
exactly one place to change, and so the bot and dashboard can never drift into disagreeing about
what a given task's state means. When adding a dashboard read (issue #3) needed data not already
exposed, the fix was to add a method to `taskService.ts`, not to query the DB from `src/web/`.

### node:sqlite instead of better-sqlite3

> **Superseded by [ADR-0001](./docs/adr/0001-replatform-to-vercel-supabase.md).** SQLite is being
> replaced by Supabase Postgres. The reasoning below stands as the record of why v1 looks the way
> it does — and note what it missed: choosing a *file*-backed, *synchronous* driver silently
> decided the hosting question (a persistent disk, an always-on process) years before anyone asked
> it. That, not the driver, was the error.

The PRD didn't mandate a specific SQLite driver. `better-sqlite3` needs a native compile
toolchain that wasn't available in the build environment used for the initial implementation, so
`node:sqlite`'s built-in `DatabaseSync` is used instead. This is a real, deliberate substitution,
not an oversight — revisit only if a feature genuinely needs something `node:sqlite` lacks.

### Group chat command support (reversed mid-project)

The original PRD design was DM-only: all commands and wizards happened in a private chat with
the bot, and the group chat only ever received a bot-posted daily summary (deliberately
send-only, to avoid leaking task detail into a semi-public space). After early testing, the
design was reversed: commands (including the assign/edit wizards) now also work when typed
directly in the cohort's group chat, not just in DM.

This requires disabling Telegram's **privacy mode** for the bot (`@BotFather` → `/setprivacy` →
Disable) — without that, a bot in a group only receives messages that start with `/`, are a
reply to it, or `@`-mention it, which would silently break the wizards' free-text follow-up
steps in a group. With privacy mode off, the bot sees every message in the group, which is why
`createBot.ts`'s wizard fallback ("Not sure what you mean") only fires in DMs — firing it on
every plain-text group message would spam ordinary chatter.

**Accepted tradeoff**: task titles, descriptions, and notes now post publicly into the group
chat whenever a command is run there (e.g. `/task 3`, `/note 3 ...`). This was an explicit,
informed choice, not an oversight — interns/higher-ups can still use DM for anything they want
kept private, and the group chat's *proactive* daily/weekly digest still stays counts-only (see
below) since that restraint was never about read access.

### Digests stay counts-only even with full group read access

The daily/weekly group digest (`src/notifications/digestFormat.ts`) reports only per-intern
counts (on-track / overdue / blocked), never task titles or descriptions — even though the bot
can now read (and post detail into, via commands) the full group chat. The reasoning in the PRD
was about avoiding an involuntary public callout of what someone is behind on, which is a
different concern from read access; a command a person explicitly runs in the group is a choice
they made, but an automated daily post naming a struggling intern's actual task isn't. This is
enforced two ways, not just by convention: the digest's internal per-intern data type has no
field that could hold a task title (so leaking one is a type error, not just a style violation),
and there's a test asserting the rendered text can't contain one.

### Dashboard: Telegram Login Widget, not a custom auth system

The PRD specifies Telegram's official Login Widget (a signed-payload HMAC flow, verified against
the bot token) rather than a separate password system, since the target audience already has the
one credential that matters (their Telegram account) and a second login system would be pure
overhead for ~8 people. Authorization is layered on top: a successful Telegram login only grants
a dashboard session if that username is on the roster with role `HigherUp` — a valid Telegram
login from an intern, or from someone not on the roster at all, is rejected.

The Login Widget choice itself is **unaffected** by the re-platform — `telegramAuth.ts`'s HMAC
verification is pure and carries across, and it stays strictly better than the shared admin
password Cohort 4's dashboard uses, since it is per-person and roster-authorized.

> **Resolved by [ADR-0008](./docs/adr/0008-dashboard-sessions-and-mutations.md).** Sessions move
> from the in-memory `Map` below to a signed, stateless cookie reusing this same HMAC pattern —
> no session table needed. Dashboard mutations in the Next.js rewrite use REST-style API routes,
> not Server Actions; see ADR-0008 for why.

**Known limitation, now resolved (see above)**: sessions are stored in an in-memory `Map` in the
one running dashboard process (`src/web/sessionStore.ts`), not externally. This is fine for a
single always-on process but is incompatible with a serverless deploy target (stateless
per-request instances don't share memory). Also: the session cookie is marked `Secure`, so it
only persists over real HTTPS, not plain `http://localhost` — see the README's local-testing
section for the tunnel workaround.

### Scheduling: node-cron in-process, not an external job system

> **Superseded, implemented ([ADR-0001](./docs/adr/0001-replatform-to-vercel-supabase.md) /
> [ADR-0007](./docs/adr/0007-scheduled-jobs-and-operational-tasks.md), issue #15).** Scheduling
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

### Bot-layer dispatch tests: real grammy `Bot`, no network

`createBot.test.ts` drives the actual command/callback dispatch (not just pure formatting, like
`format.test.ts`) via `bot.handleUpdate()` on hand-built `Update` objects, against a real
`TaskService`/`node:sqlite`-memory/`Roster` stack. `createBot()` accepts optional `bot`/`roster`
injection for this: a `new Bot(token, { botInfo })` sidesteps the real `getMe` network call, and
`bot.api.config.use(transformer)` intercepts every outgoing API call instead of hitting Telegram.
One gotcha: synthetic `/command` messages need a `bot_command` entity (grammy's command filter
reads entities, not just leading `/` in the text) or every command silently misses and falls
through to the "not sure what you mean" fallback.

### `/blocked` overloads the existing command name (issue #6)

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

### `/alltasks` and `/mytasks` paginate via a page-number argument (issue #7)

Both list commands now cap a reply at 10 tasks per page (`PAGE_SIZE` in `src/bot/format.ts`),
with `/alltasks 2` / `/mytasks 2` requesting the next page. A command-argument page number was
chosen over inline Next/Previous buttons, unlike the Approve/Revise buttons or issue #5's
`/edit` field-choice menu: those buttons attach to a message meant for one specific person to act
on once, but `/alltasks` and `/mytasks` can be run by anyone in the group chat, their output is
plain broadcastable text, and a page number keeps each reply self-contained and re-requestable on
its own — no dependency on a particular message staying around and editable. This also matches
the ticket's steer toward the simpler option absent a clear reason for buttons.

Pagination is display-only: `TaskService.listAllTasks`/`listMyTasks` are unchanged and still
return the full cohort/role-scoped result set (so cohort-scoping and role-based filtering are
untouched), and only `format.ts` slices a page out of that list before rendering. `/alltasks`'s
existing per-assignee grouping is preserved by grouping only the tasks within the requested
page, not across the whole result set. A result set of 10 or fewer renders with no pagination
footer at all, unchanged from before this issue; a page argument that isn't a positive integer
(e.g. `/mytasks abc`) is rejected with a usage message, while a page number past the last page is
clamped to the last page rather than treated as an error, since that's a page that used to exist
and simply ran out.

### Assignee typo suggestion uses Levenshtein distance <=2, cohort-scoped (issue #8)

The `/assign` and `/edit` wizards' "who is this task for?" step already rejected an unknown
username outright; issue #8 asked for a "did you mean @y?" hint when the typed username is a
close typo of an actual intern, to cut down on wizard restarts. The matching itself is a small
pure function, `suggestClosestUsername` (`src/bot/usernameSuggest.ts`, backed by a plain
`levenshteinDistance` implementation), independently unit-tested with no roster/DB/bot
dependency — it just takes the typed text and a list of candidate usernames.

Threshold: a Levenshtein distance of **1–2** is treated as "close enough". Cohort usernames are
short (first names/handles), so a single dropped, added, swapped, or substituted character (or
two of those combined) covers the realistic typo shapes without the threshold growing wide
enough to start matching unrelated names in an ~8-person roster. Two more rules keep the
suggestion honest rather than a guess: an input matching a candidate exactly returns no
suggestion (nothing to suggest), and if two or more candidates tie for the closest distance, the
function returns `undefined` rather than picking one — the ticket explicitly required no
suggestion over an ambiguous one.

The wizard step handler in `createBot.ts` (the shared `awaiting_assignee` step used by both
`/assign` and `/edit`'s assignee-change field) builds the candidate list from
`roster.all()` filtered to `role === "Intern"` and the **caller's own** `cohortId` before calling
`suggestClosestUsername` — so a suggestion can only ever point at an intern in the caller's
current cohort, never a different cohort or a higher-up, matching the ticket's constraint. The
suggestion is appended to the existing rejection text ("did you mean @y?"); the wizard's control
flow is unchanged — it still just waits for the next message (a corrected username or
`/cancel`), same as before. There is no auto-accept: the caller must type the suggested username
themselves for it to take effect.

### "Mark unblocked" inline button reuses `clearBlocked` as-is, no new rule (issue #9)

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

### Contract-test isolation: unique cohorts + cascading delete, not transaction rollback (issue #13)

ADR-0005 proposed running each contract test inside a database transaction rolled back at the
end, so the shared Supabase project (also used for real cohort data and the future dry-run
cohort) sees zero permanent footprint from CI. That's not achievable as written: `SupabaseTaskStore`
talks to Postgres over PostgREST, and every `supabase-js` call is its own independent HTTP
request/connection — there's no way for a test's setup code to open a transaction on one
connection and have the adapter's own requests execute inside it, the way an in-process `pg`
client passed a single connection could.

What's actually implemented instead, in `supabaseTaskStore.live.test.ts`: each test run generates
a uniquely-prefixed pair of test cohort ids (`__contract_test_<runId>_<n>__`), inserts them into
`cohorts` in `beforeEach`, and deletes them in `afterEach`. A migration
(`20260831070000_cascade_deletes.sql`) added `ON DELETE CASCADE` from `cohorts` down through
`cohort_counters`/`tasks`/`notes`, so deleting the one cohort row wipes everything a test wrote
under it in a single delete, regardless of what that test did — the same "zero permanent
footprint on the shared project" property ADR-0005 was actually after, just achieved by scoped
deletion instead of literal rollback. Verified directly: after a full contract-suite run against
the real project, a follow-up query for `__contract_test*` cohorts returns nothing.

This also means the contract suite isn't testing genuine cross-invocation isolation (two contract
tests could in principle interleave against the *same* cohort if run concurrently) — it doesn't
need to, since each test gets cohort ids nobody else is using. Real concurrent-write safety
(the row_version check) is exercised directly, deliberately, by the "stale rowVersion" test.

**Residual gap, and the sweep that backstops it**: `afterEach`-based cleanup only runs on the
happy path — a crashed test process (or a killed CI job) skips it, leaving that one run's test
cohort (and everything cascaded under it) sitting in the shared project indefinitely. Since this
is the same shared project real cohort and dry-run data live in, that's a real gap, not a
theoretical one, even though any single leftover is small and clearly marked by the
`__contract_test_` prefix. `sweepStaleTestCohorts` (`src/storage/sweepStaleTestCohorts.ts`) closes
it: it finds any cohort matching that prefix older than an hour — far longer than the live suite
ever legitimately takes to run — and deletes it, cascading the same way `afterEach` does. It runs
as a step before the live suite in CI's `contract` job (catches yesterday's crash before today's
run adds more), and again on its own daily schedule (`.github/workflows/sweep-test-cohorts.yml`)
so cleanup doesn't depend on how often `main` gets pushed to.

### Caller resolution is bound to one cohort per deployment (Phase 3 review finding)

The dry-run cohort (ADR-0004) intentionally reuses the same real Telegram accounts as the real
cohort — `kxnn02`/`chiaia_0702` exist as roster entries under both `cohort-5` and
`cohort5-dryrun`. `Roster.find(username)` (no `cohortId` argument) resolves this ambiguity
deterministically but arbitrarily: whichever cohort's entry was inserted first. A code-review
pass on the Phase 3 webhook work caught that `resolveCaller` (`callerResolution.ts`) — used by
`/start` and every `withCaller`-wrapped bot command, in DM or group chat — called `roster.find`
with no cohort context at all. Since the seed script inserts the real cohort before the dry-run
cohort, every dry-run command from either test account would have silently resolved against the
real `cohort-5`, not the isolated `cohort5-dryrun` — exactly the cross-cohort contamination the
dry run's cohort-scoping was supposed to prevent, since `TaskService` scopes every read/write off
the resolved `caller.cohortId`. The same pattern existed in `dashboardServer.ts`'s Telegram-login
lookup.

Fixed by recognizing that every real deployment only ever serves one cohort — there's a Vercel
webhook function per branch (real vs. dry-run), and a dashboard process per deployment, never one
instance serving both. `createBot.ts` and `createDashboardServer` now take a required
`activeCohortId`, threaded from the existing (previously unused) `ACTIVE_COHORT_ID` env var, and
every live-request call site (`resolveCaller`, `/start`'s roster lookup, the dashboard's
Telegram-login lookup) passes it explicitly to `Roster.find(username, cohortId)` rather than
falling through to the ambiguous no-cohort-arg overload. That overload still exists — it's used
by call sites that genuinely don't have a resolved cohort in hand yet (none remain reachable from
a live request as of this fix; it's kept for the rare legitimate case and for tests) — but no
production request path is allowed to hit it. Regression coverage: `callerResolution.test.ts`
(unit-level), `dashboardServer.test.ts` (full HTTP-level login + read), and
`createBot.test.ts`'s "Cohort binding..." describe block (real `bot.handleUpdate` dispatch,
proving `/start` and a data-read command both stay scoped to the deployment's bound cohort even
when two separate bot instances share an identical ambiguous roster).

## Out of scope (deferred to v2)

Mini App UI, file attachments, CSV export, recurring tasks, and standup response-collection were
deliberately deferred — see `PRD.md` for the reasoning (timeline pressure ahead of the cohort's
"before Thursday" target).
