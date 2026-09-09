# Context

How this codebase is shaped and why — for whoever picks it up next, human or agent.

This file describes **only the system as it stands today**. It is not a history: superseded
design notes live in [`docs/context-archive-v1.md`](./docs/context-archive-v1.md), the decisions
themselves in [`docs/adr/`](./docs/adr/) (with an index at
[`docs/adr/README.md`](./docs/adr/README.md)), and what shipped when in
[`CHANGELOG.md`](./CHANGELOG.md). For what the product is meant to do, read [`PRD.md`](./PRD.md).

## How it runs

Three entry points, one set of rules behind them:

```
Telegram ──webhook──> api/telegram/webhook.ts ─┐
                                               ├─> src/service/*Service.ts ──> src/storage/ ──> Supabase
Browser ───────────> app/ (Next.js) ───────────┤        (all business rules)      (one port per table)
                                               │
Supabase pg_cron ──> api/jobs/* ───────────────┘
```

Nothing is long-lived. Every request is a Vercel Function invocation, which is why scheduling
lives in the database (`pg_cron` calling HTTP endpoints) rather than in a process
([ADR-0007](./docs/adr/0007-scheduled-jobs-and-operational-tasks.md)).

Two deployments run at once, on two separate Telegram bots: `main` → production → the live Cohort
5 group, and the `dry-run` branch → its own bot → a dump group
([ADR-0011](./docs/adr/0011-post-cutover-dry-run-loop.md)). They share one Supabase project and
are kept apart **only** by `ACTIVE_COHORT_ID`. Operational steps:
[`docs/runbooks/dry-run-loop.md`](./docs/runbooks/dry-run-loop.md).

## Glossary

- **Caller** — who is making a request (username + cohortId), resolved from a Telegram user id.
  Every service method takes one as the actor. It no longer carries a role; there are none.
- **Roster** — who belongs to a cohort. A row is `(username, cohort_id)` and is created
  automatically the first time someone messages the bot. Nothing to seed, nothing to approve.
- **Registration** — the link between a Telegram user id and a roster username, needed before the
  bot can DM someone (Telegram won't let a bot open a DM first).
- **Cohort** — the tenancy boundary, and the only boundary there is. One deployment serves exactly
  one cohort.
- **Overdue** — a derived flag, not a status: an open (not `done`) task past its due date. See
  `src/domain/overdue.ts`. Notified exactly once, tracked in `overdue_notifications`.
- **Bucket** — the standup's grouping: **Overdue**, **Doing**, or **For approval**. Every open
  task falls in exactly one (`src/bot/standupBuckets.ts`).

## Decisions that still hold

### The service layer is the one seam

`src/service/taskService.ts` holds every business rule — validation, status changes, ownership —
and the `src/storage/*StorePort` implementations are the only things that touch the database. The
bot, the dashboard, and the scheduled jobs all call into the service layer; none of them query
storage directly and none re-implement a rule it owns.

This is the load-bearing convention of the codebase. When a dashboard page needs data that isn't
exposed yet, the fix is a new service method, never a query from `src/web/`.

### There is no access control — only cohort tenancy

[ADR-0013](./docs/adr/0013-remove-access-control-for-devie-parity.md) deleted roles and
permissions outright, to match Devie. Anyone who messages the bot is registered on first contact,
and any registered member can do anything to any task in their cohort. There is no approval gate,
no confirmation step, and no permission check left to maintain.

Cohort scoping survives because it is tenancy, not permission. Re-adding access control would be
a new proposal, not a bug fix.

### One cohort per deployment, bound by `ACTIVE_COHORT_ID`

`Roster.find(username)` without a cohort resolves ambiguously — the same Telegram account exists
under both the real and the dry-run cohort, and it would pick whichever row was inserted first.
Every live request path therefore passes `ACTIVE_COHORT_ID` explicitly
(`resolveCaller`, `/start`'s roster lookup, the dashboard's Telegram-login lookup).

The no-cohort overload still exists for tests and for callers that genuinely have no cohort in
hand yet, but **no production request path may reach it**. Regression coverage:
`callerResolution.test.ts`, and `createBot.test.ts`'s "Cohort binding" block, which drives two
bot instances sharing an ambiguous roster.

### Commands work in the group chat, and that leaks task detail on purpose

The original design was DM-only. It was reversed after early testing: every command works in the
cohort's group chat too. That requires Telegram's privacy mode **off** (`@BotFather` →
`/setprivacy` → Disable), so the bot receives every group message, not just ones starting with
`/`.

**Accepted tradeoff**: a command run in the group posts that task's title and notes publicly.
Anyone who wants privacy can DM the bot. Because the bot sees everything, the "not sure what you
mean" fallback fires only in DMs, and two narrower rules keep it quiet in groups: an unrecognized
slash command draws a reply only when it isn't addressed to another bot (`/cmd@other_bot`), and a
bare mention only when the mention *leads* the message (`thanks @bot !` stays silent).

### One home per piece of information

Settled by issue #143 after the cohort was told the same three overdue tasks three times every
morning. The rule:

> **Personal ("what do I have to do?") goes to a DM. Cohort-wide ("how are we doing?") goes to
> the group, once, in the morning standup card. No message carries both.**

What that produces, all Asia/Manila:

| When | Channel | Message |
|---|---|---|
| 8:05am daily | group | Standup card — everyone's open work, by person. Gated by `cohorts.standup_enabled` |
| 8:10am Mondays | DM | What *you* completed in the trailing 7 days |
| 9:00am daily | DM | Due-tomorrow reminder, assignee only |
| 10:00am daily | DM | Your own open tasks. Suppressed when you have none |
| 12:00pm daily | DM | Roster reconciliation, only when someone has left the group |
| hourly | DM | Overdue crossing, once per task, assignee + assigner |
| on status change | DM | Assignee + assigner, minus whoever made the change |

Two consequences worth stating plainly. The daily digest **no longer posts to the group at all**,
and the weekly digest deliberately omits your open tasks — it would repeat the same member's 10am
digest two hours later on the same Monday, which is the duplication this spec exists to remove.

This replaced an earlier "group digests are counts-only" privacy guarantee. That guarantee is
gone: the standup card names task titles per person. It was traded, knowingly, for the cohort
having one shared morning view — the reasoning it replaced is in the archive.

### The standup groups by person, not by status

Issue #165. Every open task is sorted into exactly one bucket, under a heading per member
(`src/bot/standupBuckets.ts`, shared by the scheduled HTML card and the plain-text `/standup`
reply). `done` and non-overdue `backlog` tasks appear only in the summary counts.

Two orderings, deliberately different: `bucketOf` **classifies** by overdue → for-approval →
doing, first match wins (so an overdue in-review task counts as overdue, not as awaiting
approval), while `STANDUP_BUCKET_ORDER` **renders** as Overdue, Doing, For approval.

⚠️ **This is a deliberate divergence from Devie**, which groups by status. `buildStandupOverviewCard`
otherwise carbon-copies Devie's layout, so a future parity pass must not "restore" the status-first
grouping this replaced. The dead status-first code was deleted (#169) rather than left to rot.

### The dashboard reuses Telegram as its login

Telegram's official Login Widget — a signed payload verified against the bot token
(`src/web/telegramAuth.ts`) — not a password system. The audience already has the one credential
that matters, and a second login for ~8 people would be pure overhead. Logging in now requires
only an existing roster row; there is no tier above that
([ADR-0013](./docs/adr/0013-remove-access-control-for-devie-parity.md)).

Sessions are a **signed, stateless cookie** (`src/web/sessionCookie.ts`), reusing the same
HMAC-plus-timing-safe-compare pattern with its own `SESSION_SECRET`. Username, cohort and expiry
live inside the cookie, so there is no session table and no server-side revocation — `/logout`
just clears it ([ADR-0008](./docs/adr/0008-dashboard-sessions-and-mutations.md)). The cookie is
`Secure`, which is why local login needs an HTTPS tunnel (see the README).

Mutations are REST-style API routes under `app/api/`, not Server Actions.

### Missing environment variables fail the build, not every request

On 2026-09-07 the bot returned 500 to every Telegram update for 17 hours: `GROQ_API_KEY` was
absent and the webhook's eager dependency wiring had no failure path. Two fixes
([ADR-0015](./docs/adr/0015-required-environment-variables-are-asserted-at-build-time.md)):
language features now fail on use rather than at construction, and
[`src/config/requiredEnv.ts`](./src/config/requiredEnv.ts) is a manifest the Vercel build asserts
(`npm run check:env`, wired into `vercel.json`'s build command).

That manifest is deliberately **not** derived from `.env.example`, which also documents
local-only, script-only and historical names. A variable earns a place in it only if a request
served by `api/**` or `app/**` fails without it.

### Migrations reach production before the code that needs them

CI fails a PR when `supabase/migrations/` holds a migration that has never been applied to
production ([ADR-0012](./docs/adr/0012-migrations-applied-before-merge.md), `npm run
check:migrations`). This is only safe because every migration in this project is additive — keep
it that way. Runbook: [`docs/runbooks/migrations.md`](./docs/runbooks/migrations.md).

## Traps — things that look wrong and must not be "fixed"

- **`/addtask` only reads a due date after an explicit `by`.** Handing the whole string to chrono
  looks smarter, but chrono happily matches ordinary words: `fix bug in march module`, `review the
  sept deck`, `call sat about the API`, `deploy to prod at 5` all got silently truncated into a
  mangled title with an invented due date — and the one-liner path has no confirmation step, so it
  landed unseen. Every ` by ` is a candidate split point, walked last-to-first, and accepted only
  when chrono consumes *all* the text after it. Do not simplify this back to a whole-string scan.
  See `src/bot/addTaskParse.ts` and its validated input/output table.
- **`/done` sets In review, not Done.** `/complete` and `/update <ref> done` set Done. The word
  means two different things depending on whether it's the command or the argument. Copied from
  Devie on purpose; documented as a warning in `USER_GUIDE.md` rather than fixed.
- **`sendStandupPush` ignores `standup_enabled` on purpose.** The on/off switch is checked in
  `handleStandupPushEndpoint`'s `POST` branch only, because the settings page's Test button reuses
  the same function and must work while the schedule is off.
- **The update-dedup key is global across bots, and that's accepted.** `processed_telegram_updates`
  dedups on Telegram's per-bot `update_id` while production and dry-run share one Supabase project,
  so a collision is possible in principle. Measured as distant and accepted (#164) rather than
  adding a discriminator column to the hottest code path.
- **A notification is only marked sent if it actually sent.** Overdue-crossing used to record a
  task as notified even when nobody could be DM'd, permanently losing the one-shot alert (#162);
  roster reconciliation used to spend its 24h throttle claim before sending, suppressing an
  undeliverable warning for a day (#163). Both now write the bookkeeping after a successful send.

## Data model notes

- **Statuses are a text column with a `CHECK`**, not a Postgres enum — cheaper to extend
  ([ADR-0006](./docs/adr/0006-database-schema-and-concurrency.md)). Same for `priority`
  (`low`/`medium`/`high`/`urgent`, default `medium`).
- **Concurrency is an optimistic `row_version` check** on `tasks`. Two concurrent writers to the
  same task get a clear failure; there's no conflict-resolution UI beyond that.
- **`tags` are cohort-scoped**, unlike Devie's global tags, because this bot is multi-cohort. With
  `task_tags` and `order_index` (the board's drag ordering) they are consumed only by the
  dashboard's kanban board.
- **`audit_logs` has exactly one writer** — `SettingsService.saveGroupChatId` — read by the
  activity page (keyset-paginated) and the settings page's own capped preview.
- **Every table has RLS enabled with zero policies.** The service-role key bypasses it; the
  policies' absence is the deny-by-default backstop, not an oversight.
- **`job_runs`** records the outcome of every scheduled job, added because a silent cron failure
  was otherwise invisible (#43, still open for the two Vercel Cron jobs).

## Testing conventions

- **`npm test` never touches the network.** In-memory store implementations back everything; the
  language parser runs against a fake `TextModel`.
- **Bot dispatch is tested through a real grammy `Bot`** (`createBot.test.ts`), driving
  `bot.handleUpdate()` on hand-built `Update` objects with the API transport intercepted. One
  gotcha: a synthetic `/command` message needs a `bot_command` entity, or grammy's command filter
  misses it and everything falls through to the fallback handler.
- **Contract tests run against the real Supabase project** (`npm run test:live`), each run using
  uniquely-prefixed throwaway cohort ids (`__contract_test_<runId>_<n>__`) deleted in `afterEach`.
  `ON DELETE CASCADE` from `cohorts` downward means one delete wipes everything the test wrote.
  Because `afterEach` doesn't run on a crashed process, `sweepStaleTestCohorts` deletes any such
  cohort older than an hour — once before the live suite in CI, and again on a daily schedule.
- **View logic is pure and separately tested.** `src/web/*View.ts` / `*Data.ts` take data and a
  `now`, and return what to render — no I/O, no `new Date()` inside.
- **Small parsers are their own modules with their own tests** — `addTaskParse`, `mentionParse`,
  `statusParse`, `taskRef`, `taskLookup`, `usernameSuggest`, `standupBuckets`. Assignee typo
  suggestions, for instance, use Levenshtein distance 1–2, cohort-scoped, and deliberately return
  nothing on a tie rather than guessing between two names.

## Out of scope

A Telegram Mini App, file attachments, CSV export, recurring tasks, overdue-escalation nagging,
and standup response-collection are all deliberately deferred — see `PRD.md` §11. The original
reasoning (timeline pressure before the cohort's launch) is in
[`docs/PRD-v1-original.md`](./docs/PRD-v1-original.md) §11.
