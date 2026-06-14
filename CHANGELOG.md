# Changelog

## [0.1.19] - 2026-06-14

### Added

- Added the Squire telemetry boundary for Sentry initialization, capture, breadcrumbs, flushing, diagnostic metadata, safe tags, and recursive redaction.
- Added telemetry unit tests for local no-DSN no-ops, stable diagnostic fields, safe tag allowlisting, and protected-field redaction.

## [0.1.18] - 2026-06-14

### Added

- Added the Fly Sentry provisioning runbook, local no-DSN behavior, and the Sentry/LangSmith ownership boundary for app observability.
- Added config and deployment tests that keep `SENTRY_DSN` optional locally, validate malformed DSNs when present, and prevent DSNs from being committed to `fly.toml`.

### Changed

- Stamped production Fly deploys with `SENTRY_RELEASE` from the tested Git SHA so later Sentry events can correlate to the exact release.

## [0.1.17] - 2026-06-02

### Added

- Documented the final security gate contract for actionlint, Dependency Review, CodeQL, Dependabot alerts, secret scanning alerts, and Security Alert Linear Sync.
- Added SQR-26 audit evidence covering alert routing dry runs, current GitHub security alert counts, runtime audit status, recent workflow health, and the Semgrep decision.

### Changed

- Updated production operations runbooks with the GitHub secrets and commands operators need to validate security-alert routing.
- Removed stale Copilot Autofix wording from the security review and pinned the current CodeQL workflow contract in tests.

## [0.1.16] - 2026-06-01

### Added

- Added the Gloomhaven (2nd Edition) Marker/Datalab rulebook refresh command, including full-rulebook cost guardrails, production source promotion, and extraction metadata recording.
- Added the full Marker/Datalab extraction artifact, manifest, and report for the refreshed Gloomhaven (2nd Edition) rulebook source.

### Changed

- Replaced the Gloomhaven (2nd Edition) rulebook OCR snapshot with the selected Marker/Datalab normalized source while keeping Apple Vision documented as the local fallback path.
- Updated GH2 rule-source metadata and docs with provider, hashes, capture date, refresh procedure, and reindex/smoke-test steps.

## [0.1.15] - 2026-05-28

### Added

- Added production data game scopes for Frosthaven-only, Gloomhaven 2e-only, and all-game seed and reindex workflows.
- Added production smoke checks that run game-scoped rules search, verify a structured item lookup, and confirm Frosthaven still responds after a GH2-scoped refresh.

### Changed

- Scoped production embedding rebuilds and stale-source deletion to the selected game unless the operator explicitly chooses all games.
- Updated GH2 production refresh runbooks, development docs, architecture notes, and the product spec to reflect current Frosthaven and Gloomhaven 2e support.

## [0.1.14] - 2026-05-27

### Added

- Moved eval execution onto native LangSmith datasets and experiments, with dataset-linked experiment rows, feedback metrics, and local report experiment URLs.
- Added LangSmith dataset loading and stale/missing dataset validation before eval execution.

### Changed

- Published eval fixtures with `caseId` inputs and `expectedOutput` outputs so LangSmith datasets are the execution source while `eval/suites/*` remains the checked-in publish source.
- Removed local fixture-only eval execution outside the dataset-backed matrix report path.

## [0.1.13] - 2026-05-27

### Changed

- Improved Gloomhaven (2nd Edition) condition-rule retrieval so core definitions stay ahead of loose FAQ keyword hits while interaction questions still use normal relevance ordering.
- Updated GH2 eval expectations for advantage and direct open-ref cross-game boundary prompts to match the checked-in rules and prompt wording.
- Marked structured `ok: false` tool payloads as unsuccessful evidence in agent trajectories.
- Updated agent prompts to search current FAQ/errata before opening section references for correction or outdated-reference questions.

### Fixed

- Restored GH2 scenario/section seed data after canonical-ref cleanup tests so shuffled DB test runs keep GH2 records available.

## [0.1.12] - 2026-05-25

### Added

- Added an active-game selector for Frosthaven and Gloomhaven (2nd Edition) in the authenticated chat header.
- Added local browser persistence for the selected game, including fallback behavior for unsupported stored values.
- Added web chat routing so selected games are validated, stored on user turns, and forwarded through SSE and non-SSE agent paths.

### Changed

- Updated Frosthaven-only UI and runtime copy to describe Squire as a supported Haven rules companion.
- Restored shared GH2 item fixtures after cross-game isolation tests so shuffled DB test runs keep imported GH2 data available.

## [0.1.11] - 2026-05-25

### Added

- Added GH2 GHS extracted data for supported card tables, including items, monsters, events, battle goals, character data, personal quests, and scenario cards.
- Added GH2 scenario and section metadata extracts, plus all-game seeding for card and scenario/section runtime tables.
- Added game-scoped extracted-data paths and refresh workflow coverage for `data/extracted/gh2/`.

### Changed

- Documented GH2 import coverage, unsupported building data, and deferred treasure imports.
- Tightened cross-game seed/search tests so GH2 records do not fall back to Frosthaven data.

## [0.1.10] - 2026-05-24

### Added

- Added structured `answer-artifact` SSE events for safe section quote blocks that render outside answer prose.
- Added browser rendering for section artifacts using text-only DOM insertion, plus regressions for artifact SSE mapping, hostile text handling, and final answer replacement.

## [0.1.9] - 2026-05-24

### Added

- Added browser-visible `tool-progress` SSE events so safe agent progress can render as compact metadata rows without becoming answer prose.
- Added regression coverage for progress rows, final-answer-only `text-delta`, final HTML replacement, and consulted-source footer preservation.

## [0.1.8] - 2026-05-17

### Changed

- Split the normal Vitest suite into a parallel isolated slice and a serial DB-backed slice so PR CI can recover safe file parallelism without adding per-worker databases.
- Added explicit unit, DB, split, and serial coverage commands, with development docs describing when to use each path.

## [0.1.7] - 2026-05-06

### Changed

- Picked the Phase 1 hosting platform: Fly.io app + Fly Managed Postgres (Basic) in one region, no staging tier. Cloudflare in front as the WAF. App-to-DB traffic stays on Fly's private 6PN. Migrations run via Fly's `release_command` before traffic cutover (failure aborts the deploy and leaves the prior version live).
- Recorded reasoning, six alternatives evaluated (Neon-paired Fly, legacy unmanaged Fly Postgres, Railway, Render, VPS, Cloudflare Workers), and re-evaluation triggers in [ADR 0016](docs/adr/0016-phase-1-hosting-platform.md).
- Updated `docs/ARCHITECTURE.md` §Deployment, §Cost, §Open Tech Questions, and §Changelog to reflect the concrete pick (production budget ~$55–75/mo within the $100/mo Phase 1 cap).

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
