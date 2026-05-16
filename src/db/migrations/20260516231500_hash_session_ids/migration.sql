-- SQR-73: sessions.id now stores the SHA-256 hex of the raw cookie token.
--
-- Existing rows contain replayable raw session IDs. Re-hashing them in place
-- would require enabling pgcrypto just for this one-time cleanup, so invalidate
-- old sessions instead. Users can sign in again, and the table no longer keeps
-- raw session secrets after this deploy.
DELETE FROM sessions
WHERE id !~ '^[0-9a-f]{64}$';
