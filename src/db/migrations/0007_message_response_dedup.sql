ALTER TABLE messages
  ADD COLUMN response_to_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX messages_response_to_message_id_idx
  ON messages (response_to_message_id);
