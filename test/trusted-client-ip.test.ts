import { describe, expect, it } from 'vitest';

import { resolveTrustedClientIp } from '../src/http/trusted-client-ip.ts';

function headers(values: Record<string, string | undefined>) {
  return {
    get(name: string): string | undefined {
      return values[name.toLowerCase()];
    },
  };
}

describe('resolveTrustedClientIp', () => {
  const originSecret = 'cloudfront-origin-secret'.repeat(2);

  it('resolves the viewer IP from a CloudFront/Fly XFF chain after origin-secret validation', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': originSecret,
        'x-forwarded-for': '198.51.100.10, 203.0.113.20',
      }),
      { originSecret },
    );

    expect(ip).toBe('198.51.100.10');
  });

  it('ignores spoofed XFF entries that were present before CloudFront appended the viewer IP', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': originSecret,
        'x-forwarded-for': '192.0.2.99, 198.51.100.10, 203.0.113.20',
      }),
      { originSecret },
    );

    expect(ip).toBe('198.51.100.10');
  });

  it('does not trust forwarded headers when the production origin secret is missing', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-forwarded-for': '198.51.100.10, 203.0.113.20',
      }),
      { originSecret },
    );

    expect(ip).toBeNull();
  });

  it('does not trust forwarded headers when the production origin secret does not match', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': 'wrong-secret',
        'x-forwarded-for': '198.51.100.10, 203.0.113.20',
      }),
      { originSecret },
    );

    expect(ip).toBeNull();
  });

  it('rejects malformed XFF chains instead of storing arbitrary raw values', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': originSecret,
        'x-forwarded-for': '198.51.100.10, not-an-ip, 203.0.113.20',
      }),
      { originSecret },
    );

    expect(ip).toBeNull();
  });

  it('rejects production XFF chains that do not include the trusted Fly proxy hop', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': originSecret,
        'x-forwarded-for': '198.51.100.10',
      }),
      { originSecret },
    );

    expect(ip).toBeNull();
  });

  it('rejects invalid trusted proxy hop counts', () => {
    const requestHeaders = headers({
      'x-origin-secret': originSecret,
      'x-forwarded-for': '198.51.100.10, 203.0.113.20',
    });

    expect(
      resolveTrustedClientIp(requestHeaders, { originSecret, trustedProxyHops: -1 }),
    ).toBeNull();
    expect(
      resolveTrustedClientIp(requestHeaders, { originSecret, trustedProxyHops: 0.5 }),
    ).toBeNull();
  });

  it('ignores x-real-ip in production because CloudFront removes it before origin', () => {
    const ip = resolveTrustedClientIp(
      headers({
        'x-origin-secret': originSecret,
        'x-real-ip': '198.51.100.10',
      }),
      { originSecret },
    );

    expect(ip).toBeNull();
  });

  it('supports local development without CloudFront headers while still validating IP syntax', () => {
    expect(
      resolveTrustedClientIp(
        headers({
          'x-forwarded-for': '198.51.100.10',
        }),
        { originSecret: undefined },
      ),
    ).toBe('198.51.100.10');

    expect(
      resolveTrustedClientIp(
        headers({
          'x-real-ip': '2001:db8::1',
        }),
        { originSecret: undefined },
      ),
    ).toBe('2001:db8::1');

    expect(
      resolveTrustedClientIp(
        headers({
          'x-forwarded-for': 'not-an-ip',
        }),
        { originSecret: undefined },
      ),
    ).toBeNull();
  });
});
