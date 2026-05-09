import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeServer extends EventEmitter {
  listenCalls: number[] = [];

  listen(port: number, _host?: string): this {
    this.listenCalls.push(port);
    queueMicrotask(() => {
      this.emit('listening');
    });
    return this;
  }
}

async function loadStartServer(options: {
  configuredPort?: string;
  configuredHost?: string;
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
  if (options.configuredHost === undefined) {
    delete process.env.HOST;
  } else {
    vi.stubEnv('HOST', options.configuredHost);
  }
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VITEST', 'true');

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
  vi.doMock('../src/instrumentation.ts', () => ({}));
  vi.doMock('../src/service.ts', () => ({
    ask: vi.fn(),
    ensureBootstrapStatus: vi.fn().mockResolvedValue({
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
        'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        'No card data found in Postgres. Run `npm run seed:cards` first.',
      ],
      capabilities: {
        rules: {
          allowed: false,
          reason: 'missing_index',
          message:
            'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        },
        cards: {
          allowed: false,
          reason: 'missing_cards',
          message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
        },
        ask: {
          allowed: false,
          reason: 'missing_index',
          message:
            'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        },
      },
    }),
    getBootstrapStatus: vi.fn().mockReturnValue({
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
        'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        'No card data found in Postgres. Run `npm run seed:cards` first.',
      ],
      capabilities: {
        rules: {
          allowed: false,
          reason: 'missing_index',
          message:
            'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
        },
        cards: {
          allowed: false,
          reason: 'missing_cards',
          message: 'No card data found in Postgres. Run `npm run seed:cards` first.',
        },
        ask: {
          allowed: false,
          reason: 'missing_index',
          message:
            'Embeddings table is empty. Run `npm run index` to populate the Frosthaven book vector store.',
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
  vi.doMock('../src/health.ts', () => ({
    runReadinessChecks: vi.fn().mockResolvedValue({
      status: 'ok',
      db: { status: 'ok' },
      vector: { status: 'ok' },
      embedder: { status: 'ok' },
    }),
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

describe.sequential('startServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds the configured port and the claimed worktree port', async () => {
    const configured = await loadStartServer({
      configuredPort: '4123',
    });

    await configured.startServer();

    expect(configured.fakeServer.listenCalls).toContain(4123);
    expect(configured.startBootstrapLifecycle).toHaveBeenCalled();

    const claimed = await loadStartServer({
      claimedPort: 4555,
    });

    await claimed.startServer();

    expect(claimed.claimWorktreePort).toHaveBeenCalled();
    expect(claimed.fakeServer.listenCalls).toContain(4555);
    expect(claimed.startBootstrapLifecycle).toHaveBeenCalled();
  });
});
