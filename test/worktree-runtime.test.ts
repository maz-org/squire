import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimWorktreePort,
  deriveCheckoutSlug,
  deriveDefaultPort,
  deriveManagedDatabaseNames,
} from '../src/worktree-runtime.ts';

const claimDir = path.join(homedir(), '.codex', 'port-claims', 'squire');

afterEach(async () => {
  await rm(claimDir, { force: true, recursive: true });
});

describe('worktree runtime derivation', () => {
  it('keeps legacy defaults for the main checkout', () => {
    expect(deriveManagedDatabaseNames({ isMainCheckout: true, checkoutSlug: 'deadbeef' })).toEqual({
      devDatabaseName: 'squire',
      testDatabaseName: 'squire_test',
    });
    expect(deriveDefaultPort({ isMainCheckout: true, checkoutSlug: 'deadbeef' })).toBe(3000);
  });

  it('derives isolated names for linked worktrees', () => {
    expect(deriveManagedDatabaseNames({ isMainCheckout: false, checkoutSlug: '6fc2abcd' })).toEqual(
      {
        devDatabaseName: 'squire_6fc2abcd',
        testDatabaseName: 'squire_6fc2abcd_test',
      },
    );
  });

  it('derives a deterministic slug from the checkout root path', () => {
    const a = deriveCheckoutSlug('/Users/bcm/.codex/worktrees/6fc2/squire');
    const b = deriveCheckoutSlug('/Users/bcm/.codex/worktrees/6fc2/squire');
    const c = deriveCheckoutSlug('/Users/bcm/.codex/worktrees/7aa1/squire');

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(c).not.toBe(a);
  });

  it('derives a deterministic non-default port for linked worktrees', () => {
    const portA = deriveDefaultPort({ isMainCheckout: false, checkoutSlug: '6fc2abcd' });
    const portB = deriveDefaultPort({ isMainCheckout: false, checkoutSlug: '6fc2abcd' });
    const portC = deriveDefaultPort({ isMainCheckout: false, checkoutSlug: '7aa1beef' });

    expect(portA).toBe(portB);
    expect(portA).toBeGreaterThanOrEqual(4000);
    expect(portA).toBeLessThan(6000);
    expect(portC).not.toBe(portA);
  });

  it('reclaims stale port claim files left by dead processes', async () => {
    const candidatePort = deriveDefaultPort({ isMainCheckout: false, checkoutSlug: '6fc2abcd' });
    await mkdir(claimDir, { recursive: true });
    await writeFile(
      path.join(claimDir, `${candidatePort}.json`),
      JSON.stringify({
        token: 'stale-claim',
        pid: 999_999,
        checkoutRoot: '/tmp/old-worktree',
        claimedAt: new Date().toISOString(),
      }),
    );

    const claim = await claimWorktreePort(
      {
        checkoutRoot: '/tmp/new-worktree',
        checkoutSlug: '6fc2abcd',
        isMainCheckout: false,
      },
      async () => true,
      () => false,
    );

    expect(claim.port).toBe(candidatePort);

    const claimPath = path.join(claimDir, `${candidatePort}.json`);
    const persistedClaim = JSON.parse(await readFile(claimPath, 'utf8')) as {
      token: string;
      checkoutRoot: string;
    };
    expect(persistedClaim.token).not.toBe('stale-claim');
    expect(persistedClaim.checkoutRoot).toBe('/tmp/new-worktree');
  });

  it('does not delete a newer claim when an older releaser runs late', async () => {
    const firstClaim = await claimWorktreePort(
      {
        checkoutRoot: '/tmp/first-worktree',
        checkoutSlug: '6fc2abcd',
        isMainCheckout: false,
      },
      async () => true,
      () => true,
    );

    const claimPath = path.join(claimDir, `${firstClaim.port}.json`);
    await writeFile(
      claimPath,
      JSON.stringify({
        token: 'newer-claim',
        pid: process.pid,
        checkoutRoot: '/tmp/second-worktree',
        claimedAt: new Date().toISOString(),
      }),
    );

    await firstClaim.release();

    const persistedClaim = JSON.parse(await readFile(claimPath, 'utf8')) as {
      token: string;
      checkoutRoot: string;
    };
    expect(persistedClaim.token).toBe('newer-claim');
    expect(persistedClaim.checkoutRoot).toBe('/tmp/second-worktree');
  });
});
