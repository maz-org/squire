<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Git Practices

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

## Use the `/ship` skill

For the actual ship workflow, invoke the gstack **`/ship`** skill rather than running the steps by hand. `/ship` detects and merges the base branch, runs tests, reviews the diff, bumps `VERSION`, updates `CHANGELOG`, commits, pushes, and opens the PR — wrapping up everything above into one command.

The rules in this file still apply — `/ship` doesn't override them, it executes them:

- Branch must follow the naming convention above (Linear's `gitBranchName` already does).
- Commits must follow Conventional Commits.
- One logical change per PR.
- Never force-push, never push to main directly. `/ship` always goes through a PR.

After `/ship` opens the PR, follow the CodeRabbit polling loop in
[review.md](review.md) until merge. `/land-and-deploy` takes
over from there if you want it to handle the merge + deploy verification.
