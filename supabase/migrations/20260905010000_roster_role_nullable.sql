-- Makes roster.role nullable and drops its Intern/HigherUp check (#106,
-- ADR-0013).
--
-- Not a full column drop: the ticket for #106 explicitly scopes the
-- code-level removal of Role/Intern/HigherUp to src/ and app/, and leaves
-- the column's fate to stage 1 (#101). But leaving the column NOT NULL
-- with `check (role in ('Intern', 'HigherUp'))` would block the one thing
-- this ticket does add — auto-registration inserting a roster row with no
-- role at all — so the minimal change that unblocks that without touching
-- anything stage 1 hasn't decided yet is: nullable, no check, still there.

alter table roster
  alter column role drop not null;

alter table roster
  drop constraint if exists roster_role_check;
