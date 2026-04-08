---
type: ADR
id: "0002"
title: "Long-lived OAuth bearer tokens for MCP/API DX"
status: active
date: 2026-04-07
---

## Context

Squire exposes an OAuth 2.1 flow so MCP clients can call the tool endpoints. The
industry-default mitigation for bearer-token theft is short-lived access tokens
(10–15 min) paired with refresh-token rotation. `docs/SECURITY.md` §2 originally
described that mitigation verbatim.

The real clients of this auth flow are MCP tools and API scripts, not browser
sessions. A 15-minute token forces every client implementation to track an
additional refresh endpoint, handle 401s mid-request, and re-authenticate
silently — friction that shows up in every MCP integration guide as "the thing
that breaks."

Squire is a solo-maintained Phase-1 MVP running against rulebook data. There
is no multi-tenant blast radius, no PII beyond Google OAuth identity, and no
compliance bar yet. The threat model here is nothing like a
multi-tenant SaaS.

## Decision

**OAuth access tokens are long-lived (30-day default).** No refresh-token
rotation. Tokens are hashed at rest (SHA-256, hash-as-primary-key) and every
issuance/verification/revocation writes to `oauth_audit_log`. Authorization
codes keep the standard ~60s expiry.

## Options considered

- **Option A** (chosen): Long-lived (30d) access tokens, hashed at rest, full
  audit log, no refresh rotation — optimizes MCP/API client DX. Accepted
  trade-off: a stolen token is valid for up to 30 days until explicit revoke.
- **Option B**: Standard 15-min access + refresh token rotation — matches
  textbook OAuth 2.1 guidance. Rejected: every MCP client has to implement
  refresh logic; the friction is not justified by this project's threat model.
- **Option C**: Long-lived tokens *without* hashing / audit log — simplest.
  Rejected: the hashing + audit log cost ~5 lines and close obvious footguns
  (DB read discloses active tokens, no forensic trail after compromise).

## Consequences

- **Easier:** MCP/API client integrations; no refresh plumbing in tool
  clients; fewer 401 mid-request edge cases; simpler auth internals.
- **Harder:** stolen token window is 30 days. Revocation becomes the primary
  mitigation, so the audit log and a revoke endpoint must actually work.
- **Re-evaluate if:** Squire becomes multi-tenant; compliance requirements
  appear (SOC2, HIPAA, anything with token-lifetime controls); token abuse
  is detected in the audit log; deployment moves to a context where stolen
  tokens have higher blast radius than rulebook Q&A.

## Advice

Decision made during the `plan-eng-review` session on 2026-04-07. The
long-lived-tokens preference was already captured as user-stated feedback
(`feedback_long_lived_tokens.md`) before the review; the review walked the
threat model and confirmed the trade-off is acceptable for Phase 1.
