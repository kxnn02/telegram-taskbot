# ADR-0001: Re-platform to Vercel + Supabase

- **Status**: Accepted, implemented — live in production since 2026-09-02 (issue #17)
- **Date**: 2026-08-31
- **Supersedes**: the "node:sqlite instead of better-sqlite3", "Scheduling: node-cron in-process",
  and the deploy-related half of "Dashboard: Telegram Login Widget" decisions in `CONTEXT.md`

## Context

v1 was built and finished (issues #1–#9) without ever being deployed. When the deployment
question was finally worked through, the codebase turned out to have answered it implicitly,
by library choice, rather than explicitly:

- `node:sqlite` writes a **file**, so the app needs a persistent disk.
- `TaskService` is **synchronous** all the way down, so any network-backed store is a
  signature change across every call site.
- The bot uses **long polling** (`bot.start()`), so the process must stay alive.
- `node-cron` runs **four in-process jobs** (hourly overdue-crossing, 09:00 reminders, 10:00
  daily digest, Monday 10:00 weekly digest, all Asia/Manila), so the process must stay awake
  even when nobody is talking to it.
- Dashboard sessions live in an **in-memory `Map`**, so there can only be one instance.

Together these require a single always-on host with a persistent volume. Hosts that satisfy
that on a free tier in 2026 are essentially always-free VMs (Oracle Cloud, Google Cloud
`e2-micro`); the PaaS free tiers named in PRD §12 either sleep when idle (Render, Koyeb — fatal,
since this bot's traffic is *outbound* and nothing wakes it in time for a 10:00 digest) or no
longer exist (Fly.io, Railway).

The deciding input was **who inherits this**. DevCon's Cohort 4 operations dashboard
(`devie-devcon-jumpstart-cohort4-operations.vercel.app`) runs Next.js App Router on Vercel with
Supabase for Postgres, auth and Realtime, styled with Tailwind v4 + shadcn/ui. A Cohort 5 tool
living on a hand-maintained VM would be an outlier that nobody else in the organisation can
operate.

## Decision

Re-platform onto the same stack DevCon already runs.

| Concern | v1 | Target |
|---|---|---|
| Host | always-on process (undeployed) | **Vercel** |
| Storage | `node:sqlite` file | **Supabase Postgres**, accessed via `supabase-js` |
| Bot updates | long polling | **webhook** (Next.js route handler) |
| Scheduling | `node-cron`, in-process | **`pg_cron` + `pg_net`** in Supabase, calling authenticated endpoints |
| Dashboard | Express, server-rendered HTML | **Next.js App Router** |
| Roster | `roster.local.json` on disk | **Supabase table** (see ADR-0003) |
| Sessions | in-memory `Map` | to be decided during implementation |

### This is a re-platform, not a rewrite

A full rewrite was considered and rejected. Measured against the v1 tree: ~1,150 of 3,654 source
lines (32%) are stack-bound and were always going to be replaced — `src/db/`, the Express server,
the session store, cookie handling, cron wiring, entrypoints. The other ~2,500 lines (68%) are
stack-independent product knowledge: `src/domain/`, `taskService.ts`, `parseDueDate.ts`, every
grammy command handler, the wizard flow, `format.ts`, `usernameSuggest.ts`, the digest builders,
the Telegram login HMAC verification, and `taskView.ts`. Of 19 test files, 4 are tied to Express
or SQLite; the other 15 encode rules.

Those rules are the asset, and several were arrived at by reversing an earlier design after real
testing (see `CONTEXT.md`: group-chat command support, `/blocked` overloading, the Levenshtein
threshold and its tie-breaking, one-time overdue-crossing bookkeeping, counts-only digests
enforced at the type level, the wizard's implicit-cancel-on-command behaviour). A blank page does
not re-derive that list correctly.

So: a fresh, idiomatic Next.js skeleton, into which the domain, service, date, pure bot logic and
notification job bodies are transplanted along with their tests. The parts that were wrong get
rebuilt; the parts that encode what the product does come across.

## Consequences

**Accepted costs**

- `TaskService` and every call site become **async**. This is the largest and riskiest diff the
  project has had, and it touches the one seam `CONTEXT.md` says all business rules live behind.
- Every repository query is rewritten into the PostgREST idiom of `supabase-js`. The SQL does not
  survive; the semantics must be preserved by tests.
- The Express dashboard and its test suite are replaced by Next.js. `telegramAuth.ts` and
  `taskView.ts` are pure and transfer; `dashboardServer.ts`, `sessionStore.ts` and `cookies.ts`
  do not.
- **Supabase's free tier pauses any project with no database requests for 7 consecutive days** —
  Postgres stops, `pg_cron` halts, the bot goes dead until someone resumes it manually. During an
  active cohort the hourly job makes this unreachable; between cohorts it is a real risk. Mitigate
  with an external twice-weekly ping. Free tier also caps at 500 MB and 2 projects, neither of
  which binds at ~8 users.
- Vercel's Hobby plan is non-commercial-use only. An internship programme's internal tool is
  a defensible reading, but it is a term, not a guarantee.

**What this buys**

- No server to own, patch, or restart.
- The stack matches Cohort 4, so handover is to something the next maintainer recognises.
- The deferred dashboard visual-design pass folds into this work rather than following it.

## Alternatives rejected

- **Oracle Cloud always-free VM.** Zero code rewritten; ship in a week. Rejected on handover:
  it is an organisational outlier, and Oracle's ARM capacity is frequently unavailable anyway.
- **Cloudflare Workers + D1.** Genuinely viable — Workers' free Cron Triggers do 1-minute
  granularity (unlike Vercel Hobby's 2-jobs-once-daily cap, which cannot run the hourly
  overdue-crossing check), and D1 speaks SQLite SQL so the queries would have survived. Rejected
  because it costs the same async rewrite as Supabase while matching nothing else DevCon runs.
- **Vercel dashboard only, bot elsewhere.** Does not work: the two share one SQLite file, and
  splitting them forces the Postgres migration anyway while still leaving the always-on bot
  unhoused.
- **Full rewrite from a blank page.** Rejected — see above.
