# Squire Project

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

1. **100% Test Coverage Required**
   - All code must have complete test coverage
   - No exceptions unless explicitly approved

2. **Mock External Services**
   - All tests must mock services outside the project boundary to avoid API usage costs
   - Exception: Post-deploy smoke tests or scenarios requiring live third-party integrations
   - **Always get explicit approval before implementing tests using live services**

3. **Test-Driven Development (TDD)**
   - Follow red-green-refactor cycle:
     1. Write failing test (red)
     2. Write minimal code to pass (green)
     3. Refactor while keeping tests green

### Code Quality

4. **Linting and Formatting**
   - Use standard linting and formatting configurations for the programming language
   - All lint errors and warnings must be eliminated before committing
   - Fix all errors/warnings, even if caused by previous work

5. **Test Integrity**
   - All tests must pass before committing
   - Never delete tests to achieve 100% pass rate
   - Never ignore failing tests, regardless of origin
   - When fixing failing tests, reason about correctness:
     - Is the implementation wrong?
     - Is the test wrong?
   - Never change implementation just to make tests pass without proper analysis

### Git Practices

6. **Commit Practices**
   - Commit logical changes together
   - Write meaningful commit messages using Conventional Commits format
   - Commit frequently
   - Once origin repo is set up: push every commit to main (unless instructed otherwise)

**Conventional Commits Format:**
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`

Example: `feat(auth): add user login endpoint`
