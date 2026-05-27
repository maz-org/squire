CREATE TABLE "message_stream_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "user_message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "message_stream_events_user_message_sequence_idx"
  ON "message_stream_events" ("user_message_id", "sequence");

CREATE INDEX "message_stream_events_conversation_message_idx"
  ON "message_stream_events" ("conversation_id", "user_message_id");

CREATE UNIQUE INDEX "message_stream_events_user_message_terminal_idx"
  ON "message_stream_events" ("user_message_id")
  WHERE "event" IN ('done', 'error');
