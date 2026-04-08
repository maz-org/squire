---
type: ADR
id: "0007"
title: "Integration tests run against a real Postgres, no mocks"
status: active
date: 2026-04-07
---

## Context

Pre-migration, tests that touched extracted-card data mocked `node:fs`
(`vi.mock('node:fs', …)` with FAKE_* fixtures) and tests that touched the
vector store operated on the in-process cache. This worked while data was
flat files, but the storage migration put Postgres + pgvector on the critical
path for every tool call.

The question was how to handle the DB in tests. Three options were live:

1. Full integration against a real Postgres via CI service containers.
2. A thin unit layer mocking `drizzle`, with a smaller integration suite.
3. A hexagonal repo interface with an in-memory implementation for unit
   tests and a Postgres implementation for integration tests.

The project has one maintainer, one deployment target, and a strong
preference (documented in `feedback_structural_fix_over_test.md` and
`CLAUDE.md`) for structural guarantees over runtime mocks.

## Decision

**All tool tests run against a real Postgres.** `tools.test.ts`,
`extracted-data.test.ts`, `vector-store.test.ts`, `mcp-in-process.test.ts`,
`server.test.ts`, and `service.test.ts` all use a real test database via the
CI Postgres service container. Each test either wraps in a transaction that
rolls back, or uses `TRUNCATE ... RESTART IDENTITY CASCADE` in `beforeEach`.
No mocking of Drizzle. No `vi.mock('node:fs')` for card data.

Test helpers live in `test/helpers/db.ts` — `setupTestDb()` once in `beforeAll`
and `resetTestDb()` in `beforeEach`. Seeding uses the same `seedCards()` module
the prod flow uses, so seed scripts are test-verified for free.

## Options considered

- **Option A** (chosen): Full integration against real Postgres. Matches the
  production code path exactly; mocked-drizzle-vs-real-drizzle divergence can
  never mask a broken migration; seed scripts get test coverage as a
  side-effect. Cost: suite runtime ~5–10s vs ~2s before.
- **Option B**: Mock Drizzle at the query-builder level. Rejected: mocks pin
  the call shape, not the behavior, and would drift as Drizzle evolves. The
  whole class of bugs we're guarding against (wrong SQL, bad migration, bad
  operator precedence on pgvector) is invisible to a mock.
- **Option C**: Hexagonal repo interface with in-memory + Postgres
  implementations. Rejected: adds an abstraction layer whose only job is to
  make tests faster, and doubles the test matrix (every behavior runs twice).
  Not worth it for a solo project with a ~10s budget.

## Consequences

- **Easier:** tests exercise real SQL against real pgvector, real FTS, real
  constraints; regressions in migrations surface immediately; no mock/prod
  divergence; seed scripts are implicitly test-verified.
- **Harder:** CI needs a Postgres service container (added in SQR-32).
  Local tests need Docker running. Suite runtime ~5× longer. Target: under
  15s total; if it grows past that, add a per-worker test DB pool with
  schema-per-worker.
- **Re-evaluate if:** suite runtime grows past ~30s and starts affecting
  iteration speed; or if a class of bugs appears that the integration suite
  can't catch and a unit layer would.

## Advice

Decided during `plan-eng-review` on 2026-04-07 (Decision 10 in
`docs/plans/storage-migration-review-checkpoint.md`). Aligns with the
existing `feedback_structural_fix_over_test.md` preference and with Kent
Beck's "structure-insensitive" desiderata now captured in
`docs/agent/testing.md`.
