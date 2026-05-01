# Changelog

## [0.1.7] - 2026-05-01

### Added

- Eval runs can now render every Squire agent tool as an OpenAI strict function schema, with stable schema version and hash values for trace metadata.
- Added tests that reject unsupported future tool schema shapes, remove defaults, close object schemas, convert optional inputs to nullable required fields, and preserve the Anthropic tool definitions.

### Fixed

- OpenAI eval tool calls now normalize nullable placeholder fields before dispatch, including closed `list_cards` filters with known card fields.

## [0.1.6] - 2026-04-29

### Changed

- Added the SQR-122 retrieval eval decision report comparing the legacy and redesigned tool surfaces on the same 29-case eval suite.
- Kept Phase 1 production on the legacy prompt-routed tool surface while leaving the redesigned surface selectable for evals and follow-up work.
- Added eval runner flags for selecting the tool surface and writing local JSON reports with per-case latency, token, tool-call, and scoring data.
- Tightened the server CLI entrypoint guard so importing `src/server.ts` in tests cannot start the HTTP server as a side effect.

## [0.1.5] - 2026-04-28

### Added

- Added trajectory-only Langfuse eval cases for Frosthaven tool-path quality, with schema validation, stale remote dataset checks, and trajectory scoring for required tools, tool kinds, refs, and call budgets.
- Added eval tests covering the new dataset shape, stale Langfuse dataset detection, and trajectory ref normalization.

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
