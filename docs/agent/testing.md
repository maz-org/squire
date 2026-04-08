<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Testing Requirements

## Coverage Tiers

This project uses **tiered coverage requirements** based on module type:

- **Core business logic** (card comparison, filtering, scoring, data transformations): **100% coverage required**
- **Integration layers** (API clients, data extraction, parsers): **80-90% coverage target**
- **LLM wrappers** (prompt construction, response parsing): **Test deterministic parts, mock LLM responses**

## Test Pyramid Strategy

Follow the test pyramid with this distribution:

- **~70% Unit Tests**: Fast, deterministic, all external services mocked, run on every commit
- **~25% Integration Tests**: External services mocked, test integration logic, run on every commit
- **~5% E2E Tests**: Real third-party API calls, run on **daily schedule in CI** (not on every commit)

## Test Types

1. **Unit Tests (majority of tests)**
   - Pure functions, business logic, data transformations
   - 100% coverage requirement for core business logic
   - Fast, deterministic
   - All external services mocked
   - Run on every commit

2. **Integration Tests (moderate number)**
   - API client logic, data extraction flows
   - External services mocked (Claude API, GitHub API, etc.)
   - Test error handling, retries, data validation
   - 80-90% coverage target
   - Run on every commit

3. **E2E Tests (small number)**
   - Full user flows with real third-party API calls
   - Include real Claude API calls for screenshot extraction and recommendations
   - **LLM-as-judge approach** for evaluating agent outputs:
     - Another LLM call evaluates if agent's response meets quality criteria
     - Handles non-deterministic outputs gracefully
   - **NOT counted in coverage metrics**
   - Run on **daily schedule in CI**, not on every commit (to control API costs)
   - Acceptable to use live third-party services in these tests

## Mock External Services

- All tests must mock services outside the project boundary to avoid API usage costs
- Exception: E2E tests running on daily CI schedule may use live services
- **Always get explicit approval before implementing tests using live services outside of daily E2E tests**

## Mocking Strategy for LLM Components

- Mock Claude API responses in unit/integration tests
- Create realistic fixtures for common responses
- Test prompt construction and response parsing separately from LLM behavior
- Real API calls reserved for daily E2E validation

## Test-Driven Development (TDD)

**Always** follow the red-green-refactor cycle when writing new code:

1. **Red** — Write a failing test first that defines the expected behavior
2. **Green** — Write the minimal code needed to make the test pass
3. **Refactor** — Clean up while keeping tests green

Do not write implementation before tests. Each feature or fix starts with a test.

## Test Quality Principles

Borrowed from [Kent Beck's test desiderata](https://medium.com/@kentbeck_7670/test-desiderata-94150638a4b3).
The pyramid above covers *fast*, *deterministic*, *automated*, and *predictive*.
These four are the ones most likely to bite us and deserve explicit rules:

- **Structure-insensitive — assert on outputs, not internals.** A test should
  still pass after a pure refactor. Don't pin internal call sequences, private
  helpers, or prompt-string substrings that aren't part of the contract. This
  matters most under our 100% core-coverage rule, which otherwise pressures
  people to test implementation details.
- **Mock at the boundary.** When mocking Claude, GitHub, or Postgres, assert on
  the *behavior the caller observes*, not on the mock's call log — unless the
  call itself is the contract (e.g. "we must send exactly one API request"). A
  mock assertion is a structural assertion in disguise.
- **Specific — one failure, one obvious cause.** Prefer focused tests with
  descriptive names over giant table-driven tests where a red row 37 tells you
  nothing. If a table test is the right shape, make each row's failure message
  self-explanatory.
- **Isolated — no order dependence, no shared state.** Tests must pass in any
  order and in parallel. For Postgres/FTS tests, each test owns its data and
  cleans up (transaction rollback or per-test schema); never rely on a prior
  test having seeded a row.
