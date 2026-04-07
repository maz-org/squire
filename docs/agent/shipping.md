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
