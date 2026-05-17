---
type: ADR
id: '0017'
title: 'Redis-backed application rate limits with structured denial logs'
status: active
date: 2026-05-17
---

## Context

Squire already runs behind Route 53, CloudFront, and AWS WAF. That edge layer is
useful for coarse abusive traffic, IP reputation, and managed request filters,
but it cannot express Squire-specific identities or endpoint semantics. The
same product also needs rate limits across more than one interactive surface:
dynamic OAuth client registration, Google OAuth initiation/callback, MCP, and
eventually cost-aware chat admission.

The first version of SQR-52 proposed an app-local bucket and a
`oauth_audit_log` row for rate-limit denials. That mixed two separate jobs:
admission control and durable auth lifecycle evidence. It also would not work
well across more than one Fly machine.

## Decision

**Application request limits use a shared Redis/Valkey-compatible token bucket,
and rate-limit denials are structured security log events rather than
`oauth_audit_log` rows.**

Production config uses `REDIS_URL`; Fly Upstash Redis is the Phase 1 managed
Redis-compatible backend. `oauth_audit_log` remains for auth lifecycle state
changes such as registration, authorization, token issuance, verification, and
revocation.

## Options considered

- **Redis/Valkey-compatible token buckets (chosen):** shared across app
  instances, cheap for high-frequency admission checks, naturally reused across
  `/register`, Google OAuth endpoints, and MCP. Adds one small managed service.
- **Postgres counters:** avoids a new service but puts hot admission-control
  writes on the durable relational store and encourages treating operational
  denials like audit records.
- **AWS WAF or API Gateway only:** useful outer protection, but too coarse for
  authenticated user/client semantics, protocol-specific MCP behavior, and
  exact product responses.
- **Process-local buckets:** simplest code, but incorrect once Fly runs more
  than one app machine or a process restarts.

## Consequences

SQR-52 owns the shared limiter foundation and applies it to `/register`.
Follow-up endpoint work should reuse the same limiter rather than inventing new
stores. SQR-76 applies it to Google OAuth routes; SQR-173 applies it to MCP.

Production must provide `REDIS_URL`. Local development can run without Redis
and uses an in-process fallback. Tests inject an in-memory limiter and do not
require a live Redis instance.

Rate-limit logs must avoid raw IPs, request bodies, redirect URIs, client
names, and emails. They should include endpoint, policy, hashed identity,
environment, and retry timing so a future observability pass can route and
aggregate them without a schema migration.

If Redis is unavailable, endpoints that depend on the limiter should fail
closed with a short unavailable response instead of silently accepting unlimited
traffic.

## Advice

The maintainer explicitly challenged storing rate-limit denials in
`oauth_audit_log`: audit logs are logs, not database records, unless there is a
specific compliance or product reason to query them as durable relational data.
