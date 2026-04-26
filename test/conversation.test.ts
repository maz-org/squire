import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateSignedCookie } from 'hono/cookie';

import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const { mockAsk } = vi.hoisted(() => ({
  mockAsk: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  ensureBootstrapStatus: vi.fn(async () => ({
    lifecycle: 'ready',
    ready: true,
    bootstrapReady: true,
    warmingUp: false,
    indexSize: 1,
    cardCount: 1,
    ruleQueriesReady: true,
    cardQueriesReady: true,
    askReady: true,
    missingBootstrapSteps: [],
    errors: [],
    capabilities: {
      rules: { allowed: true, reason: null, message: null },
      cards: { allowed: true, reason: null, message: null },
      ask: { allowed: true, reason: null, message: null },
    },
  })),
  getBootstrapStatus: vi.fn(() => ({
    lifecycle: 'ready',
    ready: true,
    warmingUp: false,
  })),
  isReady: vi.fn(() => true),
  ask: mockAsk,
  startBootstrapLifecycle: vi.fn(),
}));

vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { app } from '../src/server.ts';
import { shutdownServerPool, getDb } from '../src/db.ts';
import { createCsrfToken } from '../src/auth/csrf.ts';
import { SESSION_COOKIE_NAME, getSessionSecret } from '../src/auth/session-middleware.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { SESSION_LIFETIME_MS } from '../src/db/repositories/session-repository.ts';
import { loadConversation, loadSelectedConversation } from '../src/chat/conversation-service.ts';
import { users } from '../src/db/schema/core.ts';
import { conversations, messages } from '../src/db/schema/conversations.ts';

interface AuthContext {
  cookie: string;
  sessionId: string;
  userId: string;
}

async function createAuthContext(overrides?: {
  email?: string;
  googleSub?: string;
  name?: string | null;
}): Promise<AuthContext> {
  const { db } = getDb('server');
  const email = overrides?.email ?? 'alice@example.com';
  const googleSub = overrides?.googleSub ?? 'google-sub-alice';
  const name = overrides?.name ?? 'Alice';

  const [user] = await db
    .insert(users)
    .values({
      email,
      googleSub,
      name,
    })
    .returning();

  const { sessionId } = await SessionRepository.create(db, { userId: user.id });
  const signedCookie = await generateSignedCookie(
    SESSION_COOKIE_NAME,
    sessionId,
    getSessionSecret(),
    {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_LIFETIME_MS / 1000,
    },
  );

  return {
    cookie: signedCookie.split(';')[0],
    sessionId,
    userId: user.id,
  };
}

async function requestWithAuth(
  auth: AuthContext,
  url: string,
  init?: RequestInit & { csrf?: boolean },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', auth.cookie);
  if (init?.csrf) {
    headers.set('x-csrf-token', createCsrfToken(auth.sessionId));
  }

  return app.request(url, {
    ...init,
    headers,
  });
}

function formBody(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

function requireLocation(response: Response): string {
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  return location!;
}

async function seedConversationWithTurns(
  auth: AuthContext,
  turns: Array<{ question: string; answer?: string }>,
): Promise<{
  conversationId: string;
  userMessages: Array<{ id: string; content: string }>;
  assistantMessages: Array<{ id: string; content: string; responseToMessageId: string }>;
}> {
  const { db } = getDb('server');
  const [conversation] = await db.insert(conversations).values({ userId: auth.userId }).returning();

  const userMessages: Array<{ id: string; content: string }> = [];
  const assistantMessages: Array<{ id: string; content: string; responseToMessageId: string }> = [];
  let lastMessageAt = conversation.lastMessageAt;
  const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();
  let tick = 0;

  for (const turn of turns) {
    const userCreatedAt = new Date(baseTime + tick++ * 1000);
    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: turn.question,
        createdAt: userCreatedAt,
      })
      .returning();
    userMessages.push({ id: userMessage.id, content: userMessage.content });
    lastMessageAt = userMessage.createdAt;

    if (turn.answer !== undefined) {
      const assistantCreatedAt = new Date(baseTime + tick++ * 1000);
      const [assistantMessage] = await db
        .insert(messages)
        .values({
          conversationId: conversation.id,
          role: 'assistant',
          content: turn.answer,
          responseToMessageId: userMessage.id,
          createdAt: assistantCreatedAt,
        })
        .returning();
      assistantMessages.push({
        id: assistantMessage.id,
        content: assistantMessage.content,
        responseToMessageId: assistantMessage.responseToMessageId!,
      });
      lastMessageAt = assistantMessage.createdAt;
    }
  }

  await db
    .update(conversations)
    .set({ lastMessageAt })
    .where(sql`${conversations.id} = ${conversation.id}`);

  return {
    conversationId: conversation.id,
    userMessages,
    assistantMessages,
  };
}

function parseSse(text: string): Array<{ event: string; data: unknown }> {
  // Keep these assertions aligned with docs/SSE_CONTRACT.md, which defines the
  // browser-visible event model rather than the service's internal emit API.
  return text
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = chunk.match(/^event:\s*(.+)$/m)?.[1] ?? 'message';
      const rawData = chunk.match(/^data:\s*(.+)$/m)?.[1] ?? '{}';
      return {
        event,
        data: JSON.parse(rawData),
      };
    });
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  mockAsk.mockReset();
  vi.clearAllMocks();
});

afterAll(async () => {
  await teardownTestDb();
  await shutdownServerPool();
});

/**
 * Returns each assistant message's `consulted_sources` jsonb value,
 * ordered oldest-first. SQR-98 tests repeatedly query this column to
 * assert the footer-provenance persistence contract — this helper keeps
 * the query shape in one place so the assertion sites only own what
 * they actually care about (the expected array of source-lists).
 */
async function assistantConsultedSources(): Promise<Array<string[] | null>> {
  const { db } = getDb('server');
  const rows = await db.execute(sql`
    select consulted_sources as "consultedSources"
    from messages
    where role = 'assistant'
    order by created_at asc, id asc
  `);
  return rows.rows.map((row) => (row as { consultedSources: string[] | null }).consultedSources);
}

describe('conversation web backend', () => {
  it('creates a conversation on first message and reload restores ordered history', async () => {
    mockAsk.mockResolvedValueOnce('Loot tokens in your hex are picked up.');
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'How does looting work?',
        idempotencyKey: 'idem-1',
      }),
      redirect: 'manual',
    });

    expect(createRes.status).toBe(302);
    const location = requireLocation(createRes);
    expect(location).toMatch(/^\/chat\/[0-9a-f-]+$/);

    const pageRes = await requestWithAuth(auth, `http://localhost:3000${location}`);
    expect(pageRes.status).toBe(200);

    const page = await pageRes.text();
    expect(pageRes.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(page).toContain('class="squire-account-menu"');
    expect(page).toContain('href="/styleguide/markdown"');
    expect(page).toContain('action="/auth/logout"');
    expect(page).toContain('How does looting work?');
    expect(page).toContain('Loot tokens in your hex are picked up.');

    const { db } = getDb('server');
    const messages = await db.execute(sql`
      select role, content
      from messages
      order by created_at asc, id asc
    `);
    expect(messages.rows).toEqual([
      { role: 'user', content: 'How does looting work?' },
      { role: 'assistant', content: 'Loot tokens in your hex are picked up.' },
    ]);
  });

  it('persists consulted_sources on the non-SSE plain-form fallback path (SQR-98 regression)', async () => {
    // Regression guard from Codex review 2026-04-20: the first SQR-98 pass
    // only populated `messages.consulted_sources` from the SSE handler's
    // accumulator, so a plain-form POST to /chat (no hx-request header)
    // persisted NULL even when the agent actually consulted tools. The
    // footer then stayed blank on the redirected /chat/:id page for a
    // supported flow. Fix: capture happens inside persistAssistantOutcome,
    // so every write path produces the same provenance metadata.
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('tool_result', { name: 'search_rules', ok: true });
      await options?.emit?.('tool_call', { name: 'get_card' });
      await options?.emit?.('tool_result', { name: 'get_card', ok: true });
      await options?.emit?.('done', {});
      return 'Rulebook + card answer.';
    });

    const auth = await createAuthContext();
    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      // No `hx-request: true` — this is the non-SSE plain-form path.
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Two sources please',
        idempotencyKey: 'idem-non-sse-sources',
      }),
      redirect: 'manual',
    });
    expect(createRes.status).toBe(302);
    expect(await assistantConsultedSources()).toEqual([['search_rules', 'get_card']]);
  });

  it('excludes failed tool calls from consulted_sources on the non-SSE path', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('tool_result', { name: 'search_rules', ok: false });
      await options?.emit?.('tool_call', { name: 'get_card' });
      await options?.emit?.('tool_result', { name: 'get_card', ok: true });
      await options?.emit?.('done', {});
      return 'Recovered from rulebook failure via cards.';
    });

    const auth = await createAuthContext();
    await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ question: 'Failure fallback', idempotencyKey: 'idem-fail-fallback' }),
      redirect: 'manual',
    });

    expect(await assistantConsultedSources()).toEqual([['get_card']]);
  });

  it('retries transient transport errors on the non-SSE path (regression: SQR-98 capture wrapper)', async () => {
    // Regression: the SQR-98 capture-emit wrapper is always installed inside
    // persistAssistantOutcome, which would have silently disabled the
    // retryable-transport-error path if the retry gate kept checking emit
    // truthiness. The retry gate now checks input.onEvent === undefined
    // explicitly so the non-SSE plain-form POST path still retries once
    // on transient failures. Also asserts capturedSources is reset on retry
    // so the persisted sources reflect the successful attempt only.
    const econnreset = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    mockAsk.mockImplementationOnce(async (_question, options) => {
      // First attempt: emit a tool event (simulating a partial stream), then
      // fail with a transient error. The reset hook should drop this source.
      await options?.emit?.('tool_result', { name: 'search_rules', ok: true });
      throw econnreset;
    });
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_result', { name: 'get_card', ok: true });
      return 'Recovered after retry.';
    });

    const auth = await createAuthContext();
    const res = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ question: 'Retry me', idempotencyKey: 'idem-retry-regression' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(mockAsk).toHaveBeenCalledTimes(2);

    const { db } = getDb('server');
    const rows = await db.execute(sql`
      select content, consulted_sources as "consultedSources"
      from messages
      where role = 'assistant'
      order by created_at asc, id asc
    `);
    expect(rows.rows).toEqual([
      {
        content: 'Recovered after retry.',
        consultedSources: ['get_card'],
      },
    ]);
  });

  it('does NOT retry on the SSE path (regression: partial stream must not be silently re-run)', async () => {
    const econnreset = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    mockAsk.mockImplementationOnce(async () => {
      throw econnreset;
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({ question: 'SSE no retry', idempotencyKey: 'idem-sse-no-retry' }),
    });
    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    await streamRes.text();

    // Exactly one ask — the SSE path must not silently retry a partial stream.
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('leaves consulted_sources NULL when the agent used no tools', async () => {
    mockAsk.mockResolvedValueOnce('Tool-free direct answer.');

    const auth = await createAuthContext();
    await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ question: 'No tools', idempotencyKey: 'idem-no-tools' }),
      redirect: 'manual',
    });

    expect(await assistantConsultedSources()).toEqual([null]);
  });

  it("returns 404 when one user requests another user's conversation URL", async () => {
    mockAsk.mockResolvedValueOnce('First answer.');
    const owner = await createAuthContext();
    const intruder = await createAuthContext({
      email: 'mallory@example.com',
      googleSub: 'google-sub-mallory',
      name: 'Mallory',
    });

    const createRes = await requestWithAuth(owner, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Owner-only question',
        idempotencyKey: 'idem-owner',
      }),
      redirect: 'manual',
    });

    const location = requireLocation(createRes);
    const intruderRes = await requestWithAuth(intruder, `http://localhost:3000${location}`);
    expect(intruderRes.status).toBe(404);
  });

  it('renders the conversation page as a full scrolling transcript with no recent-questions chrome (SQR-108 / ADR 0012)', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'How does looting work?', answer: 'Loot tokens in your hex are picked up.' },
      { question: 'When do elements wane?', answer: 'At end of round.' },
    ]);

    const pageRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}`,
    );

    expect(pageRes.status).toBe(200);

    const page = await pageRes.text();
    const transcript = page.match(/<section[^>]*class="squire-transcript"[\s\S]*?<\/section>/)?.[0];
    expect(transcript).toMatch(/role="log"/);
    expect(transcript).toMatch(/aria-live="polite"/);
    // ADR 0012: every persisted turn is visible — no current-turn focus.
    expect(transcript).toContain('How does looting work?');
    expect(transcript).toContain('Loot tokens in your hex are picked up.');
    expect(transcript).toContain('When do elements wane?');
    expect(transcript).toContain('At end of round.');
    // Oldest-to-newest ordering drives the position-based drop cap selector.
    expect(transcript!.indexOf('Loot tokens in your hex are picked up.')).toBeLessThan(
      transcript!.indexOf('At end of round.'),
    );
    // No recent-questions chip rail anywhere on the page (D-6 / E-3).
    expect(page).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
    expect(page).not.toMatch(/class="squire-recent"/);
    // No desktop rail aside on the conversation page (D-6).
    expect(page).not.toMatch(/<aside[^>]*class="squire-rail"/);
  });

  it('renders the input dock with append-fragment HTMX swap on the conversation page', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Only question', answer: 'Only answer' },
    ]);

    const pageRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}`,
    );
    expect(pageRes.status).toBe(200);

    const page = await pageRes.text();
    expect(page).toMatch(
      new RegExp(
        `<form[^>]*class="squire-input-dock"[^>]*action="/chat/${seeded.conversationId}/messages"`,
      ),
    );
    expect(page).toMatch(/hx-target="\.squire-transcript"/);
    expect(page).toMatch(/hx-swap="beforeend"/);
  });

  it('renders the canonical selected-message page for the conversation owner', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'How does looting work?', answer: 'Loot tokens in your hex are picked up.' },
      { question: 'When do elements wane?', answer: 'At end of round.' },
    ]);

    const pageRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages/${seeded.userMessages[0]!.id}`,
    );

    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get('cache-control')).toBe('no-store');
    expect(pageRes.headers.get('vary')).toBe('Cookie');

    const page = await pageRes.text();
    expect(page).toContain('class="squire-account-menu"');
    expect(page).toContain('href="/styleguide/markdown"');
    const transcript = page.match(/<section[^>]*squire-transcript[^>]*>[\s\S]*?<\/section>/)?.[0];
    expect(transcript).toContain('How does looting work?');
    expect(transcript).toContain('Loot tokens in your hex are picked up.');
    expect(transcript).toContain('EARLIER QUESTION');
    expect(transcript).not.toContain('When do elements wane?');
    expect(transcript).not.toContain('At end of round.');
    const recentNav = page.match(/<nav[^>]*id="squire-recent-questions"[\s\S]*?<\/nav>/)?.[0];
    expect(recentNav).toContain('When do elements wane?');
    expect(recentNav).not.toContain('How does looting work?');
    expect(recentNav).toContain('hx-get="/chat/');
    expect(recentNav).toContain('hx-push-url="true"');
  });

  it('renders prior turns plus a pending answer skeleton when the canonical page has an in-flight turn (SQR-108)', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'How does looting work?', answer: 'Loot tokens in your hex are picked up.' },
      { question: 'When do elements wane?', answer: 'At end of round.' },
      { question: 'Can I loot through a wall?' },
    ]);

    const pageRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}`,
    );

    expect(pageRes.status).toBe(200);

    const page = await pageRes.text();
    const transcript = page.match(/<section[^>]*class="squire-transcript"[\s\S]*?<\/section>/)?.[0];
    // All prior turns visible alongside the pending one.
    expect(transcript).toContain('How does looting work?');
    expect(transcript).toContain('Loot tokens in your hex are picked up.');
    expect(transcript).toContain('When do elements wane?');
    expect(transcript).toContain('At end of round.');
    expect(transcript).toContain('Can I loot through a wall?');
    expect(transcript).toContain('class="squire-answer__skeleton"');
    // The pending answer carries the stream URL on the article itself
    // (the wrapping `.squire-transcript--pending` class is gone — the
    // transcript stays as one permanent live-region container).
    expect(transcript).toMatch(
      new RegExp(
        `squire-answer--pending[^>]*data-stream-url="/chat/${seeded.conversationId}/messages/${seeded.userMessages[2]!.id}/stream"`,
      ),
    );
    expect(page).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
  });

  it('does NOT render a pending skeleton when the latest turn is an error assistant reply (SQR-108 regression)', async () => {
    // Pre-PR latent bug: the GET handler keyed only on "is there a latest
    // user message" and always rendered a stream URL — so loading a
    // finalized conversation whose final turn errored would re-attach an
    // EventSource and re-trigger the SSE error path on every page load.
    // Error assistant rows are persisted as `role: 'assistant', isError: true`
    // with `responseToMessageId` set to the user message they answered;
    // computePendingStreamUrl in src/server.ts must treat that as a reply
    // and skip the skeleton.
    const auth = await createAuthContext();
    const { db } = getDb('server');
    const [conversation] = await db
      .insert(conversations)
      .values({ userId: auth.userId })
      .returning();
    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Will this fail?',
      })
      .returning();
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: "I hit an error and couldn't answer that. Please try again.",
      isError: true,
      responseToMessageId: userMessage.id,
    });

    const pageRes = await requestWithAuth(auth, `http://localhost:3000/chat/${conversation.id}`);
    expect(pageRes.status).toBe(200);

    const page = await pageRes.text();
    expect(page).not.toMatch(/squire-answer--pending/);
    expect(page).not.toMatch(/data-stream-url=/);
    // The error reply is still visible in the transcript.
    expect(page).toContain('I hit an error and couldn&#39;t answer that. Please try again.');
  });

  it('renders the canonical selected-message route as an HTMX fragment', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'What does muddle do?', answer: 'It forces disadvantage on attacks.' },
      { question: 'What does strengthen do?', answer: 'It grants advantage on attacks.' },
    ]);

    const fragmentRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages/${seeded.userMessages[1]!.id}`,
      {
        headers: { 'hx-request': 'true' },
      },
    );

    expect(fragmentRes.status).toBe(200);
    expect(fragmentRes.headers.get('cache-control')).toBe('no-store');
    expect(fragmentRes.headers.get('vary')).toBe('Cookie');

    const fragment = await fragmentRes.text();
    const transcript = fragment.match(
      /<section[^>]*class="squire-transcript"[\s\S]*?<\/section>/,
    )?.[0];
    expect(transcript).toContain('What does strengthen do?');
    expect(transcript).toContain('It grants advantage on attacks.');
    expect(transcript).not.toContain('EARLIER QUESTION');
    expect(fragment).not.toContain('<!doctype html>');
    const recentNav = fragment.match(/<nav[^>]*id="squire-recent-questions"[\s\S]*?<\/nav>/)?.[0];
    expect(recentNav).toContain('hx-swap-oob="outerHTML"');
    expect(recentNav).toContain('What does muddle do?');
    expect(recentNav).not.toContain('What does strengthen do?');
    expect(recentNav).toContain('hx-get="/chat/');
    expect(recentNav).toContain('hx-push-url="true"');
  });

  it("returns 404 when one user requests another user's selected-message URL", async () => {
    const owner = await createAuthContext();
    const intruder = await createAuthContext({
      email: 'mallory@example.com',
      googleSub: 'google-sub-mallory',
      name: 'Mallory',
    });
    const seeded = await seedConversationWithTurns(owner, [
      { question: 'Owner-only question', answer: 'Owner-only answer.' },
    ]);

    const response = await requestWithAuth(
      intruder,
      `http://localhost:3000/chat/${seeded.conversationId}/messages/${seeded.userMessages[0]!.id}`,
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when the selected-message URL targets an assistant message id', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Question', answer: 'Answer' },
    ]);

    const response = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages/${seeded.assistantMessages[0]!.id}`,
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when the selected-message URL mixes conversation and message ids', async () => {
    const auth = await createAuthContext();
    const firstConversation = await seedConversationWithTurns(auth, [
      { question: 'First question', answer: 'First answer' },
    ]);
    const secondConversation = await seedConversationWithTurns(auth, [
      { question: 'Second question', answer: 'Second answer' },
    ]);

    const response = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${firstConversation.conversationId}/messages/${secondConversation.userMessages[0]!.id}`,
    );

    expect(response.status).toBe(404);
  });

  it('pushes the canonical conversation URL when posting a follow-up from a selected-message page', async () => {
    // The legacy `/chat/:id/messages/:mid` route ships until PR 3. Until
    // then, follow-up posts from there still set HX-Push-Url so the URL
    // bar moves back to the canonical conversation. This PR drops the
    // out-of-band recent-questions nav refresh — the response is now an
    // append-fragment instead.
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'First question', answer: 'First answer' },
      { question: 'Second question', answer: 'Second answer' },
    ]);

    const response = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
          'hx-current-url': `http://localhost:3000/chat/${seeded.conversationId}/messages/${seeded.userMessages[0]!.id}`,
        },
        body: formBody({ question: 'Newest question' }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('HX-Push-Url')).toBe(`/chat/${seeded.conversationId}`);
    const body = await response.text();
    expect(body).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
  });

  it('returns an append-fragment (new question + pending answer skeleton) for HTMX follow-ups (SQR-108 E-3)', async () => {
    // Regression baseline: ISSUE-001 — selected-message follow-up fell
    // back to transcript mode. SQR-108 / ADR 0012: the follow-up POST
    // returns ONLY the new question + pending answer skeleton (no
    // wrapping `<section class="squire-transcript">`), and the client
    // appends them via `hx-swap="beforeend"`.
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'First question', answer: 'First answer' },
      { question: 'Second question', answer: 'Second answer' },
    ]);

    const response = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
          'hx-current-url': `http://localhost:3000/chat/${seeded.conversationId}`,
        },
        body: formBody({ question: 'Newest question' }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    // The fragment is just the two new articles — no wrapping
    // `.squire-transcript` section, no recent-questions nav.
    expect(body).not.toMatch(/<section[^>]*class="squire-transcript/);
    expect(body).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
    expect(body).toContain('Newest question');
    expect(body).toMatch(/<article[^>]*class="squire-turn squire-question"[^>]*>/);
    expect(body).toMatch(
      new RegExp(
        `squire-answer--pending[^>]*data-stream-url="/chat/${seeded.conversationId}/messages/[0-9a-f-]+/stream"`,
      ),
    );
    // None of the prior persisted turns appear in the fragment — they
    // already live in the existing transcript and would duplicate.
    expect(body).not.toContain('First question');
    expect(body).not.toContain('First answer');
    expect(body).not.toContain('Second question');
    expect(body).not.toContain('Second answer');
  });

  // SQR-108: the second-turn submit append regression. Catches the
  // `chat-ui-qa-must-include-second-turn-submit` learning at the API
  // level — submitting a second follow-up to an already-active conversation
  // must produce an append-fragment, not a full transcript replacement,
  // so the client `hx-swap="beforeend"` adds one new turn cleanly.
  it('returns an append-fragment on the SECOND HTMX follow-up — does not replace existing transcript chrome (SQR-108 regression)', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'First question', answer: 'First answer' },
      { question: 'Second question', answer: 'Second answer' },
    ]);

    const firstFollowUp = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        body: formBody({ question: 'Third question' }),
      },
    );
    expect(firstFollowUp.status).toBe(200);
    const firstBody = await firstFollowUp.text();
    expect(firstBody).not.toMatch(/<section[^>]*class="squire-transcript/);
    expect(firstBody).toContain('Third question');

    const secondFollowUp = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        body: formBody({ question: 'Fourth question' }),
      },
    );
    expect(secondFollowUp.status).toBe(200);
    const secondBody = await secondFollowUp.text();
    // Same shape as the first follow-up: no transcript wrapper, no
    // recent-questions nav, just the new turn.
    expect(secondBody).not.toMatch(/<section[^>]*class="squire-transcript/);
    expect(secondBody).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
    expect(secondBody).toContain('Fourth question');
    expect(secondBody).toMatch(/<article[^>]*class="squire-turn squire-question"[^>]*>/);
    expect(secondBody).toMatch(
      new RegExp(
        `squire-answer--pending[^>]*data-stream-url="/chat/${seeded.conversationId}/messages/[0-9a-f-]+/stream"`,
      ),
    );
  });

  it('streams the SSE done event without recentQuestionsNavHtml after SQR-108', async () => {
    mockAsk.mockResolvedValueOnce('Third answer.');
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'First question', answer: 'First answer' },
      { question: 'Second question', answer: 'Second answer' },
    ]);

    const response = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${seeded.conversationId}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        body: formBody({ question: 'Third question' }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    const events = parseSse(await streamRes.text());
    const doneEvent = events.at(-1);
    expect(doneEvent?.event).toBe('done');
    const doneData = doneEvent?.data as Record<string, unknown>;
    expect(doneData).not.toHaveProperty('recentQuestionsNavHtml');
    expect(doneData.html).toBe('<p>Third answer.</p>\n');
  });

  it('persists the user turn and a generic assistant failure turn when ask fails', async () => {
    mockAsk.mockRejectedValueOnce(new Error('upstream exploded'));
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Will this fail?',
        idempotencyKey: 'idem-failure',
      }),
      redirect: 'manual',
    });

    expect(createRes.status).toBe(302);
    const location = requireLocation(createRes);

    const pageRes = await requestWithAuth(auth, `http://localhost:3000${location}`);
    const page = await pageRes.text();
    expect(page).toContain('Will this fail?');
    expect(page).toContain('I hit an error and couldn&#39;t answer that. Please try again.');

    const { db } = getDb('server');
    const messages = await db.execute(sql`
      select role, content
      from messages
      order by created_at asc, id asc
    `);
    expect(messages.rows).toEqual([
      { role: 'user', content: 'Will this fail?' },
      {
        role: 'assistant',
        content: "I hit an error and couldn't answer that. Please try again.",
      },
    ]);
  });

  it('forwards prior stored history unchanged on follow-up messages', async () => {
    mockAsk.mockResolvedValueOnce('First answer.').mockResolvedValueOnce('Second answer.');
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'First question',
        idempotencyKey: 'idem-history',
      }),
      redirect: 'manual',
    });
    const location = requireLocation(createRes);

    const followUpRes = await requestWithAuth(auth, `http://localhost:3000${location}/messages`, {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Second question',
      }),
      redirect: 'manual',
    });

    expect(followUpRes.status).toBe(302);
    expect(mockAsk).toHaveBeenNthCalledWith(2, 'Second question', {
      history: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer.' },
      ],
      userId: auth.userId,
      // SQR-98: persistAssistantOutcome always installs an emit wrapper
      // that captures consulted_sources, so `ask()` now receives a
      // function here on every path (SSE or not).
      emit: expect.any(Function),
    });
  });

  it('reuses the same conversation for repeated first-send idempotency keys', async () => {
    mockAsk.mockResolvedValue('One answer only.');
    const auth = await createAuthContext();

    const firstRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Start one conversation',
        idempotencyKey: 'idem-repeat',
      }),
      redirect: 'manual',
    });
    const secondRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Start one conversation',
        idempotencyKey: 'idem-repeat',
      }),
      redirect: 'manual',
    });

    expect(requireLocation(firstRes)).toBe(requireLocation(secondRes));
    expect(mockAsk).toHaveBeenCalledTimes(1);

    const { db } = getDb('server');
    const conversationCount = await db.execute(
      sql`select count(*)::int as count from conversations`,
    );
    const messageCount = await db.execute(sql`select count(*)::int as count from messages`);
    expect(conversationCount.rows[0].count).toBe(1);
    expect(messageCount.rows[0].count).toBe(2);
  });

  it('serializes same-key first-send retries behind the in-flight assistant generation', async () => {
    let resolveFirstAsk!: (value: string) => void;
    const firstAsk = new Promise<string>((resolve) => {
      resolveFirstAsk = resolve;
    });

    mockAsk.mockImplementationOnce(() => firstAsk);
    const auth = await createAuthContext();

    const firstResPromise = requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Start one conversation',
        idempotencyKey: 'idem-repair',
      }),
      redirect: 'manual',
    });

    const { db } = getDb('server');
    await vi.waitFor(async () => {
      const count = await db.execute(sql`select count(*)::int as count from messages`);
      expect(count.rows[0].count).toBe(1);
    });

    const retryResPromise = requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Start one conversation',
        idempotencyKey: 'idem-repair',
      }),
      redirect: 'manual',
    });

    await vi.waitFor(() => {
      expect(mockAsk).toHaveBeenCalledTimes(1);
    });

    resolveFirstAsk('Recovered answer.');

    const retryRes = await retryResPromise;
    expect(retryRes.status).toBe(302);
    const location = requireLocation(retryRes);

    const pageRes = await requestWithAuth(auth, `http://localhost:3000${location}`);
    const page = await pageRes.text();
    expect(page).toContain('Recovered answer.');

    await firstResPromise;

    const storedMessages = await db.execute(sql`
      select role, content
      from messages
      order by created_at asc, id asc
    `);
    expect(storedMessages.rows).toEqual([
      { role: 'user', content: 'Start one conversation' },
      { role: 'assistant', content: 'Recovered answer.' },
    ]);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('repairs a stranded classic first-send retry after only the user turn was persisted', async () => {
    mockAsk.mockResolvedValueOnce('Recovered after retry.');
    const auth = await createAuthContext();
    const { db } = getDb('server');

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: auth.userId,
        creationIdempotencyKey: 'idem-stranded-classic',
      })
      .returning();

    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Stranded question',
      })
      .returning();

    await db
      .update(conversations)
      .set({ lastMessageAt: userMessage.createdAt })
      .where(sql`${conversations.id} = ${conversation.id}`);

    const retryRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Stranded question',
        idempotencyKey: 'idem-stranded-classic',
      }),
      redirect: 'manual',
    });

    expect(retryRes.status).toBe(302);
    expect(requireLocation(retryRes)).toBe(`/chat/${conversation.id}`);
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(mockAsk).toHaveBeenCalledWith('Stranded question', {
      history: [],
      userId: auth.userId,
      emit: expect.any(Function),
    });

    const storedMessages = await db.execute(sql`
      select role, content, response_to_message_id as "responseToMessageId"
      from messages
      order by created_at asc, id asc
    `);
    expect(storedMessages.rows).toEqual([
      { role: 'user', content: 'Stranded question', responseToMessageId: null },
      {
        role: 'assistant',
        content: 'Recovered after retry.',
        responseToMessageId: userMessage.id,
      },
    ]);
  });

  it('repairs a stranded HTMX first send by returning a pending shell and completing the stream', async () => {
    mockAsk.mockResolvedValueOnce('Recovered over SSE.');
    const auth = await createAuthContext();
    const { db } = getDb('server');

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: auth.userId,
        creationIdempotencyKey: 'idem-stranded-htmx',
      })
      .returning();

    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Recover this pending turn',
      })
      .returning();

    await db
      .update(conversations)
      .set({ lastMessageAt: userMessage.createdAt })
      .where(sql`${conversations.id} = ${conversation.id}`);

    const retryRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Recover this pending turn',
        idempotencyKey: 'idem-stranded-htmx',
      }),
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.headers.get('HX-Push-Url')).toBe(`/chat/${conversation.id}`);
    const body = await retryRes.text();
    expect(body).toContain('Recover this pending turn');
    expect(body).toContain(
      `data-stream-url="/chat/${conversation.id}/messages/${userMessage.id}/stream"`,
    );

    const streamRes = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${conversation.id}/messages/${userMessage.id}/stream`,
    );
    expect(streamRes.status).toBe(200);
    expect(parseSse(await streamRes.text())).toEqual([
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>Recovered over SSE.</p>\n',
        }),
      },
    ]);

    const storedMessages = await db.execute(sql`
      select role, content, response_to_message_id as "responseToMessageId"
      from messages
      order by created_at asc, id asc
    `);
    expect(storedMessages.rows).toEqual([
      { role: 'user', content: 'Recover this pending turn', responseToMessageId: null },
      {
        role: 'assistant',
        content: 'Recovered over SSE.',
        responseToMessageId: userMessage.id,
      },
    ]);
  });

  it('does not duplicate the assistant turn across repeated same-key recovery attempts', async () => {
    mockAsk.mockResolvedValueOnce('One repaired answer.');
    const auth = await createAuthContext();
    const { db } = getDb('server');

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: auth.userId,
        creationIdempotencyKey: 'idem-repair-repeat',
      })
      .returning();

    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Recover me once',
      })
      .returning();

    await db
      .update(conversations)
      .set({ lastMessageAt: userMessage.createdAt })
      .where(sql`${conversations.id} = ${conversation.id}`);

    const firstRetry = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Recover me once',
        idempotencyKey: 'idem-repair-repeat',
      }),
      redirect: 'manual',
    });
    const secondRetry = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Recover me once',
        idempotencyKey: 'idem-repair-repeat',
      }),
      redirect: 'manual',
    });

    expect(firstRetry.status).toBe(302);
    expect(secondRetry.status).toBe(302);
    expect(requireLocation(firstRetry)).toBe(`/chat/${conversation.id}`);
    expect(requireLocation(secondRetry)).toBe(`/chat/${conversation.id}`);
    expect(mockAsk).toHaveBeenCalledTimes(1);

    const assistantMessages = await db.execute(sql`
      select id, content, response_to_message_id as "responseToMessageId"
      from messages
      where role = 'assistant'
      order by created_at asc, id asc
    `);
    expect(assistantMessages.rows).toEqual([
      {
        id: assistantMessages.rows[0].id,
        content: 'One repaired answer.',
        responseToMessageId: userMessage.id,
      },
    ]);
  });

  it('reuses an already-persisted assistant response without calling ask again', async () => {
    const { streamAssistantTurn } = await import('../src/chat/conversation-service.ts');
    const auth = await createAuthContext();
    const { db } = getDb('server');

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: auth.userId,
      })
      .returning();

    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Existing question',
      })
      .returning();

    const [assistantMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Existing answer',
        responseToMessageId: userMessage.id,
      })
      .returning();

    const onEvent = vi.fn();
    const result = await streamAssistantTurn({
      conversationId: conversation.id,
      question: userMessage.content,
      userId: auth.userId,
      currentUserMessageId: userMessage.id,
      onEvent,
    });

    expect(result.id).toBe(assistantMessage.id);
    expect(result.content).toBe('Existing answer');
    expect(onEvent).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('caps forwarded history to the most recent 20 non-error messages', async () => {
    mockAsk.mockResolvedValueOnce('Capped answer.');
    const auth = await createAuthContext();
    const { db } = getDb('server');

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: auth.userId,
      })
      .returning();

    const baseTime = new Date('2026-04-10T10:00:00.000Z').getTime();
    const seededMessages = Array.from({ length: 24 }, (_, index) => ({
      conversationId: conversation.id,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Seed message ${index + 1}`,
      isError: false,
      createdAt: new Date(baseTime + index * 1000),
    }));
    await db.insert(messages).values(seededMessages);

    const res = await requestWithAuth(
      auth,
      `http://localhost:3000/chat/${conversation.id}/messages`,
      {
        method: 'POST',
        csrf: true,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formBody({ question: 'Newest question' }),
        redirect: 'manual',
      },
    );

    expect(res.status).toBe(302);
    expect(mockAsk).toHaveBeenCalledWith('Newest question', {
      history: Array.from({ length: 20 }, (_, index) => ({
        role: (index + 5) % 2 === 1 ? 'user' : 'assistant',
        content: `Seed message ${index + 5}`,
      })),
      userId: auth.userId,
      emit: expect.any(Function),
    });
  });

  it('returns a pending HTMX shell for the first turn and pushes the conversation URL', async () => {
    const auth = await createAuthContext();

    const res = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Can I loot through a doorway?',
        idempotencyKey: 'idem-htmx-first',
      }),
      redirect: 'manual',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('HX-Push-Url')).toMatch(/^\/chat\/[0-9a-f-]+$/);
    const body = await res.text();
    // SQR-108: first submit from home returns the full transcript shell
    // (a `<section class="squire-transcript">` containing one pending
    // turn) so the home-form `hx-target="#squire-surface"` swap replaces
    // the landing with the live conversation surface in one step.
    expect(body).toMatch(
      /<section[^>]*class="squire-transcript"[^>]*role="log"[^>]*aria-live="polite"/,
    );
    expect(body).toContain('Can I loot through a doorway?');
    expect(body).toMatch(
      /squire-answer--pending[^>]*data-stream-url="\/chat\/[0-9a-f-]+\/messages\/[0-9a-f-]+\/stream"/,
    );
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('streams one turn with translated SSE events and persists the final assistant answer', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('text', {
        delta: 'Loot tokens in your hex are picked up with **style**.',
      });
      await options?.emit?.('tool_result', { name: 'search_rules' });
      await options?.emit?.('done', {});
      return 'Loot tokens in your hex are picked up with **style**.';
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'How does looting work?',
        idempotencyKey: 'idem-stream-success',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-security-policy')).toBeNull();
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'tool-start',
        data: { id: 'rulebook', label: 'RULEBOOK' },
      },
      {
        event: 'text-delta',
        data: { delta: 'Loot tokens in your hex are picked up with **style**.' },
      },
      {
        event: 'tool-result',
        data: { id: 'rulebook', labels: ['RULEBOOK'], ok: true },
      },
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>Loot tokens in your hex are picked up with <strong>style</strong>.</p>\n',
        }),
      },
    ]);

    const { db } = getDb('server');
    const storedMessages = await db.execute(sql`
      select role, content, is_error as "isError"
      from messages
      order by created_at asc, id asc
    `);
    expect(storedMessages.rows).toEqual([
      { role: 'user', content: 'How does looting work?', isError: false },
      {
        role: 'assistant',
        content: 'Loot tokens in your hex are picked up with **style**.',
        isError: false,
      },
    ]);
  });

  it('reuses one tool-status id when the same tool runs multiple times in one answer', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('tool_result', { name: 'search_rules' });
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('text', {
        delta: 'You loot when the token is in your hex at end of turn.',
      });
      await options?.emit?.('tool_result', { name: 'search_rules' });
      await options?.emit?.('done', {});
      return 'You loot when the token is in your hex at end of turn.';
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'When do I loot?',
        idempotencyKey: 'idem-stream-tool-dedupe',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    expect(streamRes.status).toBe(200);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'tool-start',
        data: { id: 'rulebook', label: 'RULEBOOK' },
      },
      {
        event: 'tool-result',
        data: { id: 'rulebook', labels: ['RULEBOOK'], ok: true },
      },
      {
        event: 'tool-start',
        data: { id: 'rulebook', label: 'RULEBOOK' },
      },
      {
        event: 'text-delta',
        data: { delta: 'You loot when the token is in your hex at end of turn.' },
      },
      {
        event: 'tool-result',
        data: { id: 'rulebook', labels: ['RULEBOOK'], ok: true },
      },
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>You loot when the token is in your hex at end of turn.</p>\n',
        }),
      },
    ]);
  });

  it('reuses one tool-status id when multiple card tools share the same visible source', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_cards' });
      await options?.emit?.('tool_result', { name: 'search_cards' });
      await options?.emit?.('tool_call', { name: 'get_card' });
      await options?.emit?.('tool_result', { name: 'get_card' });
      await options?.emit?.('done', {});
      return 'Card details.';
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'What does this card do?',
        idempotencyKey: 'idem-stream-card-tool-dedupe',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    expect(streamRes.status).toBe(200);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'tool-start',
        data: { id: 'card-index', label: 'CARD INDEX' },
      },
      {
        event: 'tool-result',
        data: { id: 'card-index', labels: ['CARD INDEX'], ok: true },
      },
      {
        event: 'tool-start',
        data: { id: 'card-index', label: 'CARD INDEX' },
      },
      {
        event: 'tool-result',
        data: { id: 'card-index', labels: ['CARD INDEX'], ok: true },
      },
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>Card details.</p>\n',
        }),
      },
    ]);
  });

  it('renders persisted hostile assistant content as inert text on reload', async () => {
    mockAsk.mockResolvedValueOnce(
      '<script>alert(1)</script>[click](javascript:alert(1))<img src=x onerror=alert(1)>',
    );
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Is this safe?',
        idempotencyKey: 'idem-xss-reload',
      }),
      redirect: 'manual',
    });

    const location = requireLocation(createRes);
    const pageRes = await requestWithAuth(auth, `http://localhost:3000${location}`);
    const page = await pageRes.text();

    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).not.toContain('<img');
    expect(page).not.toContain('href="javascript:');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps hostile streamed content inert until the final sanitized done fragment', async () => {
    const hostile =
      '<script>alert(1)</script>[click](javascript:alert(1))<img src=x onerror=alert(1)>';
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('text', { delta: hostile });
      await options?.emit?.('done', {});
      return hostile;
    });

    const auth = await createAuthContext();
    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Stream hostile content',
        idempotencyKey: 'idem-xss-stream',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'text-delta',
        data: { delta: hostile },
      },
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>&lt;script&gt;alert(1)&lt;/script&gt;[click](javascript:alert(1))&lt;img src=x onerror=alert(1)&gt;</p>\n',
        }),
      },
    ]);
  });

  it('returns 404 for GET /chat because only conversation-specific pages are routable', async () => {
    const auth = await createAuthContext();
    const pageRes = await requestWithAuth(auth, 'http://localhost:3000/chat');
    expect(pageRes.status).toBe(404);
  });

  it('returns only the new pending turn for HTMX follow-ups', async () => {
    mockAsk.mockResolvedValueOnce('First answer.');
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'First question',
        idempotencyKey: 'idem-htmx-follow-up',
      }),
      redirect: 'manual',
    });
    const location = requireLocation(createRes);

    const followUpRes = await requestWithAuth(auth, `http://localhost:3000${location}/messages`, {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Second question',
      }),
    });

    expect(followUpRes.status).toBe(200);
    const body = await followUpRes.text();
    // SQR-108: HTMX follow-ups return an append-fragment (just the new
    // question + pending answer skeleton). No wrapping `.squire-transcript`
    // and no recent-questions nav — the form's `hx-swap="beforeend"` adds
    // these articles to the existing transcript on the page.
    expect(body).not.toMatch(/<section[^>]*class="squire-transcript"/);
    expect(body).not.toMatch(/<nav[^>]*id="squire-recent-questions"/);
    expect(body).toContain('Second question');
    expect(body).toMatch(/<article[^>]*class="squire-turn squire-question"[^>]*>/);
    expect(body).toMatch(
      /squire-answer--pending[^>]*data-stream-url="\/chat\/[0-9a-f-]+\/messages\/[0-9a-f-]+\/stream"/,
    );
    expect(body).not.toContain('First question');
    expect(body).not.toContain('First answer.');
  });

  it('propagates failed tool results into the browser-facing SSE payload', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('tool_call', { name: 'search_rules' });
      await options?.emit?.('tool_result', { name: 'search_rules', ok: false });
      await options?.emit?.('done', {});
      return 'Fallback answer.';
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Question with tool failure',
        idempotencyKey: 'idem-tool-failure',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'tool-start',
        data: { id: 'rulebook', label: 'RULEBOOK' },
      },
      {
        event: 'tool-result',
        data: { id: 'rulebook', labels: ['RULEBOOK'], ok: false },
      },
      {
        event: 'done',
        data: expect.objectContaining({
          html: '<p>Fallback answer.</p>\n',
        }),
      },
    ]);
  });

  it('emits a bootstrap error before streaming and does not persist an assistant turn', async () => {
    const { ensureBootstrapStatus } = await import('../src/service.ts');
    vi.mocked(ensureBootstrapStatus).mockResolvedValueOnce({
      lifecycle: 'warming_up',
      ready: false,
      bootstrapReady: true,
      warmingUp: true,
      indexSize: 1,
      cardCount: 1,
      ruleQueriesReady: true,
      cardQueriesReady: true,
      askReady: false,
      missingBootstrapSteps: [],
      errors: [],
      capabilities: {
        rules: { allowed: true, reason: null, message: null },
        cards: { allowed: true, reason: null, message: null },
        ask: {
          allowed: false,
          reason: 'warming_up',
          message: 'Service is warming up. Retry in a moment.',
        },
      },
    });

    const auth = await createAuthContext();
    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Will this wait?',
        idempotencyKey: 'idem-stream-bootstrap',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'error',
        data: {
          kind: 'bootstrap',
          message: 'Service is warming up. Retry in a moment.',
          recoverable: true,
        },
      },
    ]);
    expect(mockAsk).not.toHaveBeenCalled();

    const { db } = getDb('server');
    const storedMessages = await db.execute(sql`
      select role, content
      from messages
      order by created_at asc, id asc
    `);
    expect(storedMessages.rows).toEqual([{ role: 'user', content: 'Will this wait?' }]);
  });

  it('rejects SSE stream requests that target an assistant message id', async () => {
    mockAsk.mockResolvedValueOnce('Assistant answer.');
    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        question: 'Original question',
        idempotencyKey: 'idem-assistant-stream-reject',
      }),
      redirect: 'manual',
    });
    const location = requireLocation(createRes);

    const { db } = getDb('server');
    const storedBefore = await db.execute(sql`
      select id, role, content
      from messages
      order by created_at asc, id asc
    `);
    const assistantMessageId = storedBefore.rows.find((row) => row.role === 'assistant')?.id;
    expect(assistantMessageId).toBeTruthy();

    mockAsk.mockClear();

    const streamRes = await requestWithAuth(
      auth,
      `http://localhost:3000${location}/messages/${assistantMessageId}/stream`,
    );
    expect(streamRes.status).toBe(404);
    expect(mockAsk).not.toHaveBeenCalled();

    const storedAfter = await db.execute(sql`
      select role, content
      from messages
      order by created_at asc, id asc
    `);
    expect(storedAfter.rows).toEqual([
      { role: 'user', content: 'Original question' },
      { role: 'assistant', content: 'Assistant answer.' },
    ]);
  });

  it('does not retry a streamed ask after a retryable transport failure', async () => {
    mockAsk.mockImplementationOnce(async (_question, options) => {
      await options?.emit?.('text', { delta: 'Partial answer.' });
      const err = new Error('socket timed out') as Error & { code?: string };
      err.code = 'ETIMEDOUT';
      throw err;
    });

    const auth = await createAuthContext();

    const createRes = await requestWithAuth(auth, 'http://localhost:3000/chat', {
      method: 'POST',
      csrf: true,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      body: formBody({
        question: 'Question with partial stream failure',
        idempotencyKey: 'idem-stream-no-retry',
      }),
    });

    const body = await createRes.text();
    const streamUrl = body.match(/data-stream-url="([^"]+)"/)?.[1];
    expect(streamUrl).toBeTruthy();

    const streamRes = await requestWithAuth(auth, `http://localhost:3000${streamUrl}`);
    const events = parseSse(await streamRes.text());
    expect(events).toEqual([
      {
        event: 'text-delta',
        data: { delta: 'Partial answer.' },
      },
      {
        event: 'error',
        data: {
          kind: 'transport',
          message: 'Trouble connecting. Please try again.',
          recoverable: true,
        },
      },
    ]);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });
});

describe('selected-message projection', () => {
  it('returns the selected completed turn and recent completed questions newest-to-oldest', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Oldest completed question', answer: 'Oldest completed answer' },
      { question: 'Middle completed question', answer: 'Middle completed answer' },
      { question: 'Newest completed question', answer: 'Newest completed answer' },
      { question: 'Pending question only' },
    ]);

    const projection = await loadSelectedConversation({
      conversationId: seeded.conversationId,
      messageId: seeded.userMessages[1]!.id,
      userId: auth.userId,
    });

    expect(projection).not.toBeNull();
    expect(projection?.selectedTurn.userMessage.content).toBe('Middle completed question');
    expect(projection?.selectedTurn.assistantMessage.content).toBe('Middle completed answer');
    expect(projection?.selectedTurn.isEarlierQuestion).toBe(true);
    expect(projection?.recentQuestions.map((question) => question.messageId)).toEqual([
      seeded.userMessages[2]!.id,
      seeded.userMessages[0]!.id,
    ]);
    expect(projection?.recentQuestions.map((question) => question.question)).toEqual([
      'Newest completed question',
      'Oldest completed question',
    ]);
  });

  it('returns no recent questions when there are no other completed questions', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Only completed question', answer: 'Only completed answer' },
      { question: 'Still pending' },
    ]);

    const projection = await loadSelectedConversation({
      conversationId: seeded.conversationId,
      messageId: seeded.userMessages[0]!.id,
      userId: auth.userId,
    });

    expect(projection).not.toBeNull();
    expect(projection?.selectedTurn.isEarlierQuestion).toBe(true);
    expect(projection?.recentQuestions).toEqual([]);
  });

  it('excludes error assistant turns from selected-message history', async () => {
    const auth = await createAuthContext();
    const { db } = getDb('server');
    const [conversation] = await db
      .insert(conversations)
      .values({ userId: auth.userId })
      .returning();

    const [olderUserMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Older completed question',
      })
      .returning();
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Older completed answer',
      responseToMessageId: olderUserMessage.id,
    });
    const [failedUserMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Failed question',
      })
      .returning();
    const [failedAssistantMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        content: 'I hit an error and could not answer that.',
        isError: true,
        responseToMessageId: failedUserMessage.id,
      })
      .returning();

    await db
      .update(conversations)
      .set({ lastMessageAt: failedAssistantMessage.createdAt })
      .where(sql`${conversations.id} = ${conversation.id}`);

    const selectedFailedTurn = await loadSelectedConversation({
      conversationId: conversation.id,
      messageId: failedUserMessage.id,
      userId: auth.userId,
    });
    expect(selectedFailedTurn).toBeNull();

    const projection = await loadSelectedConversation({
      conversationId: conversation.id,
      messageId: olderUserMessage.id,
      userId: auth.userId,
    });

    expect(projection).not.toBeNull();
    expect(projection?.recentQuestions).toEqual([]);
  });

  it('marks the latest completed turn as earlier when a newer user question is pending', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Oldest completed question', answer: 'Oldest completed answer' },
      { question: 'Latest completed question', answer: 'Latest completed answer' },
      { question: 'Newest pending question' },
    ]);

    const projection = await loadSelectedConversation({
      conversationId: seeded.conversationId,
      messageId: seeded.userMessages[1]!.id,
      userId: auth.userId,
    });

    expect(projection).not.toBeNull();
    expect(projection?.selectedTurn.isEarlierQuestion).toBe(true);
    expect(projection?.recentQuestions.map((question) => question.messageId)).toEqual([
      seeded.userMessages[0]!.id,
    ]);
  });

  it('keeps all other completed turns available for recent-question overflow', async () => {
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Question 1', answer: 'Answer 1' },
      { question: 'Question 2', answer: 'Answer 2' },
      { question: 'Question 3', answer: 'Answer 3' },
      { question: 'Question 4', answer: 'Answer 4' },
      { question: 'Question 5', answer: 'Answer 5' },
      { question: 'Question 6', answer: 'Answer 6' },
      { question: 'Question 7', answer: 'Answer 7' },
    ]);

    const projection = await loadSelectedConversation({
      conversationId: seeded.conversationId,
      messageId: seeded.userMessages[0]!.id,
      userId: auth.userId,
    });

    expect(projection).not.toBeNull();
    expect(projection?.recentQuestions.map((question) => question.question)).toEqual([
      'Question 7',
      'Question 6',
      'Question 5',
      'Question 4',
      'Question 3',
      'Question 2',
    ]);
  });

  it('pads the load window when the limit cuts between a user message and its assistant reply (CR PR #274)', async () => {
    // Without padding, a window that starts at an assistant message whose
    // paired user is older than the cap would silently drop the assistant
    // from the rendered transcript (`pairConversationTurns` keys assistants
    // by responseToMessageId and only emits pairs whose user is in the
    // slice). loadConversation prepends the missing user so the pair
    // stays whole.
    const auth = await createAuthContext();
    const seeded = await seedConversationWithTurns(auth, [
      { question: 'Question 1', answer: 'Answer 1' },
      { question: 'Question 2', answer: 'Answer 2' },
      { question: 'Question 3', answer: 'Answer 3' },
    ]);

    // 6 messages total in chronological order: U1 A1 U2 A2 U3 A3.
    // Limit 5 keeps the newest 5: A1 U2 A2 U3 A3 — A1 is orphaned (its
    // user U1 is outside the window). The pad should restore U1.
    const loaded = await loadConversation({
      conversationId: seeded.conversationId,
      userId: auth.userId,
      limit: 5,
    });

    expect(loaded).not.toBeNull();
    const contents = loaded!.messages.map((m) => m.content);
    expect(contents).toEqual([
      'Question 1',
      'Answer 1',
      'Question 2',
      'Answer 2',
      'Question 3',
      'Answer 3',
    ]);
  });

  it('pads the load window with EVERY missing user when multiple assistants are orphaned (CR PR #274 round 2)', async () => {
    // Out-of-order persistence: imagine U1 streamed slowly, U2 was sent
    // before A1 finished, then A1 and A2 land in close succession. Raw
    // chronological order is U1 U2 A1 A2 — limit 2 returns the newest 2,
    // [A1, A2], with BOTH user pairs outside the window. Padding must
    // restore both U1 AND U2.
    const auth = await createAuthContext();

    // Seed a conversation with explicit interleaved-then-late-answer order
    // (the helper's normal turn order won't reproduce the case).
    const { db } = getDb('server');
    const [conversation] = await db
      .insert(conversations)
      .values({ userId: auth.userId })
      .returning();
    const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const [u1] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Question 1',
        createdAt: new Date(baseTime + 1_000),
      })
      .returning();
    const [u2] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: 'Question 2',
        createdAt: new Date(baseTime + 2_000),
      })
      .returning();
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Answer 1',
      responseToMessageId: u1.id,
      createdAt: new Date(baseTime + 3_000),
    });
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Answer 2',
      responseToMessageId: u2.id,
      createdAt: new Date(baseTime + 4_000),
    });

    const loaded = await loadConversation({
      conversationId: conversation.id,
      userId: auth.userId,
      limit: 2,
    });

    expect(loaded).not.toBeNull();
    const contents = loaded!.messages.map((m) => m.content);
    expect(contents).toEqual(['Question 1', 'Question 2', 'Answer 1', 'Answer 2']);
  });
});
