# Changelog

## [0.1.4] - 2026-04-21

### Fixed

- The "consulted" footer now shows the actual Frosthaven books that were searched rather than always displaying "Rulebook". When a rules search hits the Section Book, Scenario Book, or Puzzle Book, those books are now correctly attributed. Empty searches no longer falsely claim any book was consulted.
- Added Puzzle Book as a recognised provenance source in the consulted footer (it was missing despite being indexed).
- Answers replayed from the database now carry accurate per-book provenance (pre-existing answers continue to display as before).

## [0.1.3] - 2026-04-19

### Fixed

- Drop cap (Fraunces wax-red `::first-letter`) now renders on completed and persisted answers that open with a heading, unordered list, ordered list, or blockquote before their first paragraph. The previous `p:first-child` selector suppressed the drop cap whenever a non-`<p>` block appeared first — a common LLM response shape. The selector is now `p:first-of-type`, which targets the first top-level paragraph regardless of preceding sibling elements. Regression tests cover heading, list, and blockquote leads.

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
