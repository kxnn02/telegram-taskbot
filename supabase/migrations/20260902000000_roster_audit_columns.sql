-- Audit columns for roster role changes (ADR-0003, R2 of issue #83).
--
-- Two columns, not a history table: eight people, and the question that
-- actually gets asked is "who set this, and when", which the current row
-- can answer. Follows the actor-recording pattern already in the schema
-- (notes.author_username, tasks.assigned_by_username) — role_set_by is
-- plain text, no foreign key, so it survives the referenced person being
-- removed from roster.
--
-- Both nullable, no default: existing rows have no history, and
-- backfilling a fabricated actor would be worse than a null.

alter table roster
  add column if not exists role_set_by text,
  add column if not exists role_set_at timestamptz;
