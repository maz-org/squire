import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureTelemetryLog, mockStartActiveSpan, startedSpans } = vi.hoisted(() => {
  const startedSpans: Array<{
    name: string;
    options: { attributes?: Record<string, unknown> };
    span: {
      setAttributes: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
      recordException: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  }> = [];

  return {
    mockCaptureTelemetryLog: vi.fn(),
    startedSpans,
    mockStartActiveSpan: vi.fn(
      async (
        name: string,
        options: { attributes?: Record<string, unknown> },
        callback: (span: (typeof startedSpans)[number]['span']) => Promise<unknown>,
      ) => {
        const span = {
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        };
        startedSpans.push({ name, options, span });
        return callback(span);
      },
    ),
  };
});

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: () => ({
      startActiveSpan: mockStartActiveSpan,
    }),
  },
}));

vi.mock('../src/telemetry.ts', () => ({
  captureTelemetryLog: mockCaptureTelemetryLog,
}));

import {
  recordChatLifecycleEvent,
  setChatSpanAttributes,
  withChatLifecycleSpan,
} from '../src/chat/chat-observability.ts';

describe('chat observability lifecycle wrapper', () => {
  beforeEach(() => {
    mockCaptureTelemetryLog.mockReset();
    mockStartActiveSpan.mockClear();
    startedSpans.length = 0;
  });

  it('emits structured lifecycle logs through the telemetry boundary', () => {
    recordChatLifecycleEvent('stream.completed', {
      route: '/chat/:conversationId/messages/:messageId/stream',
      surface: 'chat_sse',
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-user-1',
      assistantMessageId: 'msg-assistant-1',
      status: 'ok',
      durationMs: 42,
      attributes: {
        event_type: 'caller.override',
        status: 'caller_override',
      },
    });

    expect(mockCaptureTelemetryLog).toHaveBeenCalledWith(
      'info',
      'chat.stream.completed',
      expect.objectContaining({
        route: '/chat/:conversationId/messages/:messageId/stream',
        requestId: 'req-1',
        conversationId: 'conv-1',
        userMessageId: 'msg-user-1',
        assistantMessageId: 'msg-assistant-1',
        context: expect.objectContaining({
          eventType: 'stream.completed',
          surface: 'chat_sse',
          status: 'ok',
        }),
        attributes: expect.objectContaining({
          event_type: 'stream.completed',
          surface: 'chat_sse',
          status: 'ok',
          duration_ms: 42,
        }),
      }),
    );
    expect(mockCaptureTelemetryLog.mock.calls[0]?.[2].attributes).not.toHaveProperty(
      'langsmith_thread_id',
    );
  });

  it('starts app spans with static names and safe diagnostic attributes', async () => {
    await expect(
      withChatLifecycleSpan(
        'squire.chat.api_ask',
        {
          route: '/api/ask',
          surface: 'api_ask',
          requestId: 'req-2',
          game: 'fh',
        },
        async (span) => {
          setChatSpanAttributes(span, {
            route: '/api/ask',
            surface: 'api_ask',
            requestId: 'req-2',
            status: 'ok',
          });
          return 'ok';
        },
      ),
    ).resolves.toBe('ok');

    expect(startedSpans).toHaveLength(1);
    expect(startedSpans[0]).toEqual(
      expect.objectContaining({
        name: 'squire.chat.api_ask',
        options: {
          attributes: expect.objectContaining({
            'squire.route': '/api/ask',
            'squire.request_id': 'req-2',
            'squire.surface': 'api_ask',
            'squire.game': 'fh',
          }),
        },
      }),
    );
    expect(startedSpans[0]!.span.end).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(startedSpans)).not.toMatch(/prompt|answer|passage|email/i);
  });

  it('marks spans as failed when callers record swallowed chat errors', () => {
    const span = {
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };

    setChatSpanAttributes(span as never, {
      route: '/chat/:conversationId/messages/:messageId/stream',
      surface: 'chat_sse',
      requestId: 'req-4',
      conversationId: 'conv-4',
      userMessageId: 'msg-user-4',
      status: 'error',
      failureKind: 'stream_terminal_error',
    });

    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'squire.route': '/chat/:conversationId/messages/:messageId/stream',
        'squire.request_id': 'req-4',
        'squire.conversation_id': 'conv-4',
        'squire.user_message_id': 'msg-user-4',
        'squire.surface': 'chat_sse',
        'squire.status': 'error',
        'squire.failure_kind': 'stream_terminal_error',
      }),
    );
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'stream_terminal_error',
    });
  });

  it('marks spans as failed without recording the original error payload', async () => {
    const error = new Error('upstream failed for alice@example.com with provider payload');
    error.name = 'ProviderError';

    await expect(
      withChatLifecycleSpan(
        'squire.chat.assistant_turn',
        {
          route: '/chat',
          surface: 'web_chat',
          requestId: 'req-3',
          failureKind: 'assistant_turn',
        },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow(error);

    const span = startedSpans[0]!.span;
    expect(span.recordException).toHaveBeenCalledTimes(1);
    const recordedError = span.recordException.mock.calls[0]![0] as Error;
    expect(recordedError).not.toBe(error);
    expect(recordedError.name).toBe('ChatSpanFailure:ProviderError');
    expect(recordedError.message).toBe('Squire chat span failure');
    expect(recordedError.message).not.toContain('alice@example.com');
    expect(recordedError.stack ?? '').not.toContain('provider payload');
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'assistant_turn',
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
