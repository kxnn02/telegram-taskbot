# ADR-0009: Direct commands and free-set statuses, matching Devie

- **Status**: Accepted (planning only — not yet implemented)
- **Date**: 2026-09-01
- **Supersedes**: the task lifecycle in `PRD.md` §4, the command surface in §5, and the
  notification triggers in §8. Supersedes the `/edit`-and-`/assign` decision recorded in
  `CONTEXT.md`.
- **Tracked as**: [#27](https://github.com/kxnn02/telegram-taskbot/issues/27), stages
  [#28](https://github.com/kxnn02/telegram-taskbot/issues/28)-[#35](https://github.com/kxnn02/telegram-taskbot/issues/35).
  Source feedback: [#26](https://github.com/kxnn02/telegram-taskbot/issues/26).

## Context

A co-intern compared this bot to **Devie**, another DevCon bot the cohort's higher-ups already
use daily, and the comparison was unflattering in two specific ways.

**Commands here are wizard-based.** Creating a task means `/assign`, then answering "who is this
for?", then a title, then a description, then a due date, each as a separate message with a
separate round trip. Devie does the same thing in one line: `/addtask fix the login @jean by
Friday`. `CONTEXT.md` records the four-step chain as a deliberate choice — it was, and the
reasoning (four required fields, no reliable one-line syntax for them) was sound at the time. It
did not survive contact with people who had used the alternative.

**The status model is heavier than the cohort wants.** This bot enforces a review gate. Only the
assigned intern may submit; only a higher-up may approve or send back for revision; an Approved
task locks against further edits; `blocked` is an orthogonal flag rather than a status. Devie has
none of that — six statuses, anyone may set any of them on anything.

The second point is the real decision. Adopting Devie's *syntax* is a parsing change. Adopting
its *status model* means deleting the submit → review → approve workflow that most of this
codebase is organised around, along with the review queue, the approval notifications and the
weekly-approved digest that all derive from it.

## Decision

**Follow Devie, including on the status model.**

The deciding argument is not that Devie's design is better in the abstract. It is that the people
who will use this bot every day are already fluent in Devie, and **matching a tool someone
already knows beats a locally-better design they have to learn**. That is a product judgment
about this specific cohort, not a general claim about workflow gates.

Concretely:

- Six statuses — `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done` — replacing
  `Assigned`, `InProgress`, `Submitted`, `Approved`, `NeedsRevision`, `Cancelled`.
- Any registered roster member may set any status on any task in their own cohort. Cross-cohort
  access stays blocked: that is a tenancy boundary, not a workflow gate, and nothing here relaxes
  it.
- `blocked` becomes a status rather than a boolean flag, with a `previous_status` column so
  unblocking has a defined target.
- Commands become direct and one-line, with the existing wizards retained as the bare-command
  fallback rather than deleted.
- Task creation and read access open to all roster members.

**The redesign ships before the production cutover** ([#17](https://github.com/kxnn02/telegram-taskbot/issues/17),
Phase 6.3), not after.

## Consequences

**What this buys.** The cohort learns one command set, once, and it is the one they already know.
Because no real user has ever used this bot — verified 2026-09-01: zero roster members and zero
registrations against `cohort-5`, with the live webhook still pointed at the dry-run deployment —
removed commands can be removed outright. No aliases, no deprecation window, no migration comms.

**What this costs.** Four functional regressions, accepted knowingly:

- **`Cancelled` is gone.** There is no way to mark a task abandoned; existing rows map to
  `backlog`, the nearest "parked" meaning.
- **`NeedsRevision` is gone.** Sending work back is `/update t24 todo` plus a note. "Came back
  from review" is no longer distinguishable from "not started".
- **The Approved edit-lock is gone.** Finished tasks are editable and reopenable.
- **Self-approval is possible by design.** "Done" becomes a claim rather than a verified fact.
  This is the centre of Devie's model, not an oversight in copying it.

**What survives, contrary to first appearances.** `in_review` and `done` remain distinct statuses,
so the review queue (`/pending`), the submission notifications and the weekly-completed digest all
survive by retargeting rather than deletion. What is removed is the *gating*, not the machinery.

**The counts-only digest guarantee is untouched.** The daily and weekly group digests still report
per-intern counts and never task titles, still enforced by a data type that has no field able to
hold one. That decision was about involuntary public callouts, which this ADR does not revisit.

**One deliberate wart is being copied rather than fixed.** Devie binds `/done` to *in review* and
`/complete` to *done*, while `/update <ref> done` sets *done* — so the word means different things
as a command and as an argument. It is confusing, and it is what the higher-ups have in their
fingers. It is preserved on purpose and pinned by a test.

## Alternatives rejected

- **Direct syntax only, keeping the review gate.** The smaller change: adopt one-line commands and
  a generic `/update` that dispatches onto the existing gated transitions, so an intern typing
  `/update 21 done` is told only higher-ups can approve. Rejected because it answers the
  ergonomics complaint while leaving the model mismatch that the feedback was actually about, and
  because the resulting hybrid is *neither* tool anyone already knows.
- **Free-set statuses for interns on their own tasks only.** Removes the friction from the common
  path while keeping cohort-wide edits accountable. Rejected as still not the flat model, so it
  keeps a permission-denied case that Devie users would not expect.
- **Keeping the wizards as the only creation path.** Rejected outright — this is the complaint.
- **Cutting over to production first and redesigning afterwards.** Would give real usage evidence
  before changing the command surface, and would stop delaying go-live. Rejected because it means
  the cohort learns one command set and then has it changed under them a few weeks later, and the
  no-alias simplification above disappears the moment there is an installed base.
