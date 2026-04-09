-- SQR-38: add last_seen_at to sessions for activity tracking.
-- Updated by session middleware on each authenticated request.
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ;
