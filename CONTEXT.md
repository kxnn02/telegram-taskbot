# Context

Why this project is built the way it is. See `PRD.md` for the full product spec; this file
covers technical decisions and the reasoning behind them, for anyone (human or agent) picking
up the codebase later.

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

**Known limitation**: sessions are stored in an in-memory `Map` in the one running dashboard
process (`src/web/sessionStore.ts`), not externally. This is fine for a single always-on process
but is incompatible with a serverless deploy target (stateless per-request instances don't share
memory) — moving to serverless would require swapping this for an external store (Redis/KV)
first. Also: the session cookie is marked `Secure`, so it only persists over real HTTPS, not
plain `http://localhost` — see the README's local-testing section for the tunnel workaround.

### Scheduling: node-cron in-process, not an external job system

Due-date reminders, overdue-crossing checks, and the daily/weekly digests run as `node-cron` jobs
inside the same long-lived bot process, all resolved against Asia/Manila time. For an ~8-person
cohort, an external job queue or scheduler service would be pure infrastructure overhead — a
single in-process scheduler is simpler to reason about and sufficient at this scale. This does
mean the bot process needs to actually stay running for reminders/digests to fire; see the
README's deploy notes once the project moves off local `npm run dev`.

## Out of scope (deferred to v2)

Mini App UI, file attachments, CSV export, recurring tasks, and standup response-collection were
deliberately deferred — see `PRD.md` for the reasoning (timeline pressure ahead of the cohort's
"before Thursday" target).
