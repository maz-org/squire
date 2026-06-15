import { describe, expect, it } from 'vitest';

import { buildDiagnosticBundle } from '../src/diagnostic-bundle.ts';
import { createLinearBugReportBody } from '../src/linear-bug-report-template.ts';
import type { Conversation, ConversationMessage } from '../src/db/repositories/types.ts';
import type { MessageStreamEvent } from '../src/db/repositories/message-stream-event-repository.ts';

const now = new Date('2026-06-14T12:00:00.000Z');
const conversation: Conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  creationIdempotencyKey: null,
  createdAt: new Date('2026-06-14T11:55:00.000Z'),
  lastMessageAt: new Date('2026-06-14T11:59:00.000Z'),
};
const userMessage: ConversationMessage = {
  id: '33333333-3333-4333-8333-333333333333',
  conversationId: conversation.id,
  role: 'user',
  content: 'raw prompt that must stay out of Linear',
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
  content: 'full model answer that must stay out of Linear',
  game: null,
  campaignId: null,
  isError: true,
  responseToMessageId: userMessage.id,
  consultedSources: ['RULEBOOK'],
  createdAt: new Date('2026-06-14T11:57:00.000Z'),
};
const streamEvents: MessageStreamEvent[] = [
  {
    sequence: 1,
    event: 'tool-result',
    payload: {
      labels: ['RULEBOOK'],
      ok: false,
      providerPayload: { prompt: 'secret prompt', answer: 'secret answer' },
    },
    createdAt: new Date('2026-06-14T11:56:30.000Z'),
  },
  {
    sequence: 2,
    event: 'error',
    payload: {
      message: 'raw stream failure text',
    },
    createdAt: new Date('2026-06-14T11:56:31.000Z'),
  },
];

function fullBundle() {
  return buildDiagnosticBundle({
    now,
    env: {
      SQUIRE_ENV: 'production',
      SENTRY_RELEASE: 'dde5caa6dac615cf6523778944e9a6ba34690f8b',
    },
    conversationUrl: `https://squire.maz.org/chat/${conversation.id}?secret=1`,
    requestId: 'req-safe-1',
    user: { id: conversation.userId, email: 'person@example.com' },
    sentryIssueUrl: 'https://sentry.io/organizations/maz/issues/123/?query=secret',
    sentryEventUrl: 'https://sentry.io/organizations/maz/issues/123/events/abc/?project=1',
    sentryReplayUrl: 'https://sentry.io/replays/xyz/?query=secret',
    sentryTraceUrl: 'https://sentry.io/organizations/maz/traces/trace-1/?token=secret',
    sentryLogsUrl:
      'https://sentry.io/organizations/maz/logs/?query=conversation_id:11111111-1111-4111-8111-111111111111 request_id:req-safe-1&field=message&cookie=session',
    sentryTraceId: '0123456789abcdef0123456789abcdef',
    langsmithTraceUrl: 'https://smith.langchain.com/o/org/projects/p/project/r/run-1?secret=1',
    langsmithThreadUrl: 'https://smith.langchain.com/o/org/projects/p/project/threads/thread-1',
    langsmithRunId: 'run-1',
    conversation,
    messages: [userMessage, assistantMessage],
    streamEvents,
  });
}

describe('linear bug report template', () => {
  it('renders every required evidence field for an app/runtime bug', () => {
    const body = createLinearBugReportBody({
      bundle: fullBundle(),
      kind: 'app_runtime',
      observed: 'The stream failed after the first tool result.',
      expected: 'The assistant should finish or show the normal SSE error state.',
      likelyFailingArea: 'SSE transport or conversation-service error handling.',
      firstFilesToInspect: ['src/chat/conversation-service.ts', 'src/server.ts'],
      reproSteps: ['Open the conversation URL.', 'Reload the failing assistant turn.'],
      acceptanceCriteria: [
        'The same failure creates one Sentry event and a stable Linear bug body.',
      ],
    });

    expect(body).toContain('## Evidence');
    expect(body).toContain(`Conversation: https://squire.maz.org/chat/${conversation.id}`);
    expect(body).toContain(
      `Turn: userMessageId=${userMessage.id}, assistantMessageId=${assistantMessage.id}`,
    );
    expect(body).toContain('Request: req-safe-1');
    expect(body).toContain('Sentry:');
    expect(body).toContain('- Issue: https://sentry.io/organizations/maz/issues/123/');
    expect(body).toContain('- Event: https://sentry.io/organizations/maz/issues/123/events/abc/');
    expect(body).toContain('- Replay: https://sentry.io/replays/xyz/');
    expect(body).toContain('- Trace: https://sentry.io/organizations/maz/traces/trace-1/');
    expect(body).toContain(
      '- Logs: https://sentry.io/organizations/maz/logs/?query=conversation_id%3A11111111-1111-4111-8111-111111111111+request_id%3Areq-safe-1&field=message',
    );
    expect(body).toContain('- Trace ID: 0123456789abcdef0123456789abcdef');
    expect(body).toContain('- Release: dde5caa6dac615cf6523778944e9a6ba34690f8b');
    expect(body).toContain('- Environment: production');
    expect(body).toContain('LangSmith:');
    expect(body).toContain('- Trace: https://smith.langchain.com/o/org/projects/p/project/r/run-1');
    expect(body).toContain('- Thread: 11111111-1111-4111-8111-111111111111');
    expect(body).toContain(
      '- Thread URL: https://smith.langchain.com/o/org/projects/p/project/threads/thread-1',
    );
    expect(body).toContain('- Run ID: run-1');
    expect(body).toContain('## Observed Behavior');
    expect(body).toContain('## Expected Behavior');
    expect(body).toContain('## Why This Is Likely Failing');
    expect(body).toContain('## First Files To Inspect');
    expect(body).toContain('## Repro Steps');
    expect(body).toContain('## Acceptance Criteria');
    expect(body.indexOf('Sentry:')).toBeLessThan(body.indexOf('LangSmith:'));
  });

  it('leads with LangSmith for answer-quality bugs', () => {
    const body = createLinearBugReportBody({
      bundle: fullBundle(),
      kind: 'answer_quality',
      observed: 'The assistant cited the wrong rule interaction.',
      expected: 'The assistant should cite the relevant perk rule.',
      likelyFailingArea: 'Retrieval or final-answer synthesis.',
      firstFilesToInspect: ['src/agent-langgraph.ts', 'src/vector-store.ts'],
      reproSteps: ['Open the conversation URL.', 'Review the cited answer turn.'],
      acceptanceCriteria: ['The corrected answer is backed by the cited rule source.'],
    });

    expect(body).toContain(
      'Debug lane: Answer-quality bug. Start in LangSmith, then use Sentry only if there was an app/runtime error.',
    );
    expect(body.indexOf('LangSmith:')).toBeLessThan(body.indexOf('Sentry:'));
  });

  it('emits unavailable reasons instead of omitting missing data', () => {
    const body = createLinearBugReportBody({
      bundle: buildDiagnosticBundle({
        now,
        env: { SQUIRE_ENV: 'test' },
        conversationUrl: `https://squire.maz.org/chat/${conversation.id}`,
      }),
      kind: 'app_runtime',
    });

    expect(body).toContain('Request: Unavailable: request id was not provided');
    expect(body).toContain('- Issue: Unavailable: Sentry issue URL was not provided');
    expect(body).toContain('- Event: Unavailable: Sentry event URL was not provided');
    expect(body).toContain('- Replay: Unavailable: Sentry replay URL was not provided');
    expect(body).toContain('- Trace: Unavailable: Sentry trace URL was not provided');
    expect(body).toContain('- Logs: Unavailable: Sentry logs query URL was not provided');
    expect(body).toContain('- Trace ID: Unavailable: Sentry trace ID was not provided');
    expect(body).toContain('- Release: Unavailable: SENTRY_RELEASE is not configured');
    expect(body).toContain('- Trace: Unavailable: LangSmith trace URL was not provided');
    expect(body).toContain('Unavailable: observed behavior was not provided');
    expect(body).toContain('- Unavailable: first files to inspect were not provided');
    expect(body).toContain('- Unavailable: repro steps were not provided');
    expect(body).toContain('- Unavailable: acceptance criteria were not provided');
  });

  it('does not include protected diagnostic or caller-provided fields', () => {
    const body = createLinearBugReportBody({
      bundle: fullBundle(),
      kind: 'app_runtime',
      observed: 'Bearer sk_test_secret_secret_secret',
      expected: 'No raw token should be visible.',
      likelyFailingArea: 'providerPayload prompt should not leak.',
      firstFilesToInspect: ['src/server.ts'],
      reproSteps: ['Open the sanitized conversation URL.'],
      acceptanceCriteria: ['The ticket contains only safe IDs and links.'],
    });

    expect(body).not.toContain('secret=1');
    expect(body).not.toContain('token=secret');
    expect(body).not.toContain('cookie=session');
    expect(body).not.toContain('person@example.com');
    expect(body).not.toContain('raw prompt');
    expect(body).not.toContain('full model answer');
    expect(body).not.toContain('secret prompt');
    expect(body).not.toContain('secret answer');
    expect(body).not.toContain('raw stream failure text');
    expect(body).not.toContain('sk_test');
  });
});
