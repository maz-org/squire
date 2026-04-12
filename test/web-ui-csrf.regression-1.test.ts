import { describe, expect, it } from 'vitest';

import { renderConversationPage, renderHomePage } from '../src/web-ui/layout.ts';
import { CSRF_FORM_FIELD_NAME } from '../src/web-ui/csrf.ts';
import type { Session } from '../src/db/repositories/types.ts';

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

describe('authenticated chat form CSRF regression', () => {
  it('renders a hidden CSRF field on the first-message form', async () => {
    // Regression: ISSUE-001 — authenticated home page chat submit fails CSRF
    // Found by /qa on 2026-04-10
    // Report: .gstack/qa-reports/qa-report-localhost-2026-04-10.md
    const body = String(await renderHomePage(testSession, 'test-csrf-token'));

    expect(body).toMatch(
      new RegExp(
        `<form[^>]*class="squire-input-dock"[^>]*action="/chat"[\\s\\S]*<input[^>]*name="${CSRF_FORM_FIELD_NAME}"[^>]*value="test-csrf-token"`,
      ),
    );
  });

  it('renders a hidden CSRF field on the follow-up form', async () => {
    // Regression: ISSUE-001 — authenticated follow-up chat submit fails CSRF
    // Found by /qa on 2026-04-10
    // Report: .gstack/qa-reports/qa-report-localhost-2026-04-10.md
    const body = String(
      await renderConversationPage({
        session: testSession,
        csrfToken: 'test-csrf-token',
        conversationId: 'conversation-123',
        messages: [],
      }),
    );

    expect(body).toMatch(
      new RegExp(
        `<form[^>]*class="squire-input-dock"[^>]*action="/chat/conversation-123/messages"[\\s\\S]*<input[^>]*name="${CSRF_FORM_FIELD_NAME}"[^>]*value="test-csrf-token"`,
      ),
    );
  });
});
