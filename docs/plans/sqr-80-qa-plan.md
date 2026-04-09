# SQR-80 — QA plan for worktree isolation

**Issue:** [SQR-80](https://linear.app/maz-org/issue/SQR-80/devex-isolate-worktrees-so-agents-can-run-in-parallel-safely)
**Review checkpoint:** [docs/plans/sqr-80-worktree-isolation-review-checkpoint.md](./sqr-80-worktree-isolation-review-checkpoint.md)
**Goal:** verify that SQR-80 actually makes local runtime defaults safe and predictable across parallel worktrees.

---

## QA approach

This is a local-dev and tooling ticket, not a user-facing feature ticket.

So QA should focus on:

- runtime behavior under parallel worktrees
- deterministic default resolution
- env-var override behavior
- docs accuracy

Do not treat a passing unit-test suite alone as sufficient. SQR-80 only counts
as done if the real local workflow works from two separate worktrees.

---

## Acceptance criteria under test

From SQR-80:

1. Worktree-local runtime defaults are deterministic: from a given checkout,
   Squire can derive the correct default dev DB, test DB, and dev-server port
   without manual setup.
2. Parallel worktrees are isolated by default: two separate worktrees can run
   local tests and local dev servers concurrently without colliding when using
   defaults.
3. Overrides still work cleanly: explicit `DATABASE_URL`,
   `TEST_DATABASE_URL`, and `PORT` environment variables continue to take
   precedence over derived defaults.
4. Local tooling follows the same model: the app runtime, migration/reset
   scripts, and test helpers all resolve the same checkout-local defaults
   instead of each inventing their own behavior.
5. The workflow is documented: `docs/DEVELOPMENT.md` explains how defaults are
   derived, how to discover the current worktree's runtime settings, and how to
   run multiple worktrees in parallel safely.

---

## Test matrix

| AC | What to verify | Evidence |
| --- | --- | --- |
| 1 | One worktree resolves stable defaults for dev DB, test DB, and port | command output + logs + repeated runs |
| 2 | Two worktrees can run tests and dev servers at the same time without collisions | concurrent command runs + health checks |
| 3 | Explicit env vars override derived defaults | command output + logs |
| 4 | App runtime and scripts agree on the same derived names/ports | migrate/reset/test/server behavior |
| 5 | Docs explain the new model correctly | file contents in `docs/DEVELOPMENT.md` |

---

## Test prerequisites

Before running QA:

- have two local worktrees for the same repo
- ensure Docker/Postgres is up
- ensure dependencies are installed in both worktrees
- know each worktree's absolute path so you can confirm the derived values are
  different

Suggested worktrees for the QA run:

- main checkout
- one linked worktree for the SQR-80 branch

---

## Test steps

## 1. Verify issue and docs alignment

Read:

- [docs/plans/sqr-80-worktree-isolation-review-checkpoint.md](./sqr-80-worktree-isolation-review-checkpoint.md)
- [docs/DEVELOPMENT.md](../DEVELOPMENT.md)

Confirm:

- the docs describe the same model the code implements
- the docs explain how defaults are derived
- the docs explain env-var override precedence
- the docs explain how to run two worktrees in parallel safely

Pass condition:

- `docs/DEVELOPMENT.md` is specific enough that a fresh agent could discover
  the current worktree's DB names and port without rediscovery

Failure examples:

- docs only say "it uses worktrees" without explaining the derived defaults
- docs omit how to discover the active DB/port

---

## 2. Verify one worktree gets deterministic defaults

From one worktree, run the commands that expose or log:

- resolved dev DB
- resolved test DB
- resolved default server port

Run them twice from the same checkout.

Pass condition:

- the same checkout resolves the same DB names and port every time
- the values are not dependent on the shell session or current branch state

Failure examples:

- different values on repeated runs from the same checkout
- values depend on current `pwd` inside the repo rather than the checkout root

---

## 3. Verify different worktrees get different defaults

From two different worktrees, compare:

- resolved default dev DB
- resolved default test DB
- resolved default server port

Pass condition:

- linked worktrees resolve different default DB names from each other
- linked worktrees resolve different default ports from each other

If the implementation intentionally preserves `squire` / `squire_test` for the
main checkout, that is acceptable as long as the linked worktree resolves a
different set of defaults.

Failure examples:

- both worktrees still resolve `squire_test`
- both worktrees still default to port `3000`

---

## 4. Verify migration/bootstrap behavior for a fresh worktree

In a worktree that has not used its derived DBs before:

- run the migrate command for the dev DB
- run the migrate command for the test DB

Pass condition:

- the commands succeed without manual DB creation
- the target DB names match the derived defaults for that checkout

Failure examples:

- "database does not exist"
- migrate script uses one DB name but tests/server use another

---

## 5. Verify reset behavior is constrained to managed local DBs

Check `db:reset` behavior for:

- the derived dev DB
- the derived test DB
- a clearly invalid or non-managed DB name

Pass condition:

- reset allows the checkout-managed local DB names
- reset still refuses unrelated or unsafe DB names

Failure examples:

- reset still only allows `squire` and `squire_test`
- reset becomes so permissive that it can target arbitrary DB names

---

## 6. Verify concurrent test runs across two worktrees

Start the test suite in two separate worktrees at the same time, both using
defaults.

Pass condition:

- both suites pass
- neither suite fails due to truncation races, missing rows, or shared-state
  interference

Failure examples:

- one suite wipes rows while the other is running
- flaky failures only appear under concurrency

Evidence to capture:

- command transcripts or summarized outputs from both runs
- final pass/fail status for each worktree

---

## 7. Verify concurrent dev servers across two worktrees

Start `npm run serve` in two separate worktrees at the same time, both using
defaults.

Then:

- capture each server's startup log
- hit each server's health endpoint

Pass condition:

- both servers start successfully without manual port edits
- each worktree reports its own port clearly
- both health checks succeed

Failure examples:

- one server exits with "address already in use"
- server startup logs do not make the active port discoverable

---

## 8. Verify env-var override precedence

From one worktree, explicitly set:

- `PORT`
- `DATABASE_URL`
- `TEST_DATABASE_URL`

Then run the corresponding commands.

Pass condition:

- explicit env vars override the derived defaults
- the override behavior is consistent between app runtime and scripts

Failure examples:

- app respects `PORT` but scripts ignore DB overrides
- one command path still uses the derived default after an override is set

---

## 9. Verify app runtime, scripts, and tests all share one model

Cross-check:

- server startup behavior
- migrate/reset behavior
- test helper behavior

Pass condition:

- they all resolve the same checkout-local DB names and port model
- there is one obvious source of truth in the code

Failure examples:

- server uses one derivation rule while tests use another
- docs say one thing but scripts do another

---

## Exit criteria

SQR-80 QA passes only if all of the following are true:

- deterministic defaults are observable from a single checkout
- different worktrees get isolated defaults
- concurrent tests pass across two worktrees
- concurrent dev servers pass across two worktrees
- env-var overrides still take precedence
- docs accurately describe the implemented model

If any one of those fails, the ticket is not done.

---

## Suggested evidence to keep with the ticket

- the final `docs/DEVELOPMENT.md` section describing worktree-local defaults
- example startup logs from two worktrees showing different ports
- summary of concurrent test results from two worktrees
- note on whether the main checkout keeps legacy defaults or also uses derived
  names
