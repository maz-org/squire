# Changelog

## [0.1.3.0] - 2026-04-09

### Added in 0.1.3.0

- Authenticated web pages now emit a per-session CSRF token for HTMX and form submissions
- Mutating session-cookie routes now reject missing or invalid CSRF tokens before they can destroy session state
- Regression coverage for CSRF header, HTMX fragment, form-urlencoded, and JSON request variants

### Changed in 0.1.3.0

- Logout now clears the session only after passing CSRF validation and still returns cache-safe auth headers
- Architecture and local setup docs now explain the CSRF model and the fresh-worktree bootstrap needed for authenticated QA
- The agent baseline now routes fresh checkout and linked-worktree setup back to the development guide before feature work starts

## [0.1.2] - 2026-04-09

### Added in 0.1.2

- Google OAuth web login with PKCE and server-side Postgres sessions
- Session-aware layout shell: logged-in users see full interaction chrome, logged-out visitors see brand-only chrome
- Auth error pages rendered in the Squire design system (dark theme, monogram, retry link)
- Repository layer: SessionRepository and UserRepository with explicit domain types, Drizzle relations, and row-to-domain mapping
- Session domain type passed to views instead of Hono Context (view layer decoupled from web framework)
- optionalSession() middleware for public pages (homepage adapts to auth state)
- Email/sub conflict detection: rejects login with opaque error, logs critical event
- 11 Linear issues created for deferred security hardening (session GC, hash-at-rest, rate limiting, etc.)

### Changed in 0.1.2

- Layout shell accepts Session object instead of Hono Context
- Hono ContextVariableMap declares session (with user) instead of bare userId
- prettier added to markdown lint-staged pipeline (fixes table formatting in generated docs)
- ARCHITECTURE.md updated to reflect two-system auth architecture (cookie vs bearer)
- Planning artifacts doc updated with markdown formatting guidance
