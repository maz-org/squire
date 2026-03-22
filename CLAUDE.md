# Squire Project

## Frosthaven Rules Assistant (Discord)

When a Discord message asks a Frosthaven rules question, answer using the RAG pipeline:

```bash
node src/query.ts "<question here>"
```

Then reply to Discord with the output. The script loads `ANTHROPIC_API_KEY` from `.env` automatically. Before first use, the docs must be indexed once with `npm run index`.

This behavior applies to **all Discord users** in the channel (not just bcm).

---

This project uses **beads (bd)** for persistent issue tracking across sessions.

## Issue Tracking with Beads

Track ALL work in bd - never use markdown TODOs or comment-based task lists.

**Quick Reference:**

```bash
bd prime                              # Load complete workflow context
bd ready                              # Show issues ready to work (no blockers)
bd list --status=open                 # List all open issues
bd show <id>                          # View issue details with dependencies
bd create --title="..." --type=task --priority=2  # Create new issue
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Mark complete
bd close <id1> <id2> ...              # Close multiple (more efficient)
bd dep add <issue> <depends-on>       # Add dependency
bd sync --from-main                   # Sync beads from main (ephemeral branches)
```

**Issue Types:** `bug`, `feature`, `task`, `epic`, `chore`

**Priorities:** `0` (critical) to `4` (backlog) - use numbers, NOT "high"/"medium"/"low"

## Session Completion Protocol

**MANDATORY steps before ending session:**

1. **Check what changed**

   ```bash
   git status
   ```

2. **Stage code changes**

   ```bash
   git add <files>
   ```

3. **Sync beads from main** (for ephemeral branches)

   ```bash
   bd sync --from-main
   ```

4. **Commit code changes**

   ```bash
   git commit -m "..."
   ```

**Note:** This is an ephemeral branch workflow. Code changes are merged to main locally, not pushed to remote.

## Workflow

1. Find work: `bd ready` or `bd list --status=open`
2. Review details: `bd show <id>` (shows dependencies)
3. Claim work: `bd update <id> --status=in_progress`
4. Do the work
5. Complete: `bd close <id>`
6. Sync at session end: `bd sync --from-main`

## Creating Issues

- Use `bd create` for multi-session work, dependencies, or discovered tasks
- Use TodoWrite for simple single-session execution tracking
- When in doubt, prefer bd - persistence you don't need beats lost context
- For bulk creation, use parallel subagents for efficiency

## Dependencies

```bash
bd dep add <issue> <depends-on>   # Issue depends on depends-on (depends-on blocks issue)
bd blocked                         # Show all blocked issues
```

## Context Loading

Run `bd prime` for complete AI-optimized workflow documentation. Git hooks auto-inject this context at session start and before compaction.

For more details: `bd --help` or `bd workflow`

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

Follow red-green-refactor cycle:

1. Write failing test (red)
2. Write minimal code to pass (green)
3. Refactor while keeping tests green

### Code Quality

1. **Linting and Formatting**
   - Use standard linting and formatting configurations for the programming language
   - All lint errors and warnings must be eliminated before committing
   - Fix all errors/warnings, even if caused by previous work

2. **Test Integrity**
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

1. **Commit Practices**
   - Commit logical changes together
   - Write meaningful commit messages using Conventional Commits format
   - Commit frequently
   - Once origin repo is set up: push every commit to main (unless instructed otherwise)

**Conventional Commits Format:**

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`

Example: `feat(auth): add user login endpoint`
