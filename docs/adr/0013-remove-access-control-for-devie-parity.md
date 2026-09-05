# ADR-0013: Remove access control entirely, for Devie parity

- **Status**: Accepted, implemented (#106)
- **Date**: 2026-09-05
- **Supersedes**: [ADR-0002](./0002-authorization-stays-in-taskservice.md)'s premise that
  `TaskService` holds authorization content (roles, permission checks, ownership rules — the
  RLS-as-backstop and service_role-key discipline it also records are unaffected and remain
  accurate); [ADR-0010](./0010-group-gated-registration-and-roster-management.md) in full — every
  mechanism it designed (group-membership check, role-picking buttons, `/roster`, group-admin-gated
  roster edits, the zero-higher-ups recovery path) is deleted.
- **Depends on**: [ADR-0009](./0009-devie-parity-command-redesign.md), which made the same call
  for the command surface and status model and is the direct precedent for this one.
- **Tracked as**: [#106](https://github.com/kxnn02/telegram-taskbot/issues/106), part of the
  Cohort 4 carbon-copy port (see `RESUME-cohort4-port.md`).

## Context

The maintainer's ask, restated for this port: this bot should be a carbon copy of DevieBot, so
that reviewing it is one question — "is this Devie?" — rather than a debate over every place this
bot's design differs from Devie's. ADR-0009 already made this call for the command surface and
status model. This ADR makes it for the one thing ADR-0009 explicitly left standing: access
control.

**Devie has no access control of any kind.** Its `syncMember` function (`app/api/telegram/webhook/
route.ts` line 570, verified against `DEVCONC4/DevieBot` @ `632a22c`) inserts anyone who messages
the bot straight into its `members` table, and no handler afterward checks anything. Any person
who can message the bot can create, edit, complete, or reassign anyone's tasks. Devie's `role`
field is not a permission tier at all — it holds a cohort label (`cohort4`, `cohort3`) so `/tasks
<role>` can filter by it, which is what this bot's `cohort_id` already does.

This bot, by contrast, had grown a full access-control system on top of the free-set status model
ADR-0009 introduced: an `Intern`/`HigherUp` role on every roster entry and caller; group-membership
and group-admin checks gating registration and roster edits (ADR-0010); a role-based dashboard
session and audience gate; and 12 commands (`/roster`, `/edit`, `/whoami`, `/dashboard`, and others)
that existed only to serve that system. None of it has a Devie equivalent, so all of it was a
difference the maintainer would have had to review and either accept or reject one piece at a time.

## Decision

**Remove every access-control mechanism and replace roster gating with auto-registration,
matching Devie's `syncMember` exactly:** anyone who messages the bot is registered on first
contact — inserted into the roster and linked to their Telegram id — with their record updated on
every later contact, and nothing checks anything afterward. Any roster member may act on any task
in their own cohort.

**Cohort scoping is the one thing that survives**, because it isn't access control — it's the
tenancy boundary Devie's own `role`/cohort label plays the same part for, and the dry-run loop
depends on it. Task ids (per-cohort sequential integers) and the bot token (an environment
variable, never a database row) survive unchanged for the same reason ADR-0009 gave: neither is
user-visible, and changing either is destructive or a regression, not a copy.

**No deprecation aliases, no redirect handlers.** Every command whose only purpose was serving the
removed access-control system — `/roster`, `/edit`, `/whoami`, `/dashboard`, `/cancel`,
`/mytasks`, `/task`, `/overdue`, `/pending`, `/blocked`, `/unblock`, `/note` — is gone outright, the
same call ADR-0009 made for its own removed commands. `/addtask` with no arguments now replies with
a usage example instead of opening the deleted wizard.

**The wizard system is deleted in full**, not made optional: `WizardManager`, both its state-store
implementations, the mid-wizard interruption middleware, and the `wizard_state` table (dropped by a
new migration — the migration that created it is left in place, per the project's "never edit an
applied migration" rule).

## Consequences

- **Nothing enforces anything any more.** A member in cohort A cannot see cohort B's tasks, but
  within a cohort, any member can complete, reassign, or delete anyone else's work with no
  confirmation and no audit beyond `assignedByUsername`/`authorUsername`, which record who acted
  but never gate it. This is the entire point of the ticket, not an oversight.
- **The `roster` table's `role` column is made nullable, not dropped.** `RosterEntry` in code no
  longer has a `role` field at all, but the column still exists with a `not null check (role in
  ('Intern','HigherUp'))` constraint that would otherwise reject every auto-registration insert.
  Dropping the column outright is left to the schema-migration stage of this port (#101); this ADR
  only removes the constraint blocking the code change it makes.
- **The dashboard has no audience gate beyond "is this a known cohort member."** `TaskService.
  getStats`, the `/tasks/:id/edit` page, and `PATCH /api/tasks/:id` all lost their higher-up-only
  checks. Login itself still requires an existing roster row (unaffected by this ADR — that's
  identity resolution, not authorization), but nothing distinguishes members once logged in.
- **Scheduled digests are uniform.** The daily/weekly notification jobs no longer split recipients
  into "own tasks only" vs. "own tasks plus cohort oversight" by role; every member now gets both
  halves, since there is no tier left to restrict the oversight half to.
- **`scripts/seedRosterAndCohorts.ts` lost its roster-writing job entirely.** It used to read
  `roster.local.json` and write roster rows for `--include-production`; since the roster is now
  bot-populated, that capability is removed rather than left dormant, so the script cannot write
  live roster rows from a stale local file even by accident.
- **A later proposal may reintroduce access control**, per the ticket's explicit framing — but as a
  separate, reviewed exercise once the copy itself is accepted, not smuggled into this stage.

## Alternatives rejected

- **Keep the role field but drop every check that reads it.** Considered as a smaller diff, but it
  leaves a field named `Role`/`Intern`/`HigherUp` sitting in the schema and the domain model with
  no meaning — exactly the kind of half-removed structure ADR-0009 warned against carrying forward
  into later stages of this port. Rejected in favour of deleting the type and the field everywhere
  in `src/`/`app/`, matching the ticket's own acceptance criterion.
- **Drop the `roster.role` database column outright, in this same ticket.** Would fully match the
  code-level deletion, but schema changes beyond what unblocks this ticket's own code are stage 1's
  job (#101), and a live cohort is using this bot — a narrower, reversible nullable-column change is
  safer than a column drop made under a different ticket's mandate.
- **Keep `/roster` as a read-only "who's here" command**, since the roster is still a real
  membership list. Rejected: Devie has no such command, and adding one — even read-only — is the
  exact kind of "propose it as an improvement afterward" the ticket explicitly puts out of scope.
