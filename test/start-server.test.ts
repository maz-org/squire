import { EventEmitter } from 'node:events';
import type { Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureTelemetryError, mockFlushTelemetry } = vi.hoisted(() => ({
  mockCaptureTelemetryError: vi.fn(),
  mockFlushTelemetry: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/telemetry.ts', () => ({
  captureTelemetryError: mockCaptureTelemetryError,
  flushTelemetry: mockFlushTelemetry,
}));

import { startHttpServer, startHttpServerWithTelemetry } from '../src/server-start.ts';

class FakeServer extends EventEmitter {
  listenCalls: number[] = [];
  refCalls = 0;
  listenError: Error | null = null;

  listen(port: number, _host?: string): this {
    this.listenCalls.push(port);
    queueMicrotask(() => {
      if (this.listenError) {
        this.emit('error', this.listenError);
      } else {
        this.emit('listening');
      }
    });
    return this;
  }

  ref(): this {
    this.refCalls += 1;
    return this;
  }
}

function createStartHttpServerHarness(options: {
  configuredPort?: number;
  configuredHost?: string;
  claimedPort?: number;
  listenError?: Error;
}) {
  const fakeServer = new FakeServer();
  fakeServer.listenError = options.listenError ?? null;
  const createAdaptorServer = vi.fn(() => fakeServer as unknown as Server);
  const claimRelease = vi.fn().mockResolvedValue(undefined);
  const claimWorktreePort = vi.fn().mockResolvedValue({
    port: options.claimedPort ?? 4555,
    release: claimRelease,
  });
  const startBootstrapLifecycle = vi.fn();
  const log = vi.fn();

  const deps = {
    appFetch: vi.fn(),
    createAdaptorServer,
    loadServerConfig: vi.fn(() => ({
      nodeEnv: 'test',
      port: options.configuredPort,
      host: options.configuredHost,
    })),
    getWorktreeRuntime: vi.fn(() => ({
      checkoutRoot: '/tmp/squire',
      checkoutSlug: 'squire',
      isMainCheckout: false,
    })),
    claimWorktreePort,
    startBootstrapLifecycle,
    log,
  };

  return {
    start: () => startHttpServer(deps),
    startWithTelemetry: () => startHttpServerWithTelemetry(deps),
    fakeServer,
    createAdaptorServer,
    claimWorktreePort,
    claimRelease,
    startBootstrapLifecycle,
    log,
  };
}

describe.sequential('startServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCaptureTelemetryError.mockClear();
    mockFlushTelemetry.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds the configured port and the claimed worktree port', async () => {
    const configured = createStartHttpServerHarness({ configuredPort: 4123 });

    await configured.start();

    expect(configured.fakeServer.listenCalls).toContain(4123);
    expect(configured.fakeServer.refCalls).toBe(1);
    expect(configured.startBootstrapLifecycle).toHaveBeenCalled();

    const claimed = createStartHttpServerHarness({ claimedPort: 4555 });

    await claimed.start();

    expect(claimed.claimWorktreePort).toHaveBeenCalled();
    expect(claimed.fakeServer.listenCalls).toContain(4555);
    expect(claimed.fakeServer.refCalls).toBe(1);
    expect(claimed.startBootstrapLifecycle).toHaveBeenCalled();
  });

  it('captures and flushes startup failures before rethrowing', async () => {
    const listenError = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
    const configured = createStartHttpServerHarness({
      configuredPort: 4123,
      listenError,
    });

    await expect(configured.startWithTelemetry()).rejects.toBe(listenError);

    expect(mockCaptureTelemetryError).toHaveBeenCalledWith(
      listenError,
      expect.objectContaining({
        route: 'server.startup',
        context: {
          surface: 'server',
          phase: 'startup',
        },
      }),
    );
    expect(mockFlushTelemetry).toHaveBeenCalledWith(2_000);
  });
});
