import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManagedDatabaseNames {
  devDatabaseName: string;
  testDatabaseName: string;
}

export interface WorktreeRuntime {
  checkoutRoot: string;
  checkoutSlug: string;
  isMainCheckout: boolean;
  devDatabaseName: string;
  testDatabaseName: string;
  defaultPort: number;
}

interface DerivedRuntimeInput {
  isMainCheckout: boolean;
  checkoutSlug: string;
}

interface PortClaimRecord {
  token: string;
  pid: number;
  checkoutRoot: string;
  claimedAt: string;
}

export interface PortClaim {
  port: number;
  release: () => Promise<void>;
}

const DEFAULT_LOCAL_PORT = 3000;
const WORKTREE_PORT_BASE = 4000;
const WORKTREE_PORT_SPAN = 2000;
const PORT_CLAIM_DIR = path.join(homedir(), '.codex', 'port-claims', 'squire');

let cachedRuntime: WorktreeRuntime | null = null;

type PortAvailabilityFn = (port: number) => Promise<boolean>;
type ProcessAliveFn = (pid: number) => boolean;

export function deriveCheckoutSlug(checkoutRoot: string): string {
  return createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 8);
}

export function deriveManagedDatabaseNames(input: DerivedRuntimeInput): ManagedDatabaseNames {
  if (input.isMainCheckout) {
    return {
      devDatabaseName: 'squire',
      testDatabaseName: 'squire_test',
    };
  }

  return {
    devDatabaseName: `squire_${input.checkoutSlug}`,
    testDatabaseName: `squire_${input.checkoutSlug}_test`,
  };
}

export function deriveDefaultPort(input: DerivedRuntimeInput): number {
  if (input.isMainCheckout) return DEFAULT_LOCAL_PORT;

  return WORKTREE_PORT_BASE + (parseInt(input.checkoutSlug, 16) % WORKTREE_PORT_SPAN);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveDefaultPort(
  input: DerivedRuntimeInput,
  portIsAvailable: PortAvailabilityFn = isPortAvailable,
): Promise<number> {
  const initialPort = deriveDefaultPort(input);
  if (input.isMainCheckout) return initialPort;

  for (let offset = 0; offset < WORKTREE_PORT_SPAN; offset += 1) {
    const candidate =
      WORKTREE_PORT_BASE + ((initialPort - WORKTREE_PORT_BASE + offset) % WORKTREE_PORT_SPAN);
    if (await portIsAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No available port found in managed worktree range ${WORKTREE_PORT_BASE}-${WORKTREE_PORT_BASE + WORKTREE_PORT_SPAN - 1}.`,
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

function getManagedPortCandidate(input: DerivedRuntimeInput, offset: number): number {
  const initialPort = deriveDefaultPort(input);
  if (input.isMainCheckout) return initialPort;

  return WORKTREE_PORT_BASE + ((initialPort - WORKTREE_PORT_BASE + offset) % WORKTREE_PORT_SPAN);
}

async function tryClaimPort(
  port: number,
  checkoutRoot: string,
  processIsAlive: ProcessAliveFn,
): Promise<(() => Promise<void>) | null> {
  await mkdir(PORT_CLAIM_DIR, { recursive: true });
  const claimPath = path.join(PORT_CLAIM_DIR, `${port}.json`);

  while (true) {
    try {
      const handle = await open(claimPath, 'wx');
      const claimRecord: PortClaimRecord = {
        token: `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        pid: process.pid,
        checkoutRoot,
        claimedAt: new Date().toISOString(),
      };
      await handle.writeFile(JSON.stringify(claimRecord));
      await handle.close();
      return async () => {
        try {
          const raw = await readFile(claimPath, 'utf8');
          const currentClaim = JSON.parse(raw) as Partial<PortClaimRecord>;
          if (currentClaim.token === claimRecord.token) {
            await rm(claimPath, { force: true });
          }
        } catch (error) {
          const errno = error as NodeJS.ErrnoException;
          if (errno.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code !== 'EEXIST') throw error;

      try {
        const raw = await readFile(claimPath, 'utf8');
        const claim = JSON.parse(raw) as Partial<PortClaimRecord>;
        if (typeof claim.pid === 'number' && !processIsAlive(claim.pid)) {
          await rm(claimPath, { force: true });
          continue;
        }
      } catch (error) {
        const errno = error as NodeJS.ErrnoException;
        if (errno.code === 'ENOENT') continue;
        await rm(claimPath, { force: true });
        continue;
      }

      return null;
    }
  }
}

export async function claimWorktreePort(
  input: DerivedRuntimeInput & { checkoutRoot: string },
  portIsAvailable: PortAvailabilityFn = isPortAvailable,
  processIsAlive: ProcessAliveFn = isProcessAlive,
): Promise<PortClaim> {
  if (input.isMainCheckout) {
    return {
      port: DEFAULT_LOCAL_PORT,
      release: async () => {},
    };
  }

  for (let offset = 0; offset < WORKTREE_PORT_SPAN; offset += 1) {
    const candidate = getManagedPortCandidate(input, offset);
    const release = await tryClaimPort(candidate, input.checkoutRoot, processIsAlive);
    if (!release) continue;

    if (await portIsAvailable(candidate)) {
      return { port: candidate, release };
    }

    await release();
  }

  throw new Error(
    `No claimable port found in managed worktree range ${WORKTREE_PORT_BASE}-${WORKTREE_PORT_BASE + WORKTREE_PORT_SPAN - 1}.`,
  );
}

export function getCheckoutRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function isMainCheckout(checkoutRoot: string): boolean {
  const gitPath = path.join(checkoutRoot, '.git');
  if (!existsSync(gitPath)) return true;
  return lstatSync(gitPath).isDirectory();
}

export function getWorktreeRuntime(): WorktreeRuntime {
  if (cachedRuntime) return cachedRuntime;

  const checkoutRoot = getCheckoutRoot();
  const mainCheckout = isMainCheckout(checkoutRoot);
  const checkoutSlug = deriveCheckoutSlug(checkoutRoot);
  const names = deriveManagedDatabaseNames({
    isMainCheckout: mainCheckout,
    checkoutSlug,
  });

  cachedRuntime = {
    checkoutRoot,
    checkoutSlug,
    isMainCheckout: mainCheckout,
    devDatabaseName: names.devDatabaseName,
    testDatabaseName: names.testDatabaseName,
    defaultPort: deriveDefaultPort({
      isMainCheckout: mainCheckout,
      checkoutSlug,
    }),
  };
  return cachedRuntime;
}
