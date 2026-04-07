# Squire Project

## Issue Tracking

This project moved off GitHub Issues to **Linear** in early Phase 1. Linear gives
us first-class projects and initiatives (so the Phase 1 MVP work can be sliced
across Storage / Web UI / User Accounts / Deployment / Production Readiness with
visible dependencies), an MCP integration that lets agents read and edit issues
without shelling out, and pre-computed git branch names per issue. The trade-off
is that issue tracking now lives in a SaaS tool rather than next to the code in
GitHub — acceptable for a single-maintainer project with tight Linear integration
in the agent loop. GitHub Issues is still used for repo-level concerns
(Dependabot, security advisories) but **not** for work tracking. Per the
"Document Design Choices" rule below, this rationale lives here so future agents
and contributors don't re-litigate the choice.

Use **Linear** for all work tracking. The Squire team key is `SQR`. Issues are
organized into projects (Storage & Data Migration, Web UI, User Accounts,
Deployment, Production Readiness) under the
**Squire · Phase 1: MVP Rules Q&A at the Table** initiative.

Use the Linear MCP tools to interact with issues and projects:

- `mcp__claude_ai_Linear__list_issues` — filter by `project`, `assignee`, `state`, etc.
- `mcp__claude_ai_Linear__get_issue` — full description by ID (e.g., `SQR-31`)
- `mcp__claude_ai_Linear__save_issue` — create or update an issue
- `mcp__claude_ai_Linear__list_projects` — filter by `initiative`
- `mcp__claude_ai_Linear__get_project` — full description, optionally with milestones / members / resources

When discovering work that needs to be done later, create a Linear issue in the
appropriate project (don't open a GitHub issue — they're not used for tracking
any more).

**Before starting work on an issue**, assign it to yourself and move it to
"In Progress" via `save_issue`:

1. `save_issue({ id: "SQR-XX", assignee: "me", state: "In Progress" })`
2. Use the issue's `gitBranchName` field as the branch name (Linear pre-computes
   one in the format `bcm/sqr-XX-<short-description>`).

Move the issue to "In Progress" at the **start** of work (before creating a
branch), not when opening the PR.

GitHub Issues is only used for repo-level concerns (Dependabot, security
advisories) — not for work tracking.

## Planning artifacts

Plan reviews and tech specs follow a hybrid lifecycle:

1. **During implementation** — tech specs and decision checkpoints live in
   `docs/plans/<project-slug>-tech-spec.md` and
   `docs/plans/<project-slug>-review-checkpoint.md`. Implementing agents read
   them directly from the repo. Linear issues link to them.
2. **Post-merge** — promote load-bearing content (architectural decisions, data
   lifecycle, patterns) into `docs/ARCHITECTURE.md` (or `SECURITY.md` /
   `SPEC.md` as appropriate) as permanent sections, then **delete** the
   `docs/plans/` files. Git history preserves them. `docs/plans/` is a
   staging area, not a graveyard.
3. **For interactive decision logs only (no implementer-facing content)** —
   prefer Linear project documents. They auto-archive when the project closes.

Plan-eng-review and similar review skills should write to `docs/plans/` by
default, and surface this lifecycle to the user in the final summary so the
post-merge cleanup doesn't get forgotten.

## Development

For server setup, API endpoints, MCP client configuration, and project
structure, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

For the product spec, see [docs/SPEC.md](docs/SPEC.md). For architecture
context and design rationale, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

**Before pushing to GitHub**, run the gstack `/review` skill:

```bash
/review
```

`/review` performs a structural pre-landing review of the diff against the base branch (SQL safety, LLM trust boundary violations, conditional side effects, and similar issues). Address its findings before pushing. This catches problems early and avoids back-and-forth on the PR.

**After creating the PR**, monitor it in a loop until it is merged. Do **not**
push any additional commits to the branch after the PR is merged — if you
have unrelated changes (e.g., CLAUDE.md updates), put them on a separate
branch/PR.

1. **Poll for review comments** (`gh api repos/{owner}/{repo}/pulls/{number}/comments`)
   and PR status (`gh pr view <number> --json state,reviewDecision,reviews,statusCheckRollup`)
2. **Fix legitimate issues** — bugs, type errors, missing validation, security concerns
3. **Use judgment on nitpicks** — you don't need to address every style suggestion
   or minor nitpick. It's OK to disagree.
4. **Reply to each comment inline** explaining what you decided:
   - If fixed: briefly say what you changed
   - If not fixing: explain why (e.g., "intentional for readability", "out of
     scope", "disagree — X is preferred here")
5. **Push fixes** as a follow-up commit
6. **Repeat** — keep polling until all of the following are true:
   - No unaddressed review comments remain
   - All PR checks have passed
   - CodeRabbit has approved the PR
   - The PR has been auto-merged and closed
7. **Clean up** — after merge, close the issue if GitHub didn't auto-close it,
   switch to main, pull, prune remote refs, and delete the local feature branch

Use `/loop` or a polling interval (e.g., check every 30–60 seconds) to watch
for new comments and check status. Do not stop watching early.

CodeRabbit configuration is in `.coderabbit.yaml`. Path-specific review
instructions can be added there for modules that need domain-aware review
(e.g., Zod schemas matching game data, mock patterns in tests).

### Git Practices

1. **Branch Naming**
   - Always include the Linear issue key in the branch name
   - Use the `gitBranchName` field Linear pre-computes for each issue (format: `bcm/sqr-XX-<short-description>`)

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

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
