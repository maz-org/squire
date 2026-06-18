import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

import {
  captureTelemetryLog,
  type TelemetryLogLevel,
  type TelemetryLogInput,
  type TelemetryUserIdentity,
} from '../telemetry.ts';

export type ChatLifecycleSurface = 'web_chat' | 'chat_sse' | 'api_ask';

export type ChatLifecycleEvent =
  | 'turn.accepted'
  | 'generation.started'
  | 'stream.started'
  | 'stream.first_event'
  | 'stream.replayed'
  | 'stream.completed'
  | 'stream.cancelled'
  | 'assistant.persisted'
  | 'api_ask.accepted'
  | 'api_ask.completed';

export interface ChatLifecycleInput {
  route?: string;
  requestId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  surface: ChatLifecycleSurface;
  status?: 'accepted' | 'started' | 'ok' | 'error' | 'replayed' | 'cancelled' | 'already_done';
  failureKind?: string;
  streamEvent?: string;
  sequence?: number;
  durationMs?: number;
  replay?: boolean;
  retry?: boolean;
  game?: string | null;
  langsmithThreadUrl?: string;
  langsmithRunUrl?: string;
  user?: TelemetryUserIdentity;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}

const chatTracer = trace.getTracer('squire.chat');

function safeOriginalErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'NonError';
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(error.name)) return 'Error';
  return error.name || 'Error';
}

function safeChatSpanError(error: unknown): Error {
  const safe = new Error('Squire chat span failure');
  safe.name = `ChatSpanFailure:${safeOriginalErrorName(error)}`;
  return safe;
}

function compactRecord<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

function lifecycleAttributes(
  eventType: ChatLifecycleEvent,
  input: ChatLifecycleInput,
): Record<string, string | number | boolean> {
  return compactRecord({
    ...(input.attributes ?? {}),
    event_type: eventType,
    surface: input.surface,
    status: input.status,
    failure_kind: input.failureKind,
    stream_event: input.streamEvent,
    sequence: input.sequence,
    duration_ms: input.durationMs,
    replay: input.replay,
    retry: input.retry,
    game: input.game,
  }) as Record<string, string | number | boolean>;
}

function lifecycleContext(eventType: ChatLifecycleEvent, input: ChatLifecycleInput) {
  return compactRecord({
    eventType,
    surface: input.surface,
    status: input.status,
    failureKind: input.failureKind,
    streamEvent: input.streamEvent,
    replay: input.replay,
    retry: input.retry,
  });
}

function logInput(eventType: ChatLifecycleEvent, input: ChatLifecycleInput): TelemetryLogInput {
  return {
    route: input.route,
    requestId: input.requestId,
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    langsmithThreadUrl: input.langsmithThreadUrl,
    langsmithRunUrl: input.langsmithRunUrl,
    user: input.user,
    context: lifecycleContext(eventType, input),
    attributes: lifecycleAttributes(eventType, input),
  };
}

export function recordChatLifecycleEvent(
  eventType: ChatLifecycleEvent,
  input: ChatLifecycleInput,
  level: TelemetryLogLevel = input.status === 'error' ? 'error' : 'info',
): boolean {
  return captureTelemetryLog(level, `chat.${eventType}`, logInput(eventType, input));
}

function spanAttributes(input: ChatLifecycleInput): Attributes {
  return compactRecord({
    'squire.route': input.route,
    'squire.request_id': input.requestId,
    'squire.conversation_id': input.conversationId,
    'squire.user_message_id': input.userMessageId,
    'squire.assistant_message_id': input.assistantMessageId,
    'squire.surface': input.surface,
    'squire.status': input.status,
    'squire.failure_kind': input.failureKind,
    'squire.replay': input.replay,
    'squire.retry': input.retry,
    'squire.game': input.game,
    'langsmith.thread_url': input.langsmithThreadUrl,
    'langsmith.run_url': input.langsmithRunUrl,
  }) as Attributes;
}

export function setChatSpanAttributes(span: Span, input: ChatLifecycleInput): void {
  span.setAttributes(spanAttributes(input));
  if (input.status === 'error') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: input.failureKind ?? 'chat_lifecycle_error',
    });
  }
}

export async function withChatLifecycleSpan<T>(
  spanName: 'squire.chat.assistant_turn' | 'squire.chat.sse_stream' | 'squire.chat.api_ask',
  input: ChatLifecycleInput,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return chatTracer.startActiveSpan(
    spanName,
    { attributes: spanAttributes(input) },
    async (span) => {
      try {
        const result = await run(span);
        if (input.status) setChatSpanAttributes(span, input);
        return result;
      } catch (error) {
        span.recordException(safeChatSpanError(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: input.failureKind ?? 'chat_lifecycle_error',
        });
        setChatSpanAttributes(span, { ...input, status: 'error' });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
