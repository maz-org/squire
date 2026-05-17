import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { ORIGIN_SECRET_HEADER } from '../origin-lock.ts';

const X_FORWARDED_FOR_HEADER = 'x-forwarded-for';
const X_REAL_IP_HEADER = 'x-real-ip';
const FLY_CLIENT_IP_HEADER = 'fly-client-ip';

/**
 * Fly appends its proxy hop to XFF before the request reaches the app. CloudFront
 * appends the viewer IP before sending to Fly, so the trusted viewer address is
 * the value immediately before Fly's hop. Any earlier entries may be spoofed by
 * the original client before CloudFront appended the real viewer address.
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

export interface HeaderReader {
  get?(name: string): string | null | undefined;
  header?(name: string): string | null | undefined;
}

export interface TrustedClientIpOptions {
  originSecret?: string;
  trustedProxyHops?: number;
}

function hasText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.trim().length > 0;
}

function readHeader(headers: HeaderReader, name: string): string | undefined {
  return headers.header?.(name) ?? headers.get?.(name) ?? undefined;
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!hasText(actual)) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeIp(value: string): string | null {
  const trimmed = value.trim();
  return isIP(trimmed) === 0 ? null : trimmed;
}

function parseXForwardedFor(value: string | undefined): string[] | null {
  if (!hasText(value)) return null;

  const parts = value.split(',').map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;

  const ips: string[] = [];
  for (const part of parts) {
    const ip = normalizeIp(part);
    if (!ip) return null;
    ips.push(ip);
  }
  return ips;
}

function resolveLocalClientIp(headers: HeaderReader): string | null {
  const xff = parseXForwardedFor(readHeader(headers, X_FORWARDED_FOR_HEADER));
  if (xff) return xff[0] ?? null;

  for (const header of [X_REAL_IP_HEADER, FLY_CLIENT_IP_HEADER]) {
    const value = readHeader(headers, header);
    if (!hasText(value)) continue;
    return normalizeIp(value) ?? null;
  }

  return null;
}

export function resolveTrustedClientIp(
  headers: HeaderReader,
  options: TrustedClientIpOptions = {},
): string | null {
  const originSecret = options.originSecret ?? process.env.ORIGIN_SHARED_SECRET;
  if (!hasText(originSecret)) {
    return resolveLocalClientIp(headers);
  }

  if (!secretsMatch(readHeader(headers, ORIGIN_SECRET_HEADER), originSecret)) {
    return null;
  }

  const xff = parseXForwardedFor(readHeader(headers, X_FORWARDED_FOR_HEADER));
  if (!xff) return null;

  const trustedProxyHops = options.trustedProxyHops ?? DEFAULT_TRUSTED_PROXY_HOPS;
  const clientIndex = xff.length - trustedProxyHops - 1;
  return clientIndex >= 0 ? xff[clientIndex] : null;
}
