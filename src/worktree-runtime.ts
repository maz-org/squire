import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
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

const DEFAULT_LOCAL_PORT = 3000;
const WORKTREE_PORT_BASE = 4000;
const WORKTREE_PORT_SPAN = 2000;

let cachedRuntime: WorktreeRuntime | null = null;

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
