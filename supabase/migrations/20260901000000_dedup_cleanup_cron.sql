-- Daily cleanup of stale processed_telegram_updates rows (ADR-0004/ADR-0007).
--
-- processed_telegram_updates exists purely to dedup Telegram's webhook
-- retries (ADR-0004) — Telegram only ever retries a given update_id within
-- a short window after delivery failure, not indefinitely, so a dedup row
-- has no reason to be kept once that retry window has long passed. A
-- 7-day retention is comfortably past any realistic Telegram retry window
-- while still giving generous headroom for debugging a delivery issue
-- shortly after it happens. This is the dedup-table half of the two
-- cleanup jobs issue #15 calls for pure SQL (no application logic, no HTTP
-- endpoint needed) — mirrors the wizard-state-cleanup migration
-- (20260831090000_wizard_state_cleanup_cron.sql) exactly.
select cron.schedule(
  'dedup-table-cleanup',
  '0 3 * * *', -- daily, 3am UTC (11am Asia/Manila) — off-hours for the cohort, same slot as wizard-state-cleanup
  $$ delete from processed_telegram_updates where processed_at < now() - interval '7 days' $$
);
