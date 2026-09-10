-- Per-cohort "last cert tip shown via /standup" — backs randomizing the
-- on-demand /standup command's tip while never repeating the same tip twice
-- in a row for that cohort. Only the on-demand /standup command reads/writes
-- this table — the scheduled daily push job and dashboard Preview/Test
-- deliberately keep using the existing date-seeded selectCertTipForDate()
-- and never touch this table, so Preview still always matches what the
-- scheduled job actually sends.

create table if not exists cohort_cert_tip_history (
  cohort_id text primary key,
  last_tip_id integer not null,
  updated_at timestamptz not null default now()
);

alter table cohort_cert_tip_history enable row level security;
