# ADR-0010: Group-gated registration and in-product roster management

- **Status**: Superseded by [ADR-0013](./0013-remove-access-control-for-devie-parity.md) — the
  maintainer decided the bot should be a carbon copy of DevieBot (#106), which registers anyone who
  messages it with no gate of any kind. Every mechanism this ADR designed (the group-membership
  check, the role-picking buttons, `/roster`, the group-admin-gated roster edits, the
  zero-higher-ups recovery path) was deleted. Kept here for the history of why it existed, not as a
  description of current behaviour.
- **Status (as accepted, historical)**: Accepted, implemented (spec #83, merged via PR #93, live in
  production since 2026-09-02)
- **Date**: 2026-09-02
- **Supersedes**: `PRD.md` §2's *"No self-registration surface: identity is resolved against a
  known roster (see §7)"* and §7's step 1, *"You collect each person's Telegram username upfront
  ... and put them in the roster config."*
- **Amends**: [ADR-0003](./0003-roster-moves-to-a-supabase-table.md) — the roster is still a
  Supabase table; it is no longer seeded from `roster.local.json`, and rows are now created by
  `/start` instead.
- **Tracked as**: [#83](https://github.com/kxnn02/telegram-taskbot/issues/83), tickets
  [#85](https://github.com/kxnn02/telegram-taskbot/issues/85)-[#91](https://github.com/kxnn02/telegram-taskbot/issues/91).

## Context

Role assignment today is the least usable part of the system: changing someone's role means
editing `roster.local.json` (gitignored, on one laptop) and running `npm run seed:roster` against
Supabase, or hand-editing a row in the Supabase table editor. Nobody in the cohort can do it, and
the person who needs it least of all — `/start` tells an unknown user *"You're not on the roster
yet — contact a higher-up to get added"* (`src/bot/createBot.ts:236`), and that higher-up has no
tool to do it with.

The design has to work within one hard platform limit: **the Telegram Bot API has no method that
lists a group's members.** `getChatAdministrators` returns admins only; `getChatMemberCount`
returns a number. Verified against https://core.telegram.org/bots/api. A roster can never be
pre-loaded by enumerating the group — the only per-user membership check available is
`getChatMember(chat_id, user_id)`, which needs a specific user id already in hand rather than a
list.

## Decision

**`/start` verifies that the caller is a member of the cohort's Telegram group, then asks them
Intern or Higher-up and writes the roster row itself.** The group is the trust boundary, so a
stranger who finds the bot cannot get in. `getChatMember` is used at registration time rather than
any enumeration, since it needs no member list — `ctx.from.id` is already in hand from the
message.

**The self-declared roster role gates only `/edit` and `/stats`. Roster management — changing a
role, removing a member — is gated on live Telegram group-admin status, never on the roster
role.** A self-declared higher-up therefore has no path to anything structural: they can act on
tasks as a higher-up, but they cannot grant themselves or anyone else that role, remove a member,
or otherwise touch the roster unless Telegram itself also considers them a group admin.

### Which `getChatMember` statuses count as membership

Present: `creator`, `administrator`, `member`, and `restricted` **only when `is_member === true`**.
Absent: `left`, `kicked`, and `restricted` when `is_member === false`.

### The fallback path is not "allow anyone"

When the group check cannot be performed — `cohorts.group_chat_id` is `NULL`, or the
`getChatMember` call throws — `/start` falls back to **exactly today's behaviour**: look the
username up in the roster, register if a row exists, and otherwise reply with today's dead end.
It must not create a roster row on this path. "Falls back" means falls back to the current dead
end, never "registers them anyway" — getting this wrong reintroduces the hole this ADR closes.

### Roster management authority is group-admin status, not the roster role

| Operation | Authority required |
| --- | --- |
| `/roster` (list) | roster role `HigherUp` |
| `/roster add @user` (as Intern) | roster role `HigherUp` |
| `/roster add @user higherup` | **live group-admin check** |
| `/roster role @user <role>` | **live group-admin check** |
| `/roster remove @user` | **live group-admin check** |

The live check is `getChatAdministrators(group_chat_id)`, comparing `ctx.from.id` against the
returned `user.id` values, accepting status `creator` or `administrator`. It **fails closed**: if
`group_chat_id` is `NULL` or the call throws, the operation is refused — the opposite of the
`/start` fallback above, and deliberately so. Refusing a roster edit is safe; permitting a wrong
one is not. A consequence accepted consciously: a cohort can contain a `HigherUp` who is not a
group admin and therefore cannot manage the roster.

### A cohort may never reach zero higher-ups

`TaskService` refuses any change that would leave a cohort with no `HigherUp` roster entry — both
demoting the last one and removing them. Enforced in the service layer so every surface (bot
command, future dashboard page) inherits it, per `CONTEXT.md`'s one-seam rule.

### Re-running `/start`

`/start` is idempotent and re-runnable today, and people re-run it routinely. Once it can set a
role, that is a standing self-promotion path unless closed:

- Roster row exists **and** the cohort has at least one `HigherUp` → re-link the Telegram id and
  reply with the role they already have. Do not offer the role buttons.
- Roster row exists **and** the cohort has zero `HigherUp` → offer the role buttons again.
- No roster row, group check passes → offer the role buttons.
- No roster row, group check unavailable → the fallback above.

The zero-higher-ups case is the recovery path for the one scenario that would otherwise need the
Supabase table editor: the first person to register in a fresh cohort taps "Intern" by mistake,
leaving a cohort that can never have a higher-up.

### Removing a member who holds open tasks is refused

`tasks.assignee_username` has no foreign key to `roster`, so orphaning an assignee violates no
constraint — it silently breaks four things: `listTasksForMember` rejects the username outright;
`listTasksForRole` filters on roster membership, so their tasks vanish from both the intern and
higher-up filters; `getStats` builds per-member counts from roster members, so their completed
work drops out of the breakdown while still counting toward `completionRate`; and the scheduler's
digest loop iterates roster entries, so nobody is ever reminded about those tasks again. So
`/roster remove` is refused while the member has any task whose status is not `done`, and the
reply lists the task refs that need reassigning first.

### Only registered members can be membership-checked

`getChatMember` needs a user id; the roster is keyed by username. The mapping lives in
`registrations` (`telegram_user_id` → `username`). At `/start` this is a non-issue because
`ctx.from.id` is in hand, but the reconciliation job (#90) can only check roster members who have
registered — unregistered members must be skipped, not reported as having left. Separately, and
unchanged from today: someone in the group with no Telegram username still cannot register,
because the roster is username-keyed.

### `roster.config.json` is deleted, not kept

ADR-0003 kept `roster.config.json` committed as "the documented shape of a roster and the seed for
standing up a new cohort." The seed half is gone under this design — cohorts now bootstrap
themselves, since the first person to `/start` can claim Higher-up. The row shape it documented is
no longer worth a standalone file once nothing reads or seeds from it: this ADR is where that
shape now lives. The file is deleted; references to it elsewhere in the repo are updated to point
here instead of rewritten to imply it still exists.

## Consequences

- `scripts/seedRosterAndCohorts.ts` keeps its `cohorts` job — the group check now depends on
  `cohort_id` + `group_chat_id` — and loses its roster job entirely.
- `roster.local.json` and `roster.config.json` stop being anything the app or its tooling reads.
- Two deployment prerequisites, both configuration rather than code, gate this from actually
  taking effect: `cohorts.group_chat_id` must be set for the real cohort (tied to the #17
  cutover), and the bot must be an administrator in the cohort group, which
  `getChatAdministrators` requires.
- A dashboard members page (roster editing on the web) is explicitly out of scope here, filed
  separately as issue #92. A dashboard page is unreachable by anyone the dashboard has locked out,
  so it can never be the tool that fixes a broken role — Telegram has to remain the primary
  surface.
- This is a planning ADR only. The roster-freshness fix (ticket R1, #86 — the roster is currently
  memoized at module scope with no invalidation) has to land first and on its own, since every
  other ticket here is untrustworthy until a role change is reliably visible.

## Alternatives rejected

- **Invite deep links** (`t.me/<bot>?start=<payload>`, role encoded in the token). Genuinely good,
  and it closes the same hole — but it requires a higher-up to generate and distribute a link,
  which is the admin work this ADR exists to remove. Dropped in favour of the group check, which
  needs no per-person action at all. Worth reconsidering if the group check proves unworkable.
- **Derive the role from group-admin status** instead of asking. More automatic and unfakeable,
  but it hard-couples "higher-up" to "group admin", which may not match how the cohort group is
  actually administered. Rejected in favour of asking, with roster management (not task
  permissions) tied to group-admin status instead.
- **Keep `roster.config.json`, rewritten as illustrative-only documentation.** Considered as the
  smaller change — the row shape is still worth documenting somewhere a human will look. Rejected
  in favour of deleting it: with the seed job gone, an unread file drifts from the schema it
  claims to document, and this ADR is a better-maintained place for the same information.
