-- Cascade deletes from cohorts down through cohort_counters/tasks/notes.
--
-- Chosen so contract tests (and any future cohort teardown, e.g. the
-- dry-run cohort) can guarantee zero permanent footprint on this shared
-- project by deleting one row (the test cohort itself) rather than having
-- to know and delete every dependent table in FK order by hand.

alter table tasks
  drop constraint tasks_cohort_id_fkey,
  add constraint tasks_cohort_id_fkey
    foreign key (cohort_id) references cohorts (cohort_id) on delete cascade;

alter table cohort_counters
  drop constraint cohort_counters_cohort_id_fkey,
  add constraint cohort_counters_cohort_id_fkey
    foreign key (cohort_id) references cohorts (cohort_id) on delete cascade;

alter table notes
  drop constraint notes_cohort_id_task_id_fkey,
  add constraint notes_cohort_id_task_id_fkey
    foreign key (cohort_id, task_id) references tasks (cohort_id, id) on delete cascade;
