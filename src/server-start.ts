import type { Server } from 'node:net';

import type { ServerConfig } from './config.ts';
import type { PortClaim, WorktreeRuntime } from './worktree-runtime.ts';

type FetchHandler = (request: Request) => Response | Promise<Response>;

type WorktreePortRuntime = Pick<
  WorktreeRuntime,
  'checkoutRoot' | 'checkoutSlug' | 'isMainCheckout'
>;

export interface StartHttpServerDeps {
  appFetch: FetchHandler;
  createAdaptorServer: (options: { fetch: FetchHandler }) => Server;
  loadServerConfig: () => ServerConfig;
  getWorktreeRuntime: () => WorktreePortRuntime;
  claimWorktreePort: (runtime: WorktreePortRuntime) => Promise<PortClaim>;
  startBootstrapLifecycle: () => void;
  log?: (message: string) => void;
}

export async function startHttpServer({
  appFetch,
  createAdaptorServer,
  loadServerConfig,
  getWorktreeRuntime,
  claimWorktreePort,
  startBootstrapLifecycle,
  log = console.log,
}: StartHttpServerDeps): Promise<void> {
  const config = loadServerConfig();
  const configuredPort = config.port;
  const runtime = getWorktreeRuntime();

  if (configuredPort === undefined) {
    while (true) {
      const claim = await claimWorktreePort({
        checkoutRoot: runtime.checkoutRoot,
        checkoutSlug: runtime.checkoutSlug,
        isMainCheckout: runtime.isMainCheckout,
      });
      const server = createAdaptorServer({ fetch: appFetch });
      try {
        await listen(server, claim.port, config.host);
        server.once('close', () => {
          void claim.release();
        });
        startBootstrapLifecycle();
        log(`Squire server listening on port ${claim.port}`);
        return;
      } catch (error) {
        await claim.release();
        const errno = error as NodeJS.ErrnoException;
        if (errno.code !== 'EADDRINUSE' || runtime.isMainCheckout) throw error;
      }
    }
  }

  const server = createAdaptorServer({ fetch: appFetch });
  await listen(server, configuredPort, config.host);
  startBootstrapLifecycle();
  log(`Squire server listening on port ${configuredPort}`);
}

async function listen(server: Server, port: number, host?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    if (host) {
      server.listen(port, host);
    } else {
      server.listen(port);
    }
  });
}
