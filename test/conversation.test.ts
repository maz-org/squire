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

function parseSse(text: string): Array<{ event: string; data: unknown }> {
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
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
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
    expect(body).toContain('squire-transcript squire-transcript--pending');
    expect(body).toContain('Can I loot through a doorway?');
    expect(body).toMatch(/data-stream-url="\/chat\/[0-9a-f-]+\/messages\/[0-9a-f-]+\/stream"/);
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
        data: { id: 'search_rules-1', label: 'SEARCH RULES' },
      },
      {
        event: 'text-delta',
        data: { delta: 'Loot tokens in your hex are picked up with **style**.' },
      },
      {
        event: 'tool-result',
        data: { id: 'search_rules-1', label: 'SEARCH RULES', ok: true },
      },
      {
        event: 'done',
        data: {
          html: '<p>Loot tokens in your hex are picked up with <strong>style</strong>.</p>\n',
        },
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

  it('returns 404 for GET /chat because only conversation-specific pages are routable', async () => {
    const auth = await createAuthContext();
    const pageRes = await requestWithAuth(auth, 'http://localhost:3000/chat');
    expect(pageRes.status).toBe(404);
  });

  it('returns the full transcript plus a pending answer shell for HTMX follow-ups', async () => {
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
    expect(body).toContain('First question');
    expect(body).toContain('First answer.');
    expect(body).toContain('Second question');
    expect(body).toContain('squire-transcript squire-transcript--pending');
    expect(body).toMatch(/data-stream-url="\/chat\/[0-9a-f-]+\/messages\/[0-9a-f-]+\/stream"/);
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
        data: { id: 'search_rules-1', label: 'SEARCH RULES' },
      },
      {
        event: 'tool-result',
        data: { id: 'search_rules-1', label: 'SEARCH RULES', ok: false },
      },
      {
        event: 'done',
        data: { html: '<p>Fallback answer.</p>\n' },
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
