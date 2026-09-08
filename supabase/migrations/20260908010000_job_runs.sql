-- Persisted success/failure marker for job endpoints (issue #43): Vercel's
-- own runtime-log retention is too short (Hobby: ~1h) to confirm after the
-- fact whether a Vercel-Cron-triggered invocation of `keep-alive` or
-- `weekly-backup` actually fired — which is exactly how both sat
-- unconfigured and unnoticed for months. This table is a durable record a
-- job writes to itself, independent of log retention or the Vercel
-- dashboard's own Cron Jobs tab.
--
-- Not cohort-scoped (unlike audit_logs) — keep-alive/weekly-backup are
-- cohort-agnostic. Every new table gets RLS enabled with zero policies,
-- matching 20260831064536_init_schema.sql's deny-by-default backstop.

create table if not exists job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  status text not null check (status in ('success', 'error')),
  detail text,
  ran_at timestamptz not null default now()
);

create index if not exists job_runs_job_name_ran_at_idx
  on job_runs (job_name, ran_at desc);

alter table job_runs enable row level security;
