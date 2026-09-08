-- #143 D4b / #147 (S4): move job-weekly-digest off the 10:00am Manila slot
-- it shared with job-daily-digest (20260901010000_notification_jobs_cron.sql),
-- which caused every member to get two overlapping DMs seconds apart every
-- Monday. The weekly digest's content changed too (completed-this-week
-- only, not open tasks — same PR), so both the schedule and the content
-- move together rather than the collision persisting for one deploy cycle.
--
-- New time: 00:10 UTC Monday = 8:10am Asia/Manila, five minutes after
-- job-standup-push (00:05 UTC, 20260908000000_standup_schedule.sql) — the
-- same reasoning that migration used to pick a clear, non-colliding minute
-- rather than landing on the hour with another job.
--
-- cron.schedule upserts by job name (same name, 'job-weekly-digest'), so
-- this moves the existing job in place rather than creating a duplicate.
select cron.schedule(
  'job-weekly-digest',
  '10 0 * * 1', -- Monday, 00:10 UTC = 8:10am Asia/Manila
  $$ select call_job_endpoint('/api/jobs/weekly-digest') $$
);
