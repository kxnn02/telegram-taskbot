# ADR-0016: `/due` is a deliberate eleventh command

- **Status**: Accepted, implemented (#222)
- **Date**: 2026-09-15
- **Depends on**: [ADR-0013](./0013-remove-access-control-for-devie-parity.md), which set the
  ten-command parity surface this ADR takes one documented exception to. ADR-0013 itself is
  **not** edited or superseded — parity remains the default posture; this is one departure from
  it, not a reopening of the decision.
- **Tracked as**: [#222](https://github.com/kxnn02/telegram-taskbot/issues/222), the single-item
  slice of [spec #220](https://github.com/kxnn02/telegram-taskbot/issues/220).

## Context

ADR-0013 cut this bot's command menu down to the upstream DevieBot's exact ten commands, on the
premise that every difference from Devie's surface is a difference a reviewer has to accept or
reject one piece at a time — so the menu should be a carbon copy unless there's no Devie
equivalent to copy at all.

A Cohort member can currently set a task's due date exactly once, at creation
(`/addtask <title> by <date>`). Every real reason a deadline moves afterward — a slip, a
re-prioritisation, a date typed wrong the first time — currently forces the member out of
Telegram and into the dashboard, which most members rarely open. Deadlines drift stale rather
than getting corrected, and the Overdue Bucket fills with tasks that were never actually late.

Before proposing a new command, the upstream DevieBot was checked directly (per ADR-0013's own
practice of citing the actual source rather than assuming): its command whitelist is the same
ten, and it has no deadline-editing path at all. There is nothing to port — this is genuinely new
ground, not a missed piece of the parity pass, and ADR-0013's "no deprecation aliases, no
redirect handlers" framing doesn't apply because there's no Devie behaviour being replaced.

## Decision

**Add `/due <ref> [by] <date>` as an eleventh command**, breaking ADR-0013's ten-command parity
surface knowingly rather than by accident. It is registered in `BOT_COMMANDS`
(`src/bot/createBot.ts`), the single list that drives both Telegram's autocomplete menu and the
`HANDLED_COMMANDS` set the edited-message guard reads — the same one list every other command
already derives from, so `/due` needed no new registration mechanism of its own.

**The command is named `/due`, not `/deadline`.** `/deadline` sits one character from the
existing `/deadlines` listing command and the two would land adjacent in autocomplete. `/due` is
distinct, shorter, and matches the underlying field name.

**No access control** (per ADR-0013, unaffected by this ADR): any Caller may re-date any task in
their own Cohort. Cohort scoping is tenancy, already enforced in the service layer, and the
`/due` handler adds no check of its own.

**No new service method, no schema change.** `TaskService.editTask` already accepts a due-date
patch and already validates the ISO format; `/due` calls it with a due-date-only patch. Overdue
is derived at read time from the stored due date, so re-dating a task immediately re-sorts it
into or out of the Overdue Bucket with no extra bookkeeping.

## Alternatives rejected

- **Extend `/update`'s grammar with an optional date instead of a new command.** `/update`'s
  splitter is a behaviour-for-behaviour port of Devie's own regex splitter, warts included
  (ADR-0009). Threading a date through it means making the status optional on every batch item —
  surgery on ported code that nothing else needs, for a feature Devie itself doesn't have.
- **Stay at ten commands by declining the feature.** Rejected: the pain is real (deadlines rot
  because the only fix requires leaving Telegram), and Devie having no equivalent isn't a reason
  to refuse a feature Devie's own design simply never needed — it's a reason to build it as new
  ground rather than pretend it's a port.

## Consequences

- The command menu is eleven, not ten. Any future audit of "is this bot a carbon copy of Devie"
  needs to know this one command is the deliberate, cited exception, not a drift back toward the
  pre-ADR-0013 21-command surface.
- `docs/adr/README.md`'s status table and `CONTEXT.md` both point here, so the exception is
  discoverable from the same places ADR-0013 itself is.
- Bulk `/due` (comma/newline-separated refs, one shared or per-item deadline) is out of scope for
  this ADR's shipped slice — it is the ticket that follows #222, under the same spec #220, and
  does not require a new ADR of its own since it's additive to the surface this one already opened.

## Out of scope

- Reducing the command surface elsewhere to stay at ten. The exception is taken, not paid for.
- Re-adding access control anywhere. Unaffected by this ADR; still ADR-0013's call to make.
