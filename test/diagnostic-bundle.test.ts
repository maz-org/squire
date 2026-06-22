import { describe, expect, it, vi } from 'vitest';

import {
  buildDiagnosticBundle,
  collectDiagnosticBundle,
  DiagnosticBundleSchema,
  type DiagnosticBundleDataSource,
} from '../src/diagnostic-bundle.ts';
import type { Conversation, ConversationMessage } from '../src/db/repositories/types.ts';
import type { MessageStreamEvent } from '../src/db/repositories/message-stream-event-repository.ts';
import { EMBEDDING_VERSION } from '../src/vector-store.ts';

const now = new Date('2026-06-14T12:00:00.000Z');
const conversation: Conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  creationIdempotencyKey: null,
  campaignId: null,
  createdAt: new Date('2026-06-14T11:55:00.000Z'),
  lastMessageAt: new Date('2026-06-14T11:59:00.000Z'),
};
const userMessage: ConversationMessage = {
  id: '33333333-3333-4333-8333-333333333333',
  conversationId: conversation.id,
  role: 'user',
  content: 'raw prompt with Bearer secret-token',
  game: 'frosthaven',
  campaignId: '44444444-4444-4444-8444-444444444444',
  isError: false,
  responseToMessageId: null,
  consultedSources: null,
  createdAt: new Date('2026-06-14T11:56:00.000Z'),
};
const assistantMessage: ConversationMessage = {
  id: '55555555-5555-4555-8555-555555555555',
  conversationId: conversation.id,
  role: 'assistant',
  content: 'full model answer that must not enter the diagnostic bundle',
  game: null,
  campaignId: null,
  isError: true,
  responseToMessageId: userMessage.id,
  consultedSources: ['RULEBOOK', 'search_rules'],
  createdAt: new Date('2026-06-14T11:57:00.000Z'),
};
const streamEvents: MessageStreamEvent[] = [
  {
    sequence: 1,
    event: 'tool-progress',
    payload: {
      label: 'RULEBOOK',
      message: 'Searching raw user prompt text',
    },
    createdAt: new Date('2026-06-14T11:56:10.000Z'),
  },
  {
    sequence: 2,
    event: 'answer-artifact',
    payload: {
      sourceLabel: 'SECTION BOOK',
      ref: 'section:frosthaven/123.1',
      title: 'Secret section title',
      body: 'raw retrieved source passage',
    },
    createdAt: new Date('2026-06-14T11:56:20.000Z'),
  },
  {
    sequence: 3,
    event: 'error',
    payload: {
      kind: 'transport',
      message: 'raw error text',
    },
    createdAt: new Date('2026-06-14T11:56:30.000Z'),
  },
];

describe('diagnostic bundle', () => {
  it('builds a full safe bundle from conversation evidence', () => {
    const bundle = buildDiagnosticBundle({
      now,
      env: {
        SQUIRE_ENV: 'production',
        SENTRY_RELEASE: '5f2b5f152df6c3b277d2234a82717ef8cd060a52',
      },
      conversationUrl: `https://squire.maz.org/chat/${conversation.id}?token=secret`,
      browserUrl: `https://squire.maz.org/chat/${conversation.id}?historyQuery=secret`,
      requestId: 'req-safe-1',
      user: { id: conversation.userId, hash: 'user-hash-1', email: 'person@example.com' },
      sentryIssueUrl: 'https://sentry.io/organizations/maz/issues/123/?query=secret',
      sentryEventUrl: 'https://sentry.io/organizations/maz/issues/123/events/abc/?project=1',
      sentryEventId: 'abcdefabcdefabcdefabcdefabcdefab',
      sentryReplayUrl: 'https://sentry.io/replays/xyz/?query=secret',
      sentryTraceUrl: 'https://sentry.io/organizations/maz/traces/trace-1/?token=secret',
      sentryLogsUrl:
        'https://sentry.io/organizations/maz/logs/?query=conversation_id:11111111-1111-4111-8111-111111111111 request_id:req-safe-1&field=message&token=secret',
      sentryTraceId: '0123456789abcdef0123456789abcdef',
      langsmithTraceUrl: 'https://smith.langchain.com/o/org/projects/p/project/r/run-1?secret=1',
      langsmithThreadUrl: 'https://smith.langchain.com/o/org/projects/p/project/threads/thread-1',
      langsmithRunId: 'run-1',
      browser: {
        userAgent: 'SquireTest/1.0',
        viewport: { width: 390, height: 844 },
        replaySnapshotId: 'masked-replay-snapshot-1',
        timezone: 'America/New_York',
      },
      conversation,
      messages: [userMessage, assistantMessage],
      streamEvents,
    });

    expect(DiagnosticBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.report.generatedAt).toEqual({
      status: 'available',
      value: '2026-06-14T12:00:00.000Z',
    });
    expect(bundle.conversation.id).toEqual({ status: 'available', value: conversation.id });
    expect(bundle.conversation.userMessageId).toEqual({
      status: 'available',
      value: userMessage.id,
    });
    expect(bundle.conversation.assistantMessageId).toEqual({
      status: 'available',
      value: assistantMessage.id,
    });
    expect(bundle.conversation.url).toEqual({
      status: 'available',
      value: `https://squire.maz.org/chat/${conversation.id}`,
    });
    expect(bundle.sentry.eventUrl).toEqual({
      status: 'available',
      value: 'https://sentry.io/organizations/maz/issues/123/events/abc/',
    });
    expect(bundle.sentry.eventId).toEqual({
      status: 'available',
      value: 'abcdefabcdefabcdefabcdefabcdefab',
    });
    expect(bundle.sentry.traceUrl).toEqual({
      status: 'available',
      value: 'https://sentry.io/organizations/maz/traces/trace-1/',
    });
    expect(bundle.sentry.logsUrl).toEqual({
      status: 'available',
      value:
        'https://sentry.io/organizations/maz/logs/?query=conversation_id%3A11111111-1111-4111-8111-111111111111+request_id%3Areq-safe-1&field=message',
    });
    expect(bundle.sentry.traceId).toEqual({
      status: 'available',
      value: '0123456789abcdef0123456789abcdef',
    });
    expect(bundle.langsmith.traceUrl).toEqual({
      status: 'available',
      value: 'https://smith.langchain.com/o/org/projects/p/project/r/run-1',
    });
    expect(bundle.browser.timezone).toEqual({
      status: 'available',
      value: 'America/New_York',
    });
    expect(bundle.stream.status).toEqual({ status: 'available', value: 'error' });
    expect(bundle.stream.workLogRows).toEqual({
      status: 'available',
      value: [
        {
          sequence: 1,
          event: 'tool-progress',
          createdAt: '2026-06-14T11:56:10.000Z',
          sourceLabels: ['RULEBOOK'],
        },
        {
          sequence: 2,
          event: 'answer-artifact',
          createdAt: '2026-06-14T11:56:20.000Z',
          sourceLabels: ['SECTION BOOK'],
          ref: 'section:frosthaven/123.1',
        },
      ],
    });
    expect(bundle.sourceIndex.embeddingVersion).toEqual({
      status: 'available',
      value: EMBEDDING_VERSION,
    });
    expect(JSON.stringify(bundle)).not.toContain('token=secret');
    expect(JSON.stringify(bundle)).not.toContain('query=secret');
    expect(JSON.stringify(bundle)).not.toContain('historyQuery=secret');
    expect(JSON.stringify(bundle)).not.toContain('raw prompt');
    expect(JSON.stringify(bundle)).not.toContain('full model answer');
    expect(JSON.stringify(bundle)).not.toContain('raw retrieved source passage');
    expect(JSON.stringify(bundle)).not.toContain('person@example.com');
  });

  it('drops free-text Sentry log queries that could contain private conversation text', () => {
    const bundle = buildDiagnosticBundle({
      sentryLogsUrl:
        'https://sentry.io/organizations/maz/logs/?query=message:"raw prompt from Alice"&field=message&project=4511564194643969',
    });

    expect(bundle.sentry.logsUrl).toEqual({
      status: 'available',
      value: 'https://sentry.io/organizations/maz/logs/?field=message&project=4511564194643969',
    });
    expect(JSON.stringify(bundle)).not.toContain('raw prompt');
    expect(JSON.stringify(bundle)).not.toContain('Alice');
  });

  it('drops malformed quoted Sentry log filter values', () => {
    const bundle = buildDiagnosticBundle({
      sentryLogsUrl:
        'https://sentry.io/organizations/maz/logs/?query=request_id:"req-safe-1&field=message',
    });

    expect(bundle.sentry.logsUrl).toEqual({
      status: 'available',
      value: 'https://sentry.io/organizations/maz/logs/?field=message',
    });
  });

  it('derives Sentry searches and only real LangSmith run links from safe ids and server config', () => {
    const bundle = buildDiagnosticBundle({
      now,
      env: {
        SQUIRE_ENV: 'production',
        SENTRY_ORG_SLUG: 'acme',
        SENTRY_PROJECT_ID: '12345',
        SENTRY_RELEASE: '5f2b5f152df6c3b277d2234a82717ef8cd060a52',
        LANGSMITH_WORKSPACE_ID: '44be4d80-ba50-4833-ae22-6e176be2dbf2',
        LANGSMITH_PROJECT_ID: 'd2a644ae-c64f-49ab-8b4a-fdf09e00f65a',
      },
      conversationUrl: `https://squire.maz.org/chat/${conversation.id}`,
      requestId: 'req-safe-1',
      langsmithRunId: 'run-1',
      conversation,
      messages: [userMessage, assistantMessage],
      streamEvents,
    });

    expect(bundle.sentry.issueUrl).toEqual({
      status: 'available',
      value:
        'https://acme.sentry.io/issues/?project=12345&environment=production&query=request_id%3Areq-safe-1+conversation_id%3A11111111-1111-4111-8111-111111111111+user_message_id%3A33333333-3333-4333-8333-333333333333+assistant_message_id%3A55555555-5555-4555-8555-555555555555&referrer=squire-bug-report',
    });
    expect(bundle.sentry.logsUrl).toEqual({
      status: 'available',
      value:
        'https://acme.sentry.io/explore/logs/?project=12345&environment=production&query=request_id%3Areq-safe-1+conversation_id%3A11111111-1111-4111-8111-111111111111+user_message_id%3A33333333-3333-4333-8333-333333333333+assistant_message_id%3A55555555-5555-4555-8555-555555555555&referrer=squire-bug-report',
    });
    expect(bundle.sentry.traceUrl).toEqual({
      status: 'available',
      value:
        'https://acme.sentry.io/explore/traces/?project=12345&environment=production&query=squire.request_id%3Areq-safe-1+squire.conversation_id%3A11111111-1111-4111-8111-111111111111+squire.user_message_id%3A33333333-3333-4333-8333-333333333333+squire.assistant_message_id%3A55555555-5555-4555-8555-555555555555&referrer=squire-bug-report',
    });
    expect(bundle.langsmith.traceUrl).toEqual({
      status: 'available',
      value:
        'https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d2a644ae-c64f-49ab-8b4a-fdf09e00f65a/r/run-1',
    });
    expect(bundle.langsmith.threadUrl).toEqual({
      status: 'unavailable',
      reason: 'LangSmith thread URL was not provided',
    });
    expect(bundle.langsmith.threadId).toEqual({
      status: 'unavailable',
      reason: 'LangSmith thread id was not provided',
    });
    expect(bundle.langsmith.runUrl).toEqual({
      status: 'available',
      value:
        'https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d2a644ae-c64f-49ab-8b4a-fdf09e00f65a/r/run-1',
    });
  });

  it('keeps an explicit LangSmith thread id without deriving a thread URL', () => {
    const bundle = buildDiagnosticBundle({
      now,
      env: {
        LANGSMITH_WORKSPACE_ID: '44be4d80-ba50-4833-ae22-6e176be2dbf2',
        LANGSMITH_PROJECT_ID: 'd2a644ae-c64f-49ab-8b4a-fdf09e00f65a',
      },
      langsmithThreadId: 'thread-1',
      conversation,
      messages: [userMessage, assistantMessage],
    });

    expect(bundle.langsmith.threadId).toEqual({
      status: 'available',
      value: 'thread-1',
    });
    expect(bundle.langsmith.threadUrl).toEqual({
      status: 'unavailable',
      reason: 'LangSmith thread URL was not provided',
    });
  });

  it('marks missing Sentry, LangSmith, replay, and message data with unavailable reasons', () => {
    const bundle = buildDiagnosticBundle({
      now,
      env: { SQUIRE_ENV: 'test' },
      route: '/chat',
    });

    expect(bundle.sentry.issueUrl.status).toBe('unavailable');
    expect(bundle.sentry.eventUrl.status).toBe('unavailable');
    expect(bundle.sentry.eventId.status).toBe('unavailable');
    expect(bundle.sentry.replayUrl.status).toBe('unavailable');
    expect(bundle.sentry.traceUrl.status).toBe('unavailable');
    expect(bundle.sentry.logsUrl.status).toBe('unavailable');
    expect(bundle.sentry.traceId.status).toBe('unavailable');
    expect(bundle.langsmith.traceUrl.status).toBe('unavailable');
    expect(bundle.browser.replaySnapshotId.status).toBe('unavailable');
    expect(bundle.browser.timezone.status).toBe('unavailable');
    expect(bundle.stream.workLogRows.status).toBe('unavailable');
    expect(bundle.unavailable).toEqual(
      expect.arrayContaining([
        { path: 'sentry.issueUrl', reason: 'Sentry issue URL was not provided or derivable' },
        { path: 'sentry.eventId', reason: 'Sentry event ID was not provided' },
        { path: 'sentry.traceUrl', reason: 'Sentry trace URL was not provided or derivable' },
        { path: 'sentry.logsUrl', reason: 'Sentry logs query URL was not provided or derivable' },
        { path: 'sentry.traceId', reason: 'Sentry trace ID was not provided' },
        { path: 'langsmith.traceUrl', reason: 'LangSmith trace URL was not provided' },
        { path: 'stream.workLogRows', reason: 'stream events were not loaded' },
      ]),
    );
  });

  it('does not leak protected fields from browser or work-log evidence', () => {
    const bundle = buildDiagnosticBundle({
      now,
      browserUrl: 'https://squire.maz.org/chat/abc?cookie=session',
      browser: {
        userAgent: 'Bearer sk_test_secret_secret_secret',
        viewport: { width: 1024, height: 768 },
      },
      messages: [
        {
          ...userMessage,
          content: 'prompt: do not include this',
        },
        {
          ...assistantMessage,
          content: 'answer: do not include this',
          consultedSources: ['RULEBOOK'],
        },
      ],
      streamEvents: [
        {
          sequence: 1,
          event: 'tool-result',
          payload: {
            labels: ['RULEBOOK'],
            ok: false,
            providerPayload: { prompt: 'secret prompt', answer: 'secret answer' },
            message: 'raw provider failure',
          },
          createdAt: now,
        },
      ],
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('cookie=session');
    expect(serialized).not.toContain('sk_test');
    expect(serialized).not.toContain('do not include this');
    expect(serialized).not.toContain('secret prompt');
    expect(serialized).not.toContain('secret answer');
    expect(serialized).not.toContain('raw provider failure');
    expect(bundle.stream.workLogRows).toEqual({
      status: 'available',
      value: [
        {
          sequence: 1,
          event: 'tool-result',
          createdAt: '2026-06-14T12:00:00.000Z',
          sourceLabels: ['RULEBOOK'],
          ok: false,
        },
      ],
    });
  });

  it('collects conversation evidence by message id through an ownership-aware data source', async () => {
    const assistantWithLangSmith: ConversationMessage = {
      ...assistantMessage,
      langsmithRunId: '00000000-0000-0000-abcd-0123456789ab',
      langsmithRunUrl:
        'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true',
      langsmithTraceUrl:
        'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab?poll=true',
    };
    const dataSource: DiagnosticBundleDataSource = {
      findOwnedConversation: vi.fn(async () => conversation),
      findMessageById: vi.fn(async () => userMessage),
      listMessagesByConversationId: vi.fn(async () => [userMessage, assistantWithLangSmith]),
      listStreamEventsByUserMessageId: vi.fn(async () => streamEvents),
    };

    const bundle = await collectDiagnosticBundle({
      now,
      userMessageId: userMessage.id,
      user: { id: conversation.userId },
      dataSource,
    });

    expect(dataSource.findMessageById).toHaveBeenCalledWith(userMessage.id);
    expect(dataSource.findOwnedConversation).toHaveBeenCalledWith(
      conversation.userId,
      conversation.id,
    );
    expect(dataSource.listMessagesByConversationId).toHaveBeenCalledWith(conversation.id);
    expect(dataSource.listStreamEventsByUserMessageId).toHaveBeenCalledWith(userMessage.id);
    expect(bundle.conversation.id).toEqual({ status: 'available', value: conversation.id });
    expect(bundle.conversation.assistantMessageId).toEqual({
      status: 'available',
      value: assistantMessage.id,
    });
    expect(bundle.langsmith.runId).toEqual({
      status: 'available',
      value: '00000000-0000-0000-abcd-0123456789ab',
    });
    expect(bundle.langsmith.runUrl).toEqual({
      status: 'available',
      value:
        'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab',
    });
    expect(bundle.langsmith.traceUrl).toEqual({
      status: 'available',
      value:
        'https://smith.langchain.com/o/org/projects/p/project/r/00000000-0000-0000-abcd-0123456789ab',
    });
  });
});
