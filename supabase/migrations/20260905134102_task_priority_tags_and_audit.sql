-- Port stage 1 (issue #101): task priority, order_index, tags and audit log.
-- Additive only — new columns with defaults, new tables. Priority stays
-- text + CHECK, not a Postgres enum, matching ADR-0006's precedent for
-- status. Every new table gets RLS enabled with zero policies, matching
-- 20260831064536_init_schema.sql's deny-by-default backstop.

alter table tasks add column if not exists priority text not null default 'medium'
  check (priority in ('low', 'medium', 'high', 'urgent'));
alter table tasks add column if not exists order_index integer not null default 0;

create table if not exists tags (
  id bigint generated always as identity primary key,
  cohort_id text not null references cohorts (cohort_id),
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  unique (cohort_id, name)
);

create table if not exists task_tags (
  cohort_id text not null,
  task_id integer not null,
  tag_id bigint not null references tags (id) on delete cascade,
  primary key (cohort_id, task_id, tag_id),
  foreign key (cohort_id, task_id) references tasks (cohort_id, id) on delete cascade
);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  cohort_id text not null references cohorts (cohort_id),
  action text not null,
  status text not null check (status in ('ok', 'error', 'info')),
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table tags enable row level security;
alter table task_tags enable row level security;
alter table audit_logs enable row level security;
