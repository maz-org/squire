# Changelog

## [Unreleased]

### Added (Unreleased)

- Deterministic scenario/section-book research data in Postgres via `scenario_book_scenarios`, `section_book_sections`, and `book_references`
- Four exact research tools: `find_scenario`, `get_scenario`, `get_section`, and `follow_links`

### Changed (Unreleased)

- `search_rules` now sits alongside exact scenario/section traversal instead of carrying the whole story-book lookup path by itself
- `npm run seed` now seeds both card data and scenario/section-book data, and `npm run seed:dev` adds the local dev user on top

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
