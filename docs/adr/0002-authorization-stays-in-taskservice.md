# ADR-0002: Authorization stays in TaskService; RLS is a deny-by-default backstop

- **Status**: Accepted, implemented
- **Date**: 2026-08-31
- **Depends on**: [ADR-0001](./0001-replatform-to-vercel-supabase.md)

## Context

Moving to Supabase introduces Row Level Security, which did not exist as a concept under
`node:sqlite`. `supabase-js` reaches Postgres through PostgREST, and what a request may read or
write depends on which key it presents:

- the **`anon`** key is subject to RLS policies, so authorization is expressed as SQL;
- the **`service_role`** key bypasses RLS entirely.

`CONTEXT.md` is explicit that `src/service/taskService.ts` is *the one seam* — every permission
check, ownership rule, status transition and cohort scope lives there, and the bot, scheduler and
dashboard all call into it rather than re-implementing a rule it owns. Writing RLS policies that
mirror those rules would create a second authority on the same questions, in a second language.
The two would drift, and the drift would be invisible until it produced a wrong answer.

## Decision

**Authorization stays in `TaskService`.** The server uses the **`service_role`** key, and it is
used **server-side only** — never imported into a client component, never sent to a browser.

**RLS is nevertheless enabled on every table, with no policies written.** With RLS on and no
policy granting anything, the default is deny: an `anon`-key request reads nothing and writes
nothing.

## Consequences

- No authorization logic is duplicated. There remains exactly one place where "can this caller
  do this?" is answered, and it is the place `CONTEXT.md` already names.
- If the `service_role` key ever leaks into a client bundle — the realistic failure mode in a
  Next.js app, where one careless import crosses the server/client boundary — the tables are
  unreadable rather than wide open. "Never leak this key" stops being a rule someone has to
  remember and becomes a backstop that holds when they forget.
- The browser never talks to Supabase directly. Unlike Cohort 4's dashboard, which reads Postgres
  from the client and therefore genuinely needs policies, every read here goes through a server
  route that has already resolved a `Caller`.
- Cost: roughly ten lines of `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and the discipline of
  keeping the key server-side.

## Alternatives rejected

- **`anon` key + full RLS policies mirroring `TaskService`.** Defence in depth, but it maintains
  cohort-scoping and role-scoping twice and violates the one-seam principle the architecture
  rests on.
- **`service_role` with RLS left off.** Simplest, and no worse in the normal case — but a leaked
  key exposes everything, and there is no cheap reason to accept that.
