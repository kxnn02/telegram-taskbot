-- Backs the belt-and-suspenders sweep for leftover contract-test cohorts
-- (see CONTEXT.md's "Contract-test isolation" note): the sweep needs to
-- tell a stale test cohort (crashed run, never cleaned up by afterEach)
-- from one a test is still actively using.
alter table cohorts
  add column if not exists created_at timestamptz not null default now();
