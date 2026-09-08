-- Issue #131 (Parity S7): the daily standup on/off switch and its pg_cron
-- schedule. Devie's own standup delivery is driven by an external
-- scheduler (cron-job.org calling POST /api/standup on a timer); this repo
-- already has a proven pg_cron path for four notification jobs
-- (20260901010000_notification_jobs_cron.sql) reusing call_job_endpoint
-- (20260901130000_job_endpoint_timeout.sql), which already sends the
-- x-internal-job-secret header api/jobs/standup-push.ts verifies. No
-- authentication change of any kind.

-- Default `false` is load-bearing: merging this migration must not start
-- posting into any live group chat on its own. Every cohort — production
-- and cohort5-dryrun — starts off, and is turned on deliberately from the
-- settings page's Auto-standup switch afterwards.
alter table cohorts
  add column if not exists standup_enabled boolean not null default false;

-- Time chosen: every other job in this repo runs on the hour, and one of
-- them (job-overdue-crossing, 0 * * * *) is hourly, so it already fires at
-- 00:00 UTC like every other hour. Running the standup at 0 0 * * * would
-- land in the same minute as that job. :05 is the only change needed to
-- clear it, and no other job here uses a non-zero minute. 00:05 UTC is
-- 8:05am Asia/Manila — a sensible start-of-day slot, an hour ahead of the
-- 9am due-soon reminder and two ahead of the 10am daily digest, and
-- comfortably below the hour-12 boundary greeting() (src/bot/
-- standupCard.ts) uses for "Good morning, team!".
select cron.schedule(
  'job-standup-push',
  '5 0 * * *', -- daily, 00:05 UTC = 8:05am Asia/Manila
  $$ select call_job_endpoint('/api/jobs/standup-push') $$
);
