import { describe, it, expect, vi } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

vi.mock('../src/service.ts', () => ({
  initialize: vi.fn(),
  isReady: vi.fn(),
  ask: vi.fn(),
  ensureBootstrapStatus: vi.fn(),
  getBootstrapStatus: vi.fn(),
  startBootstrapLifecycle: vi.fn(),
}));
vi.mock('../src/db.ts', () => ({
  getDb: () => ({ db: { execute: vi.fn() }, close: async () => {} }),
  getWorktreeRuntime: () => ({
    checkoutRoot: '/tmp/test',
    checkoutSlug: 'test',
    isMainCheckout: true,
  }),
  shutdownServerPool: vi.fn(),
}));
vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
}));

import { computePendingStreamUrls } from '../src/server.ts';

// SQR-108: pure-function unit tests for the helper that decides which
// user messages need a pending stream URL on the rendered transcript.
// Integration coverage for the happy path lives in
// `test/conversation.test.ts`; these tests pin the defensive branches
// (empty messages, orphan assistants, error-reply detection, multi-pending)
// that are awkward to set up through the full HTTP flow.
describe('computePendingStreamUrls', () => {
  it('returns an empty map when there are no messages', () => {
    expect(computePendingStreamUrls([], 'conv-1')).toEqual(new Map());
  });

  it('returns an empty map when there are only assistant messages (defensive — no user message present)', () => {
    expect(
      computePendingStreamUrls(
        [{ id: 'a1', role: 'assistant', responseToMessageId: null }],
        'conv-1',
      ),
    ).toEqual(new Map());
  });

  it('returns one entry for the user message when no assistant has replied yet', () => {
    expect(
      computePendingStreamUrls([{ id: 'u1', role: 'user', responseToMessageId: null }], 'conv-1'),
    ).toEqual(new Map([['u1', '/chat/conv-1/messages/u1/stream']]));
  });

  it('returns an empty map when the latest user message has been answered', () => {
    expect(
      computePendingStreamUrls(
        [
          { id: 'u1', role: 'user', responseToMessageId: null },
          { id: 'a1', role: 'assistant', responseToMessageId: 'u1' },
        ],
        'conv-1',
      ),
    ).toEqual(new Map());
  });

  it('treats an error assistant reply as a reply (regression: pre-PR latent bug re-attached the stream on reload)', () => {
    // Persisted error rows have role: 'assistant', isError: true,
    // responseToMessageId set. The helper checks role + responseToMessageId
    // — isError is a render-side concern, not a "is this a reply" concern.
    expect(
      computePendingStreamUrls(
        [
          { id: 'u1', role: 'user', responseToMessageId: null },
          { id: 'a1-error', role: 'assistant', responseToMessageId: 'u1' },
        ],
        'conv-1',
      ),
    ).toEqual(new Map());
  });

  it('returns one entry per unanswered user message when concurrent turns exist', () => {
    // Codex SQR-108 finding: an older still-running turn must NOT
    // disappear from the in-flight UI when a newer turn lands.
    expect(
      computePendingStreamUrls(
        [
          { id: 'u1', role: 'user', responseToMessageId: null },
          { id: 'u2', role: 'user', responseToMessageId: null },
        ],
        'conv-c',
      ),
    ).toEqual(
      new Map([
        ['u1', '/chat/conv-c/messages/u1/stream'],
        ['u2', '/chat/conv-c/messages/u2/stream'],
      ]),
    );
  });

  it('returns the unanswered user even when a later user has been answered (mixed concurrent state)', () => {
    expect(
      computePendingStreamUrls(
        [
          { id: 'u1', role: 'user', responseToMessageId: null },
          { id: 'u2', role: 'user', responseToMessageId: null },
          { id: 'a2', role: 'assistant', responseToMessageId: 'u2' },
        ],
        'conv-c',
      ),
    ).toEqual(new Map([['u1', '/chat/conv-c/messages/u1/stream']]));
  });
});
