-- SQR-98: persist the tool names consulted during each assistant answer
-- so the "CONSULTED · …" footer renders correctly for both live-streamed
-- turns and historical turns loaded from the DB. Nullable default so
-- existing rows keep working without a backfill; the render path treats
-- NULL as "footer hidden" to satisfy AC #3.
ALTER TABLE messages
  ADD COLUMN consulted_sources JSONB DEFAULT NULL;
