# Engineering Review: SQR-38 Google OAuth Web Login + Postgres Sessions

## Context

SQR-38 adds Google OAuth web sign-in with server-side Postgres sessions for Squire's web UI channel. This is the authentication gate that blocks 5 downstream issues (SQR-6 chat UI, SQR-7 conversation agent, SQR-13 session header, SQR-39 CSRF, SQR-60 rate limiting). It's plumbing, not a product feature. The goal is correctness, security, and minimal surface area.

**Design doc:** `~/.gstack/projects/maz-org-squire/bcm-claude-elegant-buck-design-20260409-080839.md` (APPROVED)
**Linear issue:** SQR-38
**Blocked by:** SQR-34 (Postgres migration)
**Approach:** Modular (src/auth/google.ts + src/auth/session-middleware.ts)

---

## Step 0: Scope Challenge

### 1. What existing code already solves sub-problems?

| Sub-problem               | Existing code                                                                             | Reuse?                          |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| User table                | `src/db/schema/core.ts:28-34` (users with googleSub, email, name)                         | YES, as-is                      |
| Sessions table            | `src/db/schema/core.ts:36-49` (sessions with id, userId, expiresAt, ipAddress, userAgent) | YES, add `last_seen_at` only    |
| OAuth token hashing       | `src/auth/hashing.ts` (SHA-256 hex)                                                       | Consider for session IDs        |
| Audit logging             | `src/auth/audit.ts` (writeAuditEvent)                                                     | YES, for Google OAuth events    |
| Bearer middleware pattern | `src/server.ts:294-311` (requireBearerAuth)                                               | Model for session middleware    |
| Test DB helpers           | `test/helpers/db.ts` (setupTestDb, resetTestDb)                                           | YES, add sessions to truncate   |
| Dev user seed             | `src/seed/seed-dev-user.ts`                                                               | YES, for testing without Google |
| OAuth test helpers        | `test/helpers/server-oauth-helpers.ts`                                                    | Model for session test helpers  |

### 2. Minimum set of changes

**New files (2):**

- `src/auth/google.ts` -- Google OAuth flow (buildAuthUrl, handleCallback, verifyIdToken, ALLOWED_EMAILS)
- `src/auth/session-middleware.ts` -- Hono middleware (read cookie, load session, attach userId)

**Modified files (4-5):**

- `src/server.ts` -- 4 new routes (/auth/google/start, callback, logout, /auth/me) + session middleware
- `src/db/schema/core.ts` -- add `lastSeenAt` to sessions
- `test/helpers/db.ts` -- sessions in truncate order
- `docs/ARCHITECTURE.md` -- update Authentication section
- New migration SQL -- add `last_seen_at` column

**New test file (1):**

- `test/auth-google.test.ts` -- all 12 test cases

### 3. Complexity check: 6-7 files touched, 0 new classes. Under the 8-file threshold. No smell

### 4. Search check

- **[Layer 1]** `google-auth-library` for ID token verification. Google's own library.
- **[Layer 1]** Hono's built-in `hono/cookie` for signed cookies. Framework built-in.
- **[Layer 1]** `crypto.randomUUID()` for session IDs. Node built-in.
- No custom solutions where built-ins exist. No scope reduction needed.

### 5. TODOS cross-reference: No TODOS.md exists

### 6. Completeness check: 100% test coverage for all auth paths. No shortcuts

### 7. Distribution check: N/A. Web service feature on existing Hono server

**Scope verdict: ACCEPTED AS-IS.** Clean scope, minimal diff, reuses existing patterns extensively.

---

## Section 1: Architecture Review

### Finding 1: Session ID hashing decision (confidence: 8/10)

The existing OAuth tokens hash secrets at rest (SHA-256 hex as PK). The `sessions` table uses plaintext `text` PK for session IDs.

**Decision:** Don't hash. Cookie attributes (HttpOnly + Secure + SameSite=Strict + signed) already provide strong protection. OAuth tokens are hashed because MCP bearer tokens live in client-accessible environments (env vars, config files); cookies don't. Revisit for Phase 3 multi-user.

### Finding 2: Audit logging for Google OAuth events (confidence: 9/10)

**Decision:** YES. Reuse `writeAuditEvent()` from `src/auth/audit.ts`. Add event types: `google_login`, `google_login_denied`, `google_logout`. ~5 lines of code for a complete audit trail.

### Finding 3: PKCE state cookie security (confidence: 7/10)

**Decision:** Sign the PKCE cookie with `SESSION_SECRET` using Hono's `setSignedCookie()`. 5-minute expiry. Clear on consumption.

### Finding 4: `/auth/me` placement (confidence: 9/10)

**Decision:** `/auth/me` sits behind session middleware. Returns 401 if no valid session. Returns `{ id, email, name }` when authenticated.

---

## Section 2: Code Quality Review

### Finding 5: Separation from existing auth facade (confidence: 8/10)

**Decision:** Keep `src/auth/google.ts` separate from `src/auth.ts`. The MCP OAuth facade wraps the SDK's `OAuthServerProvider` interface (Squire as OAuth server). Google OAuth makes Squire an OAuth client. Different problem, different abstraction.

### Finding 6: Error handling in callback (confidence: 9/10)

**Decision:** Google OAuth callback errors return HTML error pages (not JSON). The user is in a browser flow, not an API client. Minimal error page with message and "try again" link. Don't reuse `oauthErrorResponse()` which is for MCP/API clients.

---

## Section 3: Test Review

### Code Path Coverage Diagram

```text
CODE PATH COVERAGE
===========================
[+] src/auth/google.ts (NEW)
    |
    +-- buildAuthUrl(state, codeVerifier)
    |   +-- [PLANNED] Generates Google consent URL with PKCE + state
    |   +-- [PLANNED] Sets PKCE cookie (signed, 5-min expiry)
    |
    +-- handleCallback(code, state, cookieState, cookieVerifier)
    |   +-- [PLANNED] Verify state matches cookie state
    |   |   +-- [PLANNED] Mismatch -> 400
    |   +-- [PLANNED] Exchange code for tokens with Google
    |   |   +-- [PLANNED] Exchange failure -> 400
    |   +-- [PLANNED] Verify ID token (google-auth-library)
    |   |   +-- [PLANNED] Verification failure -> 400
    |   +-- [PLANNED] Check email in ALLOWED_EMAILS
    |   |   +-- [PLANNED] Not allowed -> 403, no user upsert, no session
    |   +-- [PLANNED] Upsert user (googleSub, email, name)
    |   +-- [PLANNED] Create session row
    |   +-- [PLANNED] Set session cookie (signed, 30-day)
    |   +-- [PLANNED] Redirect to /
    |
    +-- verifyGoogleIdToken(idToken, clientId)
        +-- [PLANNED] Wraps google-auth-library verifyIdToken()

[+] src/auth/session-middleware.ts (NEW)
    |
    +-- sessionMiddleware()
    |   +-- [PLANNED] Read signed cookie
    |   |   +-- [PLANNED] Missing cookie -> 401
    |   +-- [PLANNED] Load session from Postgres (WHERE expires_at > now())
    |   |   +-- [PLANNED] Session not found / expired -> delete row, 401
    |   +-- [PLANNED] Update last_seen_at
    |   +-- [PLANNED] Attach userId to Hono context via c.set()
    |
    +-- destroySession(sessionId)
        +-- [PLANNED] Delete session row + clear cookie

[+] src/server.ts (MODIFIED)
    |
    +-- GET /auth/google/start -> redirect to Google
    +-- GET /auth/google/callback -> exchange, verify, upsert, session, cookie
    +-- POST /auth/logout -> destroy session, clear cookie
    +-- GET /auth/me -> { id, email, name }
    +-- app.use('/chat', sessionMiddleware())

USER FLOW COVERAGE
===========================
[+] Login: unauthenticated -> /auth/google/start -> Google -> callback -> cookie -> /
[+] Rejection: disallowed email -> 403 | invalid state -> 400 | token failure -> 400
[+] Session lifecycle: expired -> delete + 401 | logout -> delete + clear + redirect

COVERAGE: 0/17 paths (all planned)
QUALITY: all ★★★ (behavior + edge cases + error paths)
GAPS: 0
```

### Planned Tests (12 cases)

```text
test/auth-google.test.ts (NEW)
  1.  callback happy path: valid code -> user upserted -> session -> cookie -> redirect /
  2.  callback email not in allowlist -> 403, no session, no user upsert
  3.  callback invalid state -> 400
  4.  callback Google token verification failure -> 400
  5.  callback Google code exchange failure -> 400
  6.  session middleware: valid cookie -> userId on context
  7.  session middleware: missing cookie on /chat -> 401
  8.  session middleware: expired session -> 401, session deleted
  9.  logout: destroys session and clears cookie, redirects /
  10. cookie attributes: HttpOnly, Secure (conditional), SameSite=Strict, signed
  11. session restart regression: create session, tear down pool, verify session loads
  12. route isolation: cookie auth on /chat + bearer auth on /mcp coexist
```

---

## Section 4: Performance Review

### Finding 7: Session lookup on every request (confidence: 9/10)

No action for Phase 1. Single-user, <1ms indexed lookup. Consider LRU cache for Phase 3 multi-user.

### Finding 8: `last_seen_at` UPDATE on every request (confidence: 7/10)

No action for Phase 1. Leave a code comment noting future debounce opportunity for Phase 3.

---

## NOT in scope

| Item                       | Rationale                        |
| -------------------------- | -------------------------------- |
| CSRF protection            | SQR-39, separate issue           |
| Multi-user allowlist       | Phase 3                          |
| Session ID hashing at rest | Phase 3 defense-in-depth         |
| In-memory session cache    | Phase 3 performance              |
| Refresh token rotation     | Long-lived sessions per ADR 0002 |
| Email verification         | Google handles it                |
| Password auth              | Not an option per ADR 0009       |

## What already exists

| Existing code                                | Reused?                         |
| -------------------------------------------- | ------------------------------- |
| `src/db/schema/core.ts` users table          | YES, as-is                      |
| `src/db/schema/core.ts` sessions table       | YES, add lastSeenAt             |
| `src/auth/audit.ts` writeAuditEvent()        | YES, for login/logout           |
| `src/server.ts:294-311` requireBearerAuth()  | MODEL for session middleware    |
| `test/helpers/db.ts` setupTestDb/resetTestDb | YES, add sessions to truncate   |
| `test/helpers/server-oauth-helpers.ts`       | MODEL for session test helpers  |
| `src/seed/seed-dev-user.ts` DEV_USER         | YES, for testing without Google |

## Failure Modes

| Failure                       | Test?                     | Error handling?               | User sees?         |
| ----------------------------- | ------------------------- | ----------------------------- | ------------------ |
| Google consent denied         | PLANNED                   | Callback checks `error` param | Error page         |
| Token exchange failure        | PLANNED (#5)              | 400                           | HTML error page    |
| ID token verification failure | PLANNED (#4)              | 400                           | HTML error page    |
| Email not in allowlist        | PLANNED (#2)              | 403                           | "Not invited" page |
| Cookie tampered               | Signed verification fails | Treated as missing            | 401                |
| Session expired               | PLANNED (#8)              | Delete row, 401               | Redirect to login  |
| Postgres down                 | Not tested (infra)        | 500                           | Generic error      |
| SESSION_SECRET missing        | Startup check             | Refuse to start               | Startup error      |

**Critical gaps: 0.**

## Key Implementation Decisions

1. **Secure cookie is conditional:** `Secure=true` only in production or when URL scheme is HTTPS. Dev runs HTTP on localhost where Secure cookies don't stick.
2. **Allowlist keyed to email** (not google_sub). Human-readable, matches ADR 0009. If email changes, edit one constant.
3. **Table name is `sessions`** (not `web_sessions` as ADR 0009 originally said). Schema file is source of truth.
4. **google-auth-library** goes in `dependencies` (not devDependencies). It's imported at runtime.

## Outside Voice (Codex)

Codex ran an independent plan challenge. 7 findings:

- 3 tension points resolved by user (Secure cookie conditional, email allowlist, 2 extra tests)
- 4 already addressed or non-issues (auth boundary, OAuth server/client separation, hidden deps, table naming)

Cross-model agreement: Both Claude and Codex agree on the modular approach and isolation of Google OAuth from MCP OAuth. Codex caught 3 genuine gaps that the initial review missed.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status       | Findings                  |
| ------------- | --------------------- | ------------------------------- | ---- | ------------ | ------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 0    | --           | --                        |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 0    | --           | --                        |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | CLEAR (PLAN) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 0    | --           | --                        |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | --           | --                        |

- **OUTSIDE VOICE:** Codex plan review ran. 7 findings, 3 resolved, 4 already addressed.
- **CROSS-MODEL:** Claude and Codex agree. Codex caught 3 genuine gaps (Secure cookie, restart test, route isolation test).
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED -- ready to implement.
