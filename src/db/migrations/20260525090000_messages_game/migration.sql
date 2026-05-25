ALTER TABLE messages
  ADD COLUMN game TEXT DEFAULT NULL;

COMMENT ON COLUMN messages.game IS 'Runtime game context for user turns; nullable for assistant and historical rows.';
