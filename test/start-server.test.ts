import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeServer extends EventEmitter {
  listenCalls: number[] = [];

  listen(port: number): this {
    this.listenCalls.push(port);
    queueMicrotask(() => {
      this.emit('listening');
    });
    return this;
  }
}

async function loadStartServer(options: {
  configuredPort?: string;
  claimedPort?: number;
  bootstrapImpl?: () => unknown;
}) {
  vi.resetModules();

  if (options.configuredPort === undefined) {
    vi.unstubAllEnvs();
    delete process.env.PORT;
  } else {
    vi.stubEnv('PORT', options.configuredPort);
  }

  const fakeServer = new FakeServer();
  const createAdaptorServer = vi.fn(() => fakeServer);
  const claimRelease = vi.fn().mockResolvedValue(undefined);
  const claimWorktreePort = vi.fn().mockResolvedValue({
    port: options.claimedPort ?? 4555,
    release: claimRelease,
  });
  const startBootstrapLifecycle = vi.fn(options.bootstrapImpl ?? (() => undefined));

  vi.doMock('@hono/node-server', () => ({
    createAdaptorServer,
  }));
  vi.doMock('../src/service.ts', () => ({
    ask: vi.fn(),
    getBootstrapStatus: vi.fn().mockResolvedValue({
      lifecycle: 'boot_blocked',
      ready: false,
      bootstrapReady: false,
      warmingUp: false,
      indexSize: 0,
      cardCount: 0,
      ruleQueriesReady: false,
      cardQueriesReady: false,
      askReady: false,
      missingBootstrapSteps: ['npm run index', 'npm run seed:cards'],
      errors: [
        'Embeddings table is empty. Run `npm run index` to populate the rulebook vector store.',
        'No card data found in Postgres. Run `npm run seed:cards` first.',
      ],
      capabilities: {
        rules: {
          allowed: false,
          reason: 'missing_index',
          message: 'Embeddings table is empty. Run `npm run index` to populate the rulebook vector store.',
        },
        cards: {
          allowed: false,
          reason: 'missing_cards',
          message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
        },
        ask: {
          allowed: false,
          reason: 'missing_index',
          message: 'Embeddings table is empty. Run `npm run index` to populate the rulebook vector store.',
        },
      },
    }),
    isReady: vi.fn().mockReturnValue(false),
    startBootstrapLifecycle,
  }));
  vi.doMock('../src/db.ts', () => ({
    getWorktreeRuntime: vi.fn(() => ({
      checkoutRoot: '/tmp/squire',
      checkoutSlug: 'squire',
      isMainCheckout: false,
    })),
    shutdownServerPool: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../src/worktree-runtime.ts', () => ({
    claimWorktreePort,
  }));
  vi.doMock('../src/tools.ts', () => ({
    searchRules: vi.fn(),
    searchCards: vi.fn(),
    listCardTypes: vi.fn(),
    listCards: vi.fn(),
    getCard: vi.fn(),
  }));
  vi.doMock('../src/auth.ts', () => ({
    registerClient: vi.fn(),
    createAuthorizationCode: vi.fn(),
    exchangeAuthorizationCode: vi.fn(),
    verifyAccessToken: vi.fn().mockResolvedValue({
      token: 'stub',
      clientId: 'stub-client',
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
    getAuthProvider: vi.fn(),
    resetAuthProvider: vi.fn(),
    OAuthError: class OAuthError extends Error {},
  }));

  const mod = await import('../src/server.ts');
  return {
    startServer: mod.startServer,
    fakeServer,
    createAdaptorServer,
    claimWorktreePort,
    startBootstrapLifecycle,
  };
}

describe('startServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds the configured port without awaiting bootstrap warmup', async () => {
    let resolveBootstrap: (() => void) | null = null;
    const { startServer, fakeServer, startBootstrapLifecycle } = await loadStartServer({
      configuredPort: '4123',
      bootstrapImpl: () =>
        new Promise<void>((resolve) => {
          resolveBootstrap = resolve;
        }),
    });

    await expect(startServer()).resolves.toBeUndefined();

    expect(fakeServer.listenCalls).toEqual([4123]);
    expect(startBootstrapLifecycle).toHaveBeenCalledTimes(1);

    resolveBootstrap?.();
  });

  it('binds a claimed worktree port even when bootstrap prerequisites are missing', async () => {
    const { startServer, fakeServer, claimWorktreePort, startBootstrapLifecycle } =
      await loadStartServer({
        claimedPort: 4555,
      });

    await expect(startServer()).resolves.toBeUndefined();

    expect(claimWorktreePort).toHaveBeenCalledTimes(1);
    expect(fakeServer.listenCalls).toEqual([4555]);
    expect(startBootstrapLifecycle).toHaveBeenCalledTimes(1);
  });
});
