# Squire Project

## Frosthaven Rules Assistant (Discord)

When a Discord message asks a Frosthaven rules question, answer using the RAG pipeline:

```bash
node src/query.ts "<question here>"
```

Then reply to Discord with the output. The script loads `ANTHROPIC_API_KEY` from `.env` automatically. Before first use, the docs must be indexed once with `npm run index`.

This behavior applies to **all Discord users** in the channel (not just bcm).

---

## Issue Tracking

Use GitHub Issues for all work tracking. Check open issues with `gh issue list`.
When discovering work that needs to be done later, create an issue with
`gh issue create`.

**Before starting work on an issue**, assign it and set the GitHub Projects
status to "In Progress":

1. `gh issue edit <number> --add-assignee @me`
2. Find which project the issue belongs to (`gh project item-list <N> --owner maz-org --format json`)
3. Use `gh project item-edit` to set the Status field to "In Progress"

To get the IDs needed for `item-edit`, use:

- `gh project list --owner maz-org` — project numbers and IDs
- `gh project field-list <N> --owner maz-org` — field IDs
- `gh api graphql` to query Status field option IDs (Todo/In Progress/Done)
- `gh project item-list <N> --owner maz-org --format json | jq` — item IDs

Set status to "In Progress" at the **start** of work (before creating a branch),
not when opening the PR.

## Development Standards

### Testing Requirements

#### Coverage Tiers

This project uses **tiered coverage requirements** based on module type:

- **Core business logic** (card comparison, filtering, scoring, data transformations): **100% coverage required**
- **Integration layers** (API clients, data extraction, parsers): **80-90% coverage target**
- **LLM wrappers** (prompt construction, response parsing): **Test deterministic parts, mock LLM responses**

#### Test Pyramid Strategy

Follow the test pyramid with this distribution:

- **~70% Unit Tests**: Fast, deterministic, all external services mocked, run on every commit
- **~25% Integration Tests**: External services mocked, test integration logic, run on every commit
- **~5% E2E Tests**: Real third-party API calls, run on **daily schedule in CI** (not on every commit)

#### Test Types

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

#### Mock External Services

- All tests must mock services outside the project boundary to avoid API usage costs
- Exception: E2E tests running on daily CI schedule may use live services
- **Always get explicit approval before implementing tests using live services outside of daily E2E tests**

#### Mocking Strategy for LLM Components

- Mock Claude API responses in unit/integration tests
- Create realistic fixtures for common responses
- Test prompt construction and response parsing separately from LLM behavior
- Real API calls reserved for daily E2E validation

#### Test-Driven Development (TDD)

**Always** follow the red-green-refactor cycle when writing new code:

1. **Red** — Write a failing test first that defines the expected behavior
2. **Green** — Write the minimal code needed to make the test pass
3. **Refactor** — Clean up while keeping tests green

Do not write implementation before tests. Each feature or fix starts with a test.

### Code Quality

1. **Linting and Formatting**
   - Use standard linting and formatting configurations for the programming language
   - All lint errors and warnings must be eliminated before committing
   - Fix all errors/warnings, even if caused by previous work

2. **Document Design Choices**
   - When making a non-obvious design choice, document **why** in a code comment or markdown file — not just in PR descriptions or review replies
   - Future agents and humans reading the code won't see PR discussions; the rationale must live in the codebase
   - Examples: why a field defaults to 0 instead of null, why a particular data source is used, why an approach was chosen over alternatives

3. **Test Integrity**
   - All tests must pass before committing
   - Never delete tests to achieve 100% pass rate
   - Never ignore failing tests, regardless of origin
   - When fixing failing tests, reason about correctness:
     - Is the implementation wrong?
     - Is the test wrong?
   - Never change implementation just to make tests pass without proper analysis

### Code Review with CodeRabbit

This repo uses [CodeRabbit](https://coderabbit.ai) as an automated PR reviewer. CodeRabbit is configured to auto-approve PRs that pass review, which satisfies the branch protection "1 approving review" requirement.

**Before pushing to GitHub**, run the CodeRabbit review locally:

```bash
/coderabbit:review
```

Address all review comments before pushing. This catches issues early and avoids back-and-forth on the PR.

**After pushing**, CodeRabbit will also review the PR on GitHub and leave inline comments. Handle these as follows:

1. **Review all comments** on the PR (`gh api repos/{owner}/{repo}/pulls/{number}/comments`)
2. **Fix legitimate issues** — bugs, type errors, missing validation, security concerns
3. **Use judgment on nitpicks** — you don't need to address every style suggestion or minor nitpick. It's OK to disagree.
4. **Reply to each comment inline** explaining what you decided:
   - If fixed: briefly say what you changed
   - If not fixing: explain why (e.g., "intentional for readability", "out of scope", "disagree — X is preferred here")
5. **Push fixes** as a follow-up commit, then re-check for new comments

CodeRabbit configuration is in `.coderabbit.yaml`. Path-specific review instructions can be added there for modules that need domain-aware review (e.g., Zod schemas matching game data, mock patterns in tests).

### Git Practices

1. **Branch Naming**
   - Always include the GitHub issue number in the branch name
   - Format: `<type>/<issue-number>-<short-description>` (e.g., `refactor/41-extract-search-tools`)

2. **Commit Practices**
   - Commit logical changes together
   - Write meaningful commit messages using Conventional Commits format
   - Commit frequently
   - Always use pull requests — never push directly to main
   - Keep PRs small and focused — one logical change per PR
   - **Never force push** (`--force`, `--force-with-lease`). If a pushed commit needs to be undone, make a new commit that reverts or corrects it.

**Conventional Commits Format:**

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`

Example: `feat(auth): add user login endpoint`
