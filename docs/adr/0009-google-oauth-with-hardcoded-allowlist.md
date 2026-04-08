---
type: ADR
id: "0009"
title: "Google OAuth + hard-coded email allowlist for Phase 1 Web UI"
status: active
date: 2026-04-08
---

## Context

Phase 1 MVP is the Web UI at the table: one user (Brian), deployed behind Cloudflare WAF, real auth so it's not bypassable, but no multi-tenant concerns yet. The SPEC (`docs/SPEC.md` §"Phase 1 — Out of scope") explicitly says single user but auth is real.

The pre-v2.0 tickets in the User Accounts project (SQR-37 "registration", SQR-38 "email + password login", SQR-40 "profile management") were written against an earlier design that assumed email + password self-service. That design predates the decision to extend the existing `@modelcontextprotocol/sdk` OAuth infrastructure in `src/auth.ts` into the web channel.

At the same time, the MCP channel already uses long-lived OAuth bearer tokens (see [ADR 0002](0002-long-lived-oauth-bearer-tokens.md)), so the project already has OAuth 2.1 plumbing, a users table, and the concept of server-side sessions.

The walkthrough surfaced this contradiction: the Web UI project was about to ship email + password code that the rest of the system wouldn't need, while simultaneously ignoring the Google OAuth infrastructure SPEC §Phase 1 Tasks actually names.

## Decision

**Phase 1 Web UI authenticates users via Google OAuth 2.0, creates Postgres-backed sessions, and gates access behind a hard-coded email allowlist constant in the auth callback. No self-serve registration. No email + password.**

Specifically:

- `GET /auth/google/start` → Google consent screen (PKCE + state)
- `GET /auth/google/callback` → exchange code, verify ID token, check allowlist, upsert user, create session, set cookie, redirect `/`
- `POST /auth/logout` → destroy session, clear cookie
- Session cookie: HttpOnly, Secure, SameSite=Strict, signed, 30-day expiry (matches the long-lived-token DX policy from ADR 0002)
- Sessions stored in Postgres (`web_sessions` table)
- Allowlist is a `const ALLOWED_EMAILS = [...]` in the callback handler; any other email gets a 403 "not invited" page
- Implemented in SQR-38; UI in SQR-13; CSRF in SQR-39

## Options considered

- **Google OAuth + hard-coded allowlist** (chosen): zero account management UI, zero password storage, reuses existing OAuth infrastructure. Allowlist is one-line-of-code to maintain for single-user MVP. Upgradeable to a proper allowlist table in Phase 3 without changing the callback flow.
- **Email + password with self-serve registration**: what the old tickets proposed. Requires password hashing, reset flow, email verification, account lockout — all work that doesn't serve a single-user MVP and predates the decision to reuse MCP OAuth infrastructure.
- **Magic links**: no password, but requires email sending infrastructure (SES/Postmark/etc.) and a whole flow we don't need for one user.
- **SSO (Google) with database-backed allowlist**: same as the chosen option but with the allowlist in Postgres. Rejected for Phase 1 because it adds a table, a CRUD UI, and zero value for one user. The chosen option intentionally picks the dumbest possible version so we can graduate to the table-backed version in Phase 3 without breaking anything.
- **No auth, rely on Cloudflare WAF IP allowlist**: SPEC explicitly says "auth is real so it's not bypassable". Rejected.

## Consequences

- SQR-37 (self-serve registration) is canceled — Google OAuth handles user upsert on first callback.
- SQR-38's original email + password scope is replaced with the OAuth callback flow described above.
- SQR-40 (profile / settings) moves to Phase 4 alongside the Campaign State work — there's nothing to configure yet.
- Adding a new user in Phase 1 means editing source code and redeploying. That's fine for a single-user MVP. When a second user needs access, that's the trigger to graduate to a Postgres-backed allowlist (likely in Phase 3's multi-user work).
- The hard-coded allowlist must never land in a public GitHub issue or log line — treat the email like any other PII.
- CSRF protection (SQR-39) becomes mandatory because we now have session cookies and mutating endpoints.
- Re-evaluate this decision when: (a) a second user needs access, (b) we add any endpoint that an attacker with a stolen session cookie could abuse beyond the LLM cost budget, or (c) Phase 3 multi-user work starts.

## Advice

Decision made in the 2026-04-08 Web UI plan-eng-review walkthrough. The hard-coded allowlist option was proposed as the "dumbest possible version" during the walkthrough; Brian picked it explicitly over environment-variable and database alternatives.
