import { describe, expect, it } from 'vitest';

import type { Session } from '../src/db/repositories/types.ts';
import { renderRecentQuestionsNav, renderConversationPage } from '../src/web-ui/layout.ts';

const testSession: Session = {
  id: 'test-session-id',
  userId: 'test-user-id',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
  ipAddress: null,
  userAgent: null,
  lastSeenAt: new Date(),
  user: {
    id: 'test-user-id',
    googleSub: 'test-google-sub',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://example.com/test-user.png',
    createdAt: new Date(),
  },
};

describe('renderConversationPage ledger regression', () => {
  it('renders only the latest completed turn on canonical conversation pages', async () => {
    // Regression: ISSUE-QA-001 — canonical conversation pages showed the full transcript
    // Found by /qa on 2026-04-18
    // Report: .gstack/qa-reports/qa-report-localhost-4306-2026-04-18.md
    const messages = [
      {
        id: 'm1',
        conversationId: 'conv-123',
        role: 'user' as const,
        content: 'Question 1',
        isError: false,
        responseToMessageId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'm2',
        conversationId: 'conv-123',
        role: 'assistant' as const,
        content: 'Answer 1',
        isError: false,
        responseToMessageId: 'm1',
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
      {
        id: 'm3',
        conversationId: 'conv-123',
        role: 'user' as const,
        content: 'Question 2',
        isError: false,
        responseToMessageId: null,
        createdAt: new Date('2026-01-01T00:00:02.000Z'),
      },
      {
        id: 'm4',
        conversationId: 'conv-123',
        role: 'assistant' as const,
        content: 'Answer 2',
        isError: false,
        responseToMessageId: 'm3',
        createdAt: new Date('2026-01-01T00:00:03.000Z'),
      },
    ];

    const body = String(
      await renderConversationPage({
        session: testSession,
        csrfToken: 'test-csrf-token',
        conversationId: 'conv-123',
        messages,
        recentQuestionsNav: renderRecentQuestionsNav({
          conversationId: 'conv-123',
          questions: [messages[0], messages[2]],
          selectedMessageId: 'm3',
        }),
      }),
    );

    expect(body).toContain('Question 2');
    expect(body).toContain('Answer 2');
    expect(body).not.toContain('Question 1</p>');
    expect(body).not.toContain('Answer 1');
    expect(body).toContain('Recent questions');
    expect(body).toContain('Question 1');
  });
});
