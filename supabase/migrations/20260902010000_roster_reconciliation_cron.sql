-- pg_cron schedule for the daily roster-reconciliation job (ticket R5/#90):
-- walks the roster, flags members who have left the cohort's Telegram
-- group, and DMs every HigherUp about them. Reuses `call_job_endpoint`
-- (20260901130000_job_endpoint_timeout.sql) exactly like the four
-- notification jobs (20260901010000_notification_jobs_cron.sql).
--
-- Time chosen: 4am UTC = 12pm (noon) Asia/Manila. Deliberately not 1am UTC
-- (due-soon reminder), 2am UTC (daily/weekly digest), or 3am UTC
-- (wizard-state-cleanup / dedup-table-cleanup) — this job does its own
-- roster walk plus a `getChatMember` call per registered member, so giving
-- it a clear slot avoids stacking several `pg_net` HTTP jobs back to back
-- in the same minute. Midday Manila is also off the two existing digest
-- times, so a flagged-member DM doesn't land in the same few minutes as
-- the 10am daily digest.
select cron.schedule(
  'job-roster-reconciliation',
  '0 4 * * *', -- daily, 4am UTC = 12pm Asia/Manila
  $$ select call_job_endpoint('/api/jobs/roster-reconciliation') $$
);
