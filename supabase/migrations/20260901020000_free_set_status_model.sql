-- Stage 1a of the Devie-parity command redesign (ADR-0009, issue #27,
-- stage #28): swaps the gated six-status lifecycle for the free-set six
-- statuses, moves `blocked` from a boolean flag to a status with a
-- `previous_status` restore column, and makes `description` optional.
--
-- Mapping (issue #27's normative table): Assigned -> todo,
-- InProgress -> in_progress, Submitted -> in_review, Approved -> done,
-- NeedsRevision -> todo, Cancelled -> backlog. Any row with
-- blocked = true becomes status 'blocked', with its mapped prior status
-- written to previous_status instead of applied to status directly.
--
-- Ordering matters here: the old status CHECK constraint has to come off
-- before the data UPDATE (which writes the new status vocabulary), and the
-- new CHECK constraint can't go on until every row already satisfies it.
-- `blocked` is dropped only at the very end, once every row's status has
-- already been derived from it.
--
-- NOT applied against any live Supabase database by this migration file
-- alone — see the stage #28 handoff for what the human still needs to run
-- this against (cohort5-dryrun only; confirm the real Cohort 5 has not
-- been onboarded first, per issue #27).

alter table tasks drop constraint if exists tasks_status_check;

alter table tasks add column if not exists previous_status text;

alter table tasks alter column description drop not null;

update tasks set
  previous_status = case
    when blocked then (
      case status
        when 'Assigned' then 'todo'
        when 'InProgress' then 'in_progress'
        when 'Submitted' then 'in_review'
        when 'Approved' then 'done'
        when 'NeedsRevision' then 'todo'
        when 'Cancelled' then 'backlog'
        else status
      end
    )
    else null
  end,
  status = case
    when blocked then 'blocked'
    else (
      case status
        when 'Assigned' then 'todo'
        when 'InProgress' then 'in_progress'
        when 'Submitted' then 'in_review'
        when 'Approved' then 'done'
        when 'NeedsRevision' then 'todo'
        when 'Cancelled' then 'backlog'
        else status
      end
    )
  end;

alter table tasks add constraint tasks_status_check
  check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'));

alter table tasks add constraint tasks_previous_status_check
  check (previous_status is null or previous_status in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'));

alter table tasks drop column blocked;
