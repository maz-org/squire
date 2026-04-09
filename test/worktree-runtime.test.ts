import { describe, expect, it } from 'vitest';

import {
  deriveCheckoutSlug,
  deriveDefaultPort,
  deriveManagedDatabaseNames,
} from '../src/worktree-runtime.ts';

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
});
