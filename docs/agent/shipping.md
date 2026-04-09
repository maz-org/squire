<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Git Practices

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

## Use the `/ship` skill

For the actual ship workflow, invoke the gstack **`/ship`** skill rather than running the steps by hand. In Squire, interpret `/ship` as: detect and merge the base branch, run tests, review the diff, commit, push, and open the PR. Do **not** bump version numbers or edit `CHANGELOG.md` for ordinary feature-branch PRs unless the user explicitly asks for a release/version cut.

The rules in this file still apply — `/ship` doesn't override them, it executes them:

- Branch must follow the naming convention above (Linear's `gitBranchName` already does).
- Commits must follow Conventional Commits.
- One logical change per PR.
- Never force-push, never push to main directly. `/ship` always goes through a PR.

After `/ship` opens the PR, follow the CodeRabbit polling loop in
[review.md](review.md) until merge. `/land-and-deploy` takes
over from there if you want it to handle the merge + deploy verification.
