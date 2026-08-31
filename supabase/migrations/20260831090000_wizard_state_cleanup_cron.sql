-- Daily cleanup of stale wizard_state rows (ADR-0006/ADR-0007).
--
-- wizard_state has no built-in Postgres row-TTL equivalent, so a table that
-- otherwise never has rows removed would grow with abandoned /assign and
-- /edit wizards forever. The 20-minute in-app expiry (WIZARD_EXPIRY_MS)
-- already treats an abandoned wizard as normal — this just reclaims the
-- row once it's well past that expiry. Scheduled daily rather than at the
-- exact 20-minute mark: this is housekeeping, not correctness (an expired
-- row is already ignored by WizardManager.get's own expiry check), so
-- there's no need for finer-grained scheduling. This is the one piece of
-- pg_cron scope pulled forward from Phase 4 (issue #15) — the table isn't
-- safe to introduce without its cleanup.
create extension if not exists pg_cron;

select cron.schedule(
  'wizard-state-cleanup',
  '0 3 * * *', -- daily, 3am UTC (11am Asia/Manila) — off-hours for the cohort
  $$ delete from wizard_state where updated_at < now() - interval '20 minutes' $$
);
