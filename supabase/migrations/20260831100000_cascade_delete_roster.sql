-- Cascade deletes from cohorts down through roster, matching the existing
-- cascade to cohort_counters/tasks/notes (20260831070000_cascade_deletes.sql).
--
-- Missed in that migration since the roster table didn't have a live
-- storage adapter yet. Discovered by supabaseRosterStore.live.test.ts's own
-- afterEach cleanup failing with a foreign-key violation ("roster_cohort_id_fkey")
-- when it tried to delete a test cohort that still had roster rows under it —
-- exactly the same "zero permanent footprint on the shared project"
-- property the other cascade exists for (see CONTEXT.md's "Contract-test
-- isolation" note).
alter table roster
  drop constraint roster_cohort_id_fkey,
  add constraint roster_cohort_id_fkey
    foreign key (cohort_id) references cohorts (cohort_id) on delete cascade;
