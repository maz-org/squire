<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Code Review with CodeRabbit

This repo uses [CodeRabbit](https://coderabbit.ai) as an automated PR reviewer. CodeRabbit is configured to auto-approve PRs that pass review, which satisfies the branch protection "1 approving review" requirement.

**Before pushing to GitHub**, run the CodeRabbit review locally:

```bash
/coderabbit:review
```

Address all review comments before pushing. This catches issues early and avoids back-and-forth on the PR.

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
