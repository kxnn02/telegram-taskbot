-- Initial schema for the Supabase re-platform (ADR-0006).
--
-- status stays text + CHECK, not a native enum (ADR-0006): easier to extend
-- without an ALTER TYPE migration.
--
-- row_version backs optimistic concurrency on tasks (ADR-0006): every write
-- checks the version it read against the stored version and increments it;
-- a mismatch is surfaced as a conflict rather than a silent overwrite.
--
-- RLS is enabled on every table with zero policies: a deny-by-default
-- backstop (ADR-0002/ADR-0006), not the primary authorization layer — that
-- stays in TaskService. Only the service-role key (which bypasses RLS) is
-- used by the app; anon/authenticated roles get nothing.

create table if not exists cohorts (
  cohort_id text primary key,
  name text not null,
  group_chat_id text
);

create table if not exists roster (
  id bigint generated always as identity primary key,
  username text not null,
  role text not null check (role in ('Intern', 'HigherUp')),
  cohort_id text not null references cohorts (cohort_id),
  unique (cohort_id, username)
);

create table if not exists tasks (
  id integer not null,
  cohort_id text not null references cohorts (cohort_id),
  title text not null,
  description text not null,
  assignee_username text not null,
  assigned_by_username text not null,
  due_date date not null,
  status text not null check (
    status in ('Assigned', 'InProgress', 'Submitted', 'Approved', 'NeedsRevision', 'Cancelled')
  ),
  blocked boolean not null default false,
  blocked_reason text,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cohort_id, id)
);

create table if not exists notes (
  note_id bigint generated always as identity primary key,
  cohort_id text not null,
  task_id integer not null,
  text text not null,
  author_username text not null,
  created_at timestamptz not null default now(),
  foreign key (cohort_id, task_id) references tasks (cohort_id, id)
);

create table if not exists overdue_notifications (
  cohort_id text not null,
  task_id integer not null,
  notified_at timestamptz not null default now(),
  primary key (cohort_id, task_id)
);

create table if not exists registrations (
  telegram_user_id bigint primary key,
  username text not null,
  registered_at timestamptz not null default now()
);

create table if not exists cohort_counters (
  cohort_id text primary key references cohorts (cohort_id),
  next_id integer not null default 1
);

create table if not exists processed_telegram_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create table if not exists wizard_state (
  telegram_user_id bigint primary key,
  kind text not null,
  step text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists alert_throttle (
  throttle_key text primary key,
  last_sent_at timestamptz not null
);

-- Atomic per-cohort id increment (ADR-0006). Read-increment-return over
-- PostgREST is not otherwise atomic, so this is a Postgres function invoked
-- via RPC from SupabaseTaskStore.nextId. Ensures a cohort_counters row
-- exists (starting at 1) before atomically incrementing and returning the
-- id that was just reserved.
create or replace function increment_cohort_counter(p_cohort_id text)
returns integer
language plpgsql
as $$
declare
  reserved_id integer;
begin
  insert into cohort_counters (cohort_id, next_id)
  values (p_cohort_id, 1)
  on conflict (cohort_id) do nothing;

  update cohort_counters
  set next_id = next_id + 1
  where cohort_id = p_cohort_id
  returning next_id - 1 into reserved_id;

  return reserved_id;
end;
$$;

-- Conditional updates to `tasks` (ADR-0006's row_version check) are done
-- directly by SupabaseTaskStore via the supabase-js query builder — an
-- ordinary `.update({..., row_version: expected + 1}).eq('row_version',
-- expected)` — no RPC needed there: PostgREST's `select()` on the update
-- response reports exactly which rows matched, so a stale version is
-- visible as zero returned rows in a single round trip.

alter table cohorts enable row level security;
alter table roster enable row level security;
alter table tasks enable row level security;
alter table notes enable row level security;
alter table overdue_notifications enable row level security;
alter table registrations enable row level security;
alter table cohort_counters enable row level security;
alter table processed_telegram_updates enable row level security;
alter table wizard_state enable row level security;
alter table alert_throttle enable row level security;
