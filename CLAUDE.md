# Squire Project

Squire is a tabletop-rules Q&A agent. Phase 1 MVP, solo maintainer.
Stack and layout: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Product spec:
[docs/SPEC.md](docs/SPEC.md). Dev setup: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
Contributor guide: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

This file is a **map**, not a manual. The bulk of project rules live in
focused files under `docs/agent/`. Read the relevant one before doing the
matching kind of work — don't try to keep everything in your head.

## Routing table

Read these on demand:

| When you're about to... | Read |
| --- | --- |
| Start work on a Linear issue | [docs/agent/issue-workflow.md](docs/agent/issue-workflow.md) |
| Write or modify tests | [docs/agent/testing.md](docs/agent/testing.md) |
| Make a non-obvious design choice | [docs/agent/code-quality.md](docs/agent/code-quality.md) |
| Ship a PR (or use `/ship`) | [docs/agent/shipping.md](docs/agent/shipping.md) |
| Run the pre-push review and watch the PR | [docs/agent/review.md](docs/agent/review.md) |
| Write a tech spec or plan-review checkpoint | [docs/agent/planning-artifacts.md](docs/agent/planning-artifacts.md) |

## Always-on rules

These are short on purpose. Anything not on this list lives in one of the files above.

- **Linear is the tracker.** Team key `SQR`. Never open GitHub issues for work — they're for repo-level concerns only (Dependabot, security advisories). Before starting work on an issue, assign it to yourself and move it to "In Progress".
- **Always use PRs.** Never push directly to `main`. Never force-push (`--force`, `--force-with-lease`) — make a new commit that reverts or corrects instead. Keep PRs small and focused.
- **TDD.** Write a failing test first. Don't write implementation before the test.
- **Document *why* in the codebase.** When making a non-obvious design choice, the rationale goes in a code comment or markdown file — not just in PR descriptions or review replies. Future agents and humans won't see PR discussions.
- **Conventional Commits.** `<type>(<scope>): <description>`. Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

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
