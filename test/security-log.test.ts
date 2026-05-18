import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeSecurityLog } from '../src/security-log.ts';

const ORIGINAL_SQUIRE_ENV = process.env.SQUIRE_ENV;

afterEach(() => {
  if (ORIGINAL_SQUIRE_ENV === undefined) {
    delete process.env.SQUIRE_ENV;
  } else {
    process.env.SQUIRE_ENV = ORIGINAL_SQUIRE_ENV;
  }
  vi.restoreAllMocks();
});

describe('writeSecurityLog', () => {
  it('does not allow caller fields to override canonical log fields', () => {
    process.env.SQUIRE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeSecurityLog({
      event: 'rate_limit_rejected',
      level: 'warn',
      fields: {
        event: 'spoofed_event',
        level: 'info',
        ts: 'spoofed_timestamp',
        squire_env: 'spoofed_env',
        detail: 'preserved_field',
      },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: 'rate_limit_rejected',
      level: 'warn',
      squire_env: 'production',
      detail: 'preserved_field',
    });
    expect(payload.ts).not.toBe('spoofed_timestamp');
  });
});
