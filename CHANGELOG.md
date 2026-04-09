# Changelog

## Unreleased

- checkout-local runtime defaults for dev DBs, test DBs, and local server ports
  so parallel worktrees stop sharing the same local runtime by accident
- two planning artifacts for SQR-80: an engineering review checkpoint and a QA
  plan under `docs/plans/`

- linked worktrees now coordinate local port claims inside the managed
  `4000-5999` range instead of trusting a pure hash-to-port mapping
- migration/reset scripts, runtime DB resolution, and tests now share the same
  checkout-local database naming model
- README, DEVELOPMENT, and CONTRIBUTING now explain the worktree-local runtime
  model and bootstrap expectations more clearly

## [0.1.2] - 2026-04-09

### Added

- Google OAuth web login with PKCE and server-side Postgres sessions
- Session-aware layout shell: logged-in users see full interaction chrome, logged-out visitors see brand-only chrome
- Auth error pages rendered in the Squire design system (dark theme, monogram, retry link)
- Repository layer: SessionRepository and UserRepository with explicit domain types, Drizzle relations, and row-to-domain mapping
- Session domain type passed to views instead of Hono Context (view layer decoupled from web framework)
- optionalSession() middleware for public pages (homepage adapts to auth state)
- Email/sub conflict detection: rejects login with opaque error, logs critical event
- 11 Linear issues created for deferred security hardening (session GC, hash-at-rest, rate limiting, etc.)

### Changed

- Layout shell accepts Session object instead of Hono Context
- Hono ContextVariableMap declares session (with user) instead of bare userId
- prettier added to markdown lint-staged pipeline (fixes table formatting in generated docs)
- ARCHITECTURE.md updated to reflect two-system auth architecture (cookie vs bearer)
- Planning artifacts doc updated with markdown formatting guidance
