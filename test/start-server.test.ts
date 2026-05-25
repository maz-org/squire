import { EventEmitter } from 'node:events';
import type { Server } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { startHttpServer, type StartHttpServerDeps } from '../src/server-start.ts';
import type { ServerConfig } from '../src/config.ts';

class FakeServer extends EventEmitter {
  listenCalls: Array<{ port: number; host?: string }> = [];
  private readonly listenError?: NodeJS.ErrnoException;

  constructor(listenError?: NodeJS.ErrnoException) {
    super();
    this.listenError = listenError;
  }

  listen(port: number, host?: string): this {
    this.listenCalls.push({ port, host });
    queueMicrotask(() => {
      if (this.listenError) {
        this.emit('error', this.listenError);
      } else {
        this.emit('listening');
      }
    });
    return this;
  }
}

function eaddrinuse(): NodeJS.ErrnoException {
  const error = new Error('address in use') as NodeJS.ErrnoException;
  error.code = 'EADDRINUSE';
  return error;
}

function buildDeps(options: {
  config: Pick<ServerConfig, 'port' | 'host'>;
  servers: FakeServer[];
  claimedPorts?: number[];
  isMainCheckout?: boolean;
}) {
  const releases = (options.claimedPorts ?? [4555]).map(() => vi.fn().mockResolvedValue(undefined));
  let claimIndex = 0;
  let serverIndex = 0;

  const deps: StartHttpServerDeps = {
    appFetch: vi.fn(async () => new Response('ok')),
    createAdaptorServer: vi.fn(() => {
      const server = options.servers[serverIndex];
      serverIndex += 1;
      return server as unknown as Server;
    }),
    loadServerConfig: vi.fn(() => ({
      nodeEnv: 'test',
      port: options.config.port,
      host: options.config.host,
    })),
    getWorktreeRuntime: vi.fn(() => ({
      checkoutRoot: '/tmp/squire',
      checkoutSlug: 'squire',
      isMainCheckout: options.isMainCheckout ?? false,
    })),
    claimWorktreePort: vi.fn(async () => {
      const index = claimIndex;
      claimIndex += 1;
      return {
        port: options.claimedPorts?.[index] ?? 4555,
        release: releases[index],
      };
    }),
    startBootstrapLifecycle: vi.fn(),
    log: vi.fn(),
  };

  return { deps, releases };
}

describe('startHttpServer', () => {
  it('binds the configured port without claiming a worktree port', async () => {
    const server = new FakeServer();
    const { deps } = buildDeps({
      config: { port: 4123, host: '127.0.0.1' },
      servers: [server],
    });

    await startHttpServer(deps);

    expect(deps.claimWorktreePort).not.toHaveBeenCalled();
    expect(server.listenCalls).toEqual([{ port: 4123, host: '127.0.0.1' }]);
    expect(deps.startBootstrapLifecycle).toHaveBeenCalledOnce();
  });

  it('binds a claimed worktree port and releases it when the server closes', async () => {
    const server = new FakeServer();
    const { deps, releases } = buildDeps({
      config: { port: undefined, host: undefined },
      claimedPorts: [4555],
      servers: [server],
    });

    await startHttpServer(deps);

    expect(deps.claimWorktreePort).toHaveBeenCalledWith({
      checkoutRoot: '/tmp/squire',
      checkoutSlug: 'squire',
      isMainCheckout: false,
    });
    expect(server.listenCalls).toEqual([{ port: 4555, host: undefined }]);
    expect(deps.startBootstrapLifecycle).toHaveBeenCalledOnce();

    server.emit('close');

    expect(releases[0]).toHaveBeenCalledOnce();
  });

  it('releases and retries a claimed worktree port that is already in use', async () => {
    const busyServer = new FakeServer(eaddrinuse());
    const retryServer = new FakeServer();
    const { deps, releases } = buildDeps({
      config: { port: undefined, host: undefined },
      claimedPorts: [4555, 4556],
      servers: [busyServer, retryServer],
    });

    await startHttpServer(deps);

    expect(busyServer.listenCalls).toEqual([{ port: 4555, host: undefined }]);
    expect(retryServer.listenCalls).toEqual([{ port: 4556, host: undefined }]);
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).not.toHaveBeenCalled();
    expect(deps.startBootstrapLifecycle).toHaveBeenCalledOnce();
  });
});
