# SQR-79 — QA plan for agent parity plan ticket

**Issue:** [SQR-79](https://linear.app/maz-org/issue/SQR-79/docs-codify-claudecodexgstack-agent-parity-plan)
**Artifact under test:** [docs/plans/gstack-codex-sync-plan.md](./gstack-codex-sync-plan.md)
**Goal:** verify that SQR-79's acceptance criteria are actually satisfied before the ticket is marked done.

---

## QA approach

This is a documentation/process ticket, not product QA.

So the right `gstack` mindset here is **report-only verification**, closer to
`/qa-only` than `/qa`:

- verify the issue text
- verify the checked-in plan content
- verify the git branch / commit / push state
- verify that the plan is specific enough to guide the next implementation phase

Do **not** turn this QA pass into a new implementation round unless a failure is
found. If a failure is found, record it clearly and fix it in a follow-up commit
on the same branch.

---

## Acceptance criteria under test

From SQR-79:

1. `docs/plans/gstack-codex-sync-plan.md` exists and explains the Squire-specific architecture for Claude, Codex, and gstack
2. The plan explicitly states that canonical gstack runtime state lives under `~/.gstack/projects/maz-org-squire/`, not repo-local `.gstack/`
3. The plan defines the repo-owned adapter layer at a high level: `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, docs, and helper scripts
4. The plan includes a concrete implementation order for the next phases of work
5. The plan is committed and pushed on the SQR-79 feature branch, without opening a PR

---

## Test matrix

| AC | What to verify | Evidence |
| --- | --- | --- |
| 1 | Plan file exists and is Squire-specific | file contents + references to Squire repo paths |
| 2 | Plan distinguishes `~/.gstack/projects/maz-org-squire/` from repo `.gstack/` | direct text in plan |
| 3 | Plan names the adapter layer components | direct text in plan |
| 4 | Plan includes sequenced next steps | implementation-order section |
| 5 | Branch exists on origin, commit is pushed, no PR opened | git + GitHub evidence |

---

## Test steps

## 1. Verify Linear issue text

Open SQR-79 and confirm:

- the ticket description matches the intended scope
- the AC section exists
- the ACs are high-level and testable

Pass condition:

- all five ACs are present in the issue body

Failure examples:

- no AC section
- ACs mention work that is not in the plan doc
- ACs are too vague to verify

---

## 2. Verify the artifact exists and is on the expected branch

Run:

```bash
git branch --show-current
git status --short --branch
git log --oneline -1
git ls-remote --heads origin bcm/sqr-79-docs-codify-claudecodexgstack-agent-parity-plan
```

Pass condition:

- current branch is `bcm/sqr-79-docs-codify-claudecodexgstack-agent-parity-plan`
- working tree is clean
- latest commit is the SQR-79 plan commit
- the branch exists on `origin`

Failure examples:

- still on `main`
- local commit not pushed
- extra unstaged changes muddy the QA result

---

## 3. Verify plan content against AC 1

Read:

- [docs/plans/gstack-codex-sync-plan.md](./gstack-codex-sync-plan.md)

Check that it is specifically about Squire, not a generic multi-repo writeup.

Look for:

- repo-specific paths
- references to current Squire files like `CLAUDE.md`, `docs/agent/`, `.mcp.json`
- explicit statement that this repo is the scope

Pass condition:

- the plan is obviously Squire-specific from the first screenful and throughout

Failure examples:

- generic advice without repo anchors
- no references to current repo files

---

## 4. Verify plan content against AC 2

Search the plan for:

- `~/.gstack/projects/maz-org-squire/`
- repo-local `.gstack/`

Pass condition:

- the plan explicitly says the canonical gstack runtime state is in
  `~/.gstack/projects/maz-org-squire/`
- the plan explicitly says repo `.gstack/` is artifact output only, not canonical memory

Failure examples:

- ambiguous wording that could still imply repo `.gstack/` is the main state
- only one of the two locations is mentioned

---

## 5. Verify plan content against AC 3

Check that the plan identifies the adapter layer clearly.

Required components:

- `CLAUDE.md`
- `AGENTS.md`
- `.mcp.json`
- docs
- helper scripts

Pass condition:

- all five appear in the plan as part of the checked-in adapter/config layer

Failure examples:

- `AGENTS.md` omitted
- MCP layer omitted
- helper scripts not mentioned

---

## 6. Verify plan content against AC 4

Check for a concrete execution sequence.

Required:

- named phases or sections
- a clear implementation order
- enough detail that the next coding pass can start without re-planning from scratch

Pass condition:

- the plan contains an "Exact implementation order" style section or equivalent

Failure examples:

- only unordered ideas
- no rollout sequence
- dependencies between steps left implicit

---

## 7. Verify AC 5: pushed branch, no PR

Run:

```bash
git ls-remote --heads origin bcm/sqr-79-docs-codify-claudecodexgstack-agent-parity-plan
gh pr list --head bcm/sqr-79-docs-codify-claudecodexgstack-agent-parity-plan --json number,state,title
```

Pass condition:

- remote branch exists
- `gh pr list` returns no open or draft PR for this branch

Failure examples:

- branch only exists locally
- a PR was opened accidentally

---

## 8. Lightweight quality checks

Run:

```bash
npx markdownlint-cli2 docs/plans/gstack-codex-sync-plan.md docs/plans/gstack-codex-sync-qa-plan.md
```

Pass condition:

- both docs pass markdown lint

Optional extra check:

```bash
git diff --stat origin/main...HEAD
```

Use this to confirm the branch only contains the expected SQR-79 documentation work.

---

## Reporting format

Record the QA result as a short checklist in the ticket comment or working notes:

- AC1: pass/fail + one sentence
- AC2: pass/fail + one sentence
- AC3: pass/fail + one sentence
- AC4: pass/fail + one sentence
- AC5: pass/fail + one sentence
- overall verdict: ready / not ready

If there is a failure:

- cite the exact missing or incorrect text
- fix it on the same branch
- re-run only the affected checks plus the lint check

---

## Exit criteria

SQR-79 is QA-complete when:

- all five ACs pass
- both plan docs lint cleanly
- the branch is pushed
- no PR exists yet

At that point, the ticket can either:

- stay `In Progress` while implementation work continues on the same branch, or
- move to `Done` if you want to treat SQR-79 as a pure planning ticket and open a new issue for implementation
