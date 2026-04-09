# Re-Review: SQR-38 Post-Design-Fix Architecture + Tests

## Context

SQR-38 shipped the core auth implementation (Google OAuth + Postgres sessions), then a
design review caught that auth error pages used raw inline HTML outside the design system.
Three follow-up commits fixed the visual issues and introduced a session-aware layout shell.
This re-review examines the full branch diff (6 commits, 17 files, ~1700 lines) for system
design issues and test coverage gaps that emerged from the rapid iteration.

**Branch:** claude/elegant-buck (6 commits ahead of main)

---

## Architecture Fixes

### 1. Extract session-store.ts from google.ts

google.ts is 377 lines owning two concerns: Google OAuth flow AND generic session CRUD.
session-middleware.ts and session.ts both import session operations from google.ts.

**Create `src/auth/session-store.ts`:**

- `loadSession(sessionId)` -- moved from google.ts
- `destroySession(sessionId, ipAddress?, userAgent?)` -- moved from google.ts
- `getUserById(userId)` -- moved from google.ts
- `createSession(userId, ipAddress?, userAgent?)` -- extracted from handleGoogleCallback
- `SESSION_LIFETIME_MS` -- moved from google.ts
- `getSessionSecret()` -- moved from google.ts (used by session-middleware and server.ts)

**Update imports:** session-middleware.ts, session.ts, server.ts import from session-store.
google.ts imports createSession from session-store.

### 2. Layout reads auth from Hono context, not DB

Currently layoutShell calls isLoggedIn() which hits DB. The requireSession() middleware
already proved auth and set userId on context. Double DB hit per page render.

**Fix:** session.ts replaces `isLoggedIn(c)` with `isAuthenticated(c)` that checks
`c.get('userId') !== undefined`. Zero DB calls. Layout reads context, not DB.

For the homepage (no requireSession middleware): optionally check for session cookie
and set userId on context if valid, so homepage adapts to auth state.

### 3. Simplify session.ts

With Fix 2, session.ts becomes:

```typescript
export function isAuthenticated(c: Context): boolean {
  return c.get('userId') !== undefined;
}
export async function getCurrentUser(c: Context) {
  const userId = c.get('userId');
  if (!userId) return null;
  return getUserById(userId); // one DB call for email/name
}
```

No secret reading, no cookie parsing, no loadSession, no broad try/catch.
Delete getSessionSecretOrNull() entirely.

---

## Code Quality Fixes

### 4. Delete PKCE cookie after callback

Add `deleteCookie(c, PKCE_COOKIE_NAME, { path: '/' })` after successful callback.

### 5. getSessionSecret() lives in session-store.ts

Single source of truth for the 32-char session secret validation.

---

## Test Plan

### Mock Strategy

```text
auth-google.test.ts (OAuth + session integration)
  Mock:  google-auth-library (OAuth2Client)
  Mock:  service.ts, tools.ts
  Real:  Postgres (sessions, users, audit)
  Auth:  Walk full OAuth flow, real cookies

web-ui-layout.test.ts (layout rendering)
  Mock:  service.ts, tools.ts, db.ts
  Auth:  Logged-in: middleware sets c.set('userId', ...)
         Logged-out: no cookie, no userId on context
  Note:  Remove vi.mock of session.ts. Context is the truth.
```

### Coverage Diagram

```text
CODE PATH COVERAGE (post-fixes)
================================
[+] src/auth/session-store.ts (NEW)
    +-- loadSession         [★★★ TESTED] via auth-google #6, #9
    +-- destroySession      [★★★ TESTED] via auth-google #3
    +-- getUserById          [★★★ TESTED] via auth-google #2
    +-- createSession        [★★★ TESTED] via auth-google #1

[+] src/auth/session.ts (SIMPLIFIED)
    +-- isAuthenticated(c)
    |   +-- [GAP] userId present -> true
    |   +-- [GAP] userId absent -> false
    +-- getCurrentUser(c)
        +-- [GAP] with userId -> user object
        +-- [GAP] without userId -> null

[+] src/web-ui/layout.ts
    +-- Logged-in chrome     [★★★ TESTED] existing layout tests
    +-- [GAP] Logged-out chrome (no sidebar, no input dock, no footer)
    +-- [GAP] Homepage logged-out variant

[+] src/web-ui/auth-error-page.ts
    +-- [GAP] squire-banner--error present
    +-- [GAP] retry link href="/auth/google/start"
    +-- [GAP] home link href="/"
    +-- [GAP] layout shell used (squire-header present)

[+] src/server.ts
    +-- [GAP] PKCE cookie deleted after successful callback
    +-- [GAP] Audit event logged after successful login

GAPS: 12 new test cases needed
```

### New Tests (12 cases)

**web-ui-layout.test.ts (4 new):**

- Logged-out: HTML omits squire-rail, squire-input-dock, squire-toolcall, squire-recent
- Logged-out: still renders squire-header, squire-surface, squire-monogram
- Auth error page: squire-banner--error, retry link, home link, layout shell
- Homepage GET / without session: logged-out chrome

**auth-google.test.ts (2 new):**

- PKCE cookie deleted after successful callback (Set-Cookie Max-Age=0 or absent)
- Audit event: oauth_audit_log row with event_type='google_login' after login

**session.ts unit tests (4 new, in existing or new file):**

These become trivial after Fix 3 (context-based). Can fold into layout test:

- isAuthenticated with userId -> true
- isAuthenticated without userId -> false
- getCurrentUser with userId -> user object
- getCurrentUser without userId -> null

**Existing test fixes:**

- web-ui-layout.test.ts: remove vi.mock of session.ts. Instead, for logged-in
  tests, use a helper that creates a real session and attaches the cookie.
  Or set userId directly on context for unit-style layout tests.

---

## Implementation Order

1. Create src/auth/session-store.ts (extract from google.ts)
2. Update imports in google.ts, session-middleware.ts, session.ts, server.ts
3. Simplify session.ts to context-based checks (isAuthenticated)
4. Update layout.ts: import isAuthenticated, check c.get('userId')
5. Fix PKCE cookie cleanup in server.ts
6. Write 6 new tests + update 2 existing
7. Run full suite, verify 0 regressions
8. Single atomic commit

## Verification

```bash
npx tsc --noEmit
npx vitest run  # 556 existing + ~6 new = ~562
```

## NOT in scope

- Session caching (Phase 3 performance)
- CSRF protection (SQR-39)
- Multi-user authorization tests (Phase 3)
- Audit event verification beyond login (existing pattern in auth-provider.test.ts)
