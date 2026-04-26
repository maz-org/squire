<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Code Review with CodeRabbit

This repo uses [CodeRabbit](https://coderabbit.ai) as an automated PR reviewer. CodeRabbit is configured to auto-approve PRs that pass review, which satisfies the branch protection "1 approving review" requirement.

**Before pushing to GitHub**, run the gstack `/review` skill:

```bash
/review
```

`/review` performs a structural pre-landing review of the diff against the base branch (SQL safety, LLM trust boundary violations, conditional side effects, and similar issues). Address its findings before pushing. This catches problems early and avoids back-and-forth on the PR.

If the review surfaces a non-obvious design or engineering decision — or if addressing a finding requires choosing between meaningful alternatives — capture it as an ADR before pushing. See [adrs.md](adrs.md) for the workflow.

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
   - Some CodeRabbit outside-diff findings only appear in the review body, not
     as replyable inline threads. When that happens, keep replying inline on
     real thread comments, and add a top-level PR comment for the review-body
     note instead of pretending there is a thread to resolve.
5. **Push fixes** as a follow-up commit
6. **Repeat** — keep polling until all of the following are true:
   - No unaddressed review comments remain
   - All PR checks have passed
   - CodeRabbit has approved the PR
   - The PR has been auto-merged and closed
7. **Clean up** — after merge, close the issue if GitHub didn't auto-close it,
   switch to main, pull, prune remote refs, check `git diff main..branch` (or
   equivalent) for any local-only follow-up commits, then delete the local
   feature branch

Use `/loop` to watch for new comments and check status. Do not stop watching early.

**Polling cadence** — when actively waiting on CodeRabbit re-review or CI on
this repo, schedule the next check at **~240s** (CR auto-reviews fire within
~5 min of a push; CI runs are typically 2-3 min). Do not stretch toward
1200s+ "to amortize prompt-cache cost" while a fast signal is expected — the
cache window is a secondary concern; the primary signal is "when will the
thing I'm waiting for actually arrive." Stretch the interval only after 2-3
polls with no signal.

CodeRabbit configuration is in `.coderabbit.yaml`. Path-specific review
instructions can be added there for modules that need domain-aware review
(e.g., Zod schemas matching game data, mock patterns in tests).
