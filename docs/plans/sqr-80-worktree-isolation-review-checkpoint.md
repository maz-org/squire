# SQR-80 Worktree Isolation — Eng Review Checkpoint

**Session:** `plan-eng-review` for Linear issue `SQR-80`
**Started:** 2026-04-09
**Branch:** `bcm/sqr-80-devex-isolate-worktrees-so-agents-can-run-in-parallel-safely`
**Reviewer:** Codex using the gstack `plan-eng-review` workflow
**Status:** Initial review drafted from repo + Linear issue context

This file is the durable review record for SQR-80. If a later session picks
this up, read:

- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/agent/planning-artifacts.md`
- this file
- Linear issue `SQR-80`

Then continue from **Recommended execution plan** below.

---

## Issue scope

Linear `SQR-80` says parallel agent work is fragile because worktrees appear to
share local runtime resources. The requested audit scope is:

- test databases
- dev databases
- app ports

Acceptance criteria in the issue:

- two worktrees can run the test suite concurrently without interfering
- two worktrees can run the dev server concurrently without manual port surgery
- local defaults are predictable enough that agents can discover the correct
  DB/port for the current worktree
- the isolation model is documented clearly enough for future agents and humans

---

## Facts from the current codebase

### 1. Database defaults are shared across all checkouts today

`src/db.ts` currently exports fixed defaults:

- dev DB: `postgres://squire:squire@localhost:5432/squire`
- test DB: `postgres://squire:squire@localhost:5432/squire_test`

`resolveDatabaseUrl()` picks between them based only on `NODE_ENV` / `VITEST`.
It does **not** consider the current worktree path, branch, or checkout.

### 2. Test helpers all target the same default test database

`test/helpers/db.ts` and `test/helpers/global-setup.ts` both call
`resolveDatabaseUrl()`, then truncate mutable tables in that database. That
means two worktrees running `npm test` against defaults will both hit
`squire_test` and can wipe each other's state.

### 3. The dev server uses one fixed default port

`src/server.ts` currently resolves the listen port as:

- `process.env.PORT`, else
- `3000`

So two worktrees running `npm run serve` with no env override will collide.

### 4. The local Postgres bootstrap only pre-creates one test database

`docker-compose.yml` starts one Postgres instance on `localhost:5432`.
`scripts/init-db.sql` creates:

- `squire`
- `squire_test`

It does **not** create per-worktree databases.

### 5. The migration/reset scripts assume fixed DB names

Current script behavior:

- `scripts/db-migrate.ts` migrates whatever `resolveDatabaseUrl()` returns, but
  it does not create a missing database first
- `scripts/db-reset.ts` only allows `squire` and `squire_test`

So if SQR-80 changes defaults to per-worktree DB names, these scripts must
change too or new worktrees will fail on first use.

### 6. Hooks are already configured worktree-relatively in this repo

`git config --get core.hooksPath` returns `.husky/_`.

That is a relative path, and this repo already keeps hook scripts in the
checkout-local `.husky/` directory. So the hook-path problem is **not** the
current blocker in this branch/repo state. It is adjacent history, but not the
main SQR-80 implementation seam.

---

## Review conclusions

### A. Test DB isolation is mandatory

This is the clearest failure mode and is directly evidenced by the current
helpers truncating shared tables in `squire_test`.

### B. Port isolation is mandatory

Current fixed-port behavior cannot satisfy the issue acceptance criteria.

### C. Dev DB isolation should be added too

This is a recommendation, not a present-day fact.

Reasoning:

- the dev DB currently stores mutable app state (`users`, `sessions`,
  `oauth_*`, `embeddings`)
- `db:reset`, `db:migrate`, `seed`, and `index` all operate on that one shared
  logical database by default
- a shared dev DB undermines "parallel agents can run safely" once one worktree
  is changing schema or resetting data

This is the stronger isolation model and better matches the ticket intent.

### D. Hook isolation is not part of the critical path

Because `core.hooksPath` is already relative, SQR-80 should focus on DBs,
ports, and documentation. Hook behavior can stay out of scope unless new
evidence appears.

---

## Recommended isolation model

### Decision 1. Introduce one checkout-local runtime identity helper

Add a small runtime helper module that derives a stable checkout identity from
the current repo root path.

The helper should expose:

- repo root path for the current checkout
- whether this checkout is the main checkout or a linked worktree
- a short stable checkout slug derived from the absolute checkout path

Recommended implementation shape:

- compute repo root from file location / project root, not `process.cwd()`
- hash the absolute checkout root to a short hex slug
- keep the slug deterministic across runs inside the same checkout

Why:

- DB names and ports need one shared derivation rule
- the value must not depend on branch name alone, because detached worktrees are
  possible in Codex

### Decision 2. Default resource naming should be per-checkout

Recommended defaults:

- main checkout dev DB: `squire`
- main checkout test DB: `squire_test`
- linked worktree dev DB: `squire_<slug>`
- linked worktree test DB: `squire_<slug>_test`

This preserves existing ergonomics in the primary checkout while isolating
parallel worktrees.

If the implementation cannot reliably distinguish main checkout from linked
worktree without ugly Git shell-outs at runtime, fall back to a simpler rule:

- every checkout gets `squire_<slug>` / `squire_<slug>_test`

That is more disruptive but still correct.

### Decision 3. Default port should be deterministic per checkout

Recommended rule:

- `PORT` env var always wins
- otherwise derive a default port from the checkout slug in a reserved local
  range

Properties required:

- deterministic for a given checkout
- different across sibling worktrees with overwhelming probability
- printed loudly on startup so agents/humans can discover it immediately

### Decision 4. Migration/reset scripts must become checkout-aware

Minimum required changes:

- `db:migrate` must create the target database if it does not exist yet
- `db:migrate:test` must do the same for the test database
- `db:reset` must allow the derived managed DB names, not just `squire` and
  `squire_test`

If these scripts are not updated, per-worktree defaults will be unusable.

### Decision 5. Documentation must describe the model as "deterministic local defaults"

`docs/DEVELOPMENT.md` should explain:

- how the current checkout gets its DB names and default port
- that env vars still override the defaults
- what commands provision a fresh worktree
- how to discover the current checkout's runtime settings

The issue explicitly asks for agent-discoverable defaults, so the docs should
teach that model directly.

---

## Recommended execution plan

### Phase 1. Add the checkout-identity helper

Implement one helper module for:

- checkout root detection
- checkout slug derivation
- default DB name derivation
- default port derivation

Keep all naming logic in one place so tests and scripts use the same rule.

### Phase 2. Thread that helper through the DB layer

Update:

- `src/db.ts`
- `scripts/db-migrate.ts`
- `scripts/db-reset.ts`
- any tests that assert fixed default URLs

Expected behavior after this phase:

- default dev/test URLs are checkout-aware
- migrate scripts can bootstrap missing per-worktree DBs
- reset scripts only operate on managed local DB names

### Phase 3. Thread the helper through server startup

Update `src/server.ts` so startup resolves:

- `PORT` env override first
- otherwise checkout-derived default port

Startup log should print the final port explicitly.

### Phase 4. Add regression coverage

Minimum tests:

- default DB URL derivation for main checkout
- default DB URL derivation for linked worktree
- default port derivation stability
- `db:reset` managed-name allowlist behavior

If script tests are awkward, unit-test the pure helper and keep script logic as
thin as possible around it.

### Phase 5. Update developer docs

Update `docs/DEVELOPMENT.md` with:

- deterministic per-worktree DB/port behavior
- bootstrap steps for a fresh worktree
- override rules via env vars
- examples for running two worktrees concurrently

---

## Risks and tradeoffs

### 1. Per-worktree dev DBs increase local setup cost

This is the main tradeoff.

Each worktree may need its own:

- migrations
- seeded card data
- vector index

That costs time and disk, but it buys strong isolation. If this becomes too
heavy in practice, a later follow-up can explore sharing read-only seed data
while still isolating mutable tables. That is a separate design.

### 2. "Derived default" bugs can be hard to notice if the derivation is spread out

This is why one helper module is important. Port math and DB-name math should
not be reimplemented in multiple scripts.

### 3. Port collisions are still theoretically possible with hashed ports

Use a large enough local range and deterministic logging. The issue only needs
practical collision avoidance, not a formally unique lease system.

---

## Out of scope for this ticket

- changing how Codex or Claude creates worktrees
- dynamic port allocation via a port server or lock file
- shared read-only base databases with copy-on-write overlays
- hook-system redesign beyond the already-relative `.husky/_` setup

---

## Next implementation checkpoint

When implementation starts, the first code pass should touch:

- `src/db.ts`
- `src/server.ts`
- `scripts/db-migrate.ts`
- `scripts/db-reset.ts`
- `test/db.test.ts`
- `docs/DEVELOPMENT.md`

If that first pass cannot support both main-checkout compatibility and linked
worktree isolation cleanly, prefer correctness and deterministic isolation over
preserving the old `squire` / `squire_test` defaults.
