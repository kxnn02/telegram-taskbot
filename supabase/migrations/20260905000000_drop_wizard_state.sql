-- Drops the wizard system's table and cron job (#106, ADR-0013).
--
-- The bot no longer has any multi-step wizard: /addtask is one line (or a
-- bare usage reply, Devie-style) and /edit is gone entirely, so nothing
-- writes to wizard_state any more. Never edit an already-applied migration
-- (20260831064536_init_schema.sql created this table) — drop it here
-- instead.

select cron.unschedule('wizard-state-cleanup');

drop table if exists wizard_state;
