# Squire agent parity plan — Claude, Codex, and gstack

**Date:** 2026-04-09
**Scope:** This repo only. Optimize for Squire's current setup, not a reusable framework.
**Primary goal:** make Claude and Codex start from the same project instructions, use the same MCP wiring where possible, and benefit from the same `gstack` learnings/state.

---

## Executive summary

The important correction is this: for `gstack`, the canonical runtime state is **not**
the repo-local `.gstack/` directory. On this machine, `gstack` stores per-project
state under:

- `~/.gstack/projects/maz-org-squire/learnings.jsonl`
- `~/.gstack/projects/maz-org-squire/timeline.jsonl`
- `~/.gstack/projects/maz-org-squire/repo-mode.json`

The repo-local `.gstack/` directory in Squire currently holds local artifacts
(`qa-reports`, `browse-network.log`), not canonical `gstack` project state.

So the right architecture for Squire is:

1. `gstack` runtime state stays in `~/.gstack/projects/maz-org-squire/`
2. This repo owns the checked-in adapter/config layer:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `.mcp.json`
   - `.claude/settings.json`
   - small helper scripts/docs
3. Any durable learnings we want visible in git should be **exported from**
   `~/.gstack/projects/maz-org-squire/learnings.jsonl`, not invented as a parallel
   repo-local memory system

That is the whole game.

---

## Current state

### What already exists

- [`CLAUDE.md`](../../CLAUDE.md) is strong. It already acts as a routing map into:
  - [`docs/agent/`](../agent)
  - [`DESIGN.md`](../../DESIGN.md)
  - `gstack` skills
- [`.claude/settings.json`](../../.claude/settings.json) already enforces a
  `gstack` install check before skill use.
- [`.mcp.json`](../../.mcp.json) already declares the local Squire MCP server:
  `http://localhost:3000/mcp`
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md) already explains how Claude tools
  connect to the local MCP endpoint.
- Repo-local [`.gstack/`](../../.gstack) exists, but it is just an artifact folder.

### What is missing

- No [`AGENTS.md`](../../AGENTS.md) for Codex
- No repo-owned doc that explains the relation between:
  - repo config
  - `gstack` runtime state in `~/.gstack`
  - local artifact output in repo `.gstack/`
- No Codex-facing equivalent of the current Claude routing guidance
- No explicit bridge for exporting important `gstack` learnings into checked-in docs
- No single script/check that verifies the repo's agent config stays aligned

---

## Design principles

### 1. Do not fight `gstack`

`gstack` already has a state model. Squire should align with it, not invent a
competing repo-local fake-`gstack` layout.

### 2. Keep runtime state and checked-in config separate

- Runtime state: `~/.gstack/projects/maz-org-squire/*`
- Checked-in project instructions: repo files

That split is good. Runtime state is mutable and personal-machine-local.
Project instructions are reviewable and versioned.

### 3. Claude and Codex should converge through the repo adapter layer

The repo should tell both tools:

- where the project rules live
- where `gstack` runtime state lives
- how to use the Squire MCP server
- how to write back durable learnings

### 4. Avoid duplication

Do not maintain two independent manuals. `CLAUDE.md` and `AGENTS.md` should be
parallel entrypoints into the same underlying docs.

### 5. Plans are staging, ADRs are decision memory

This repo treats `docs/plans/` as implementer-facing staging, not as permanent
architecture memory. If the implementation settles a non-obvious boundary
between `gstack` runtime state, repo adapters, and long-term project memory,
that decision should graduate into an ADR and the active-state docs should be
updated accordingly.

---

## Target architecture

### A. Canonical runtime state

Keep using:

- `~/.gstack/projects/maz-org-squire/learnings.jsonl`
- `~/.gstack/projects/maz-org-squire/timeline.jsonl`
- `~/.gstack/projects/maz-org-squire/repo-mode.json`

This is the shared machine-local state that compounds over time.

### B. Canonical checked-in project guidance

Use these as the durable project-owned sources:

- [`CLAUDE.md`](../../CLAUDE.md): Claude entrypoint
- [`AGENTS.md`](../../AGENTS.md): Codex entrypoint
- [`docs/agent/`](../agent): task-specific policy/manual layer
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md): architecture truth
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md): local setup + MCP/dev instructions
- [`DESIGN.md`](../../DESIGN.md): visual system

### C. Repo-local artifact directory

Keep [`.gstack/`](../../.gstack) in repo, but define it explicitly as:

- QA output
- browser output
- temporary project-local artifacts that are useful to inspect in git status or attach to PRs

Not `gstack` canonical memory.

### D. MCP parity layer

For this repo, `.mcp.json` should remain the checked-in canonical MCP adapter.
Both Claude and Codex should use the same underlying Squire endpoint:

- `http://localhost:3000/mcp`

If host-specific config is needed later, generate it from the same repo-owned
source, but do not overbuild that now.

---

## Build plan

## Phase 1 — Add a Codex adapter

### Phase 1 goal

Give Codex a first-class repo entrypoint that is structurally equivalent to
`CLAUDE.md`.

### Phase 1 changes

1. Add [`AGENTS.md`](../../AGENTS.md)
2. Mirror the routing model from [`CLAUDE.md`](../../CLAUDE.md):
   - short project summary
   - routing table into `docs/agent/*`
   - always-on rules
   - explicit note that `gstack` runtime state lives in `~/.gstack/projects/maz-org-squire/`
   - explicit note that repo `.gstack/` is for artifacts only
3. Include Codex-specific wording for:
   - reading `docs/agent/*` on demand
   - using `.mcp.json`
   - preserving writeback into code/docs, not just chat history

### Phase 1 success criteria

- A Codex session started in this repo has a clear, repo-native operating manual
- The manual points at the same project rules Claude uses

---

## Phase 2 — Clarify the `gstack` contract in repo docs

### Phase 2 goal

Remove ambiguity about what lives where.

### Phase 2 changes

1. Update [`CLAUDE.md`](../../CLAUDE.md) `gstack` section to say:
   - `gstack` runtime state is machine-local in `~/.gstack/projects/maz-org-squire/`
   - repo `.gstack/` is local artifact output only
   - important learnings must be written back into the codebase or exported docs when durable
2. Add a short section to [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md):
   - "Agent tooling state model"
   - explain Claude/Codex entrypoints vs `gstack` runtime state vs repo artifact dir
3. Optionally add a tiny repo doc, for example:
   - [`docs/agent/gstack-state.md`](../agent/gstack-state.md)
   - only if `CLAUDE.md` + `AGENTS.md` start getting too dense

### Phase 2 success criteria

- Future agents do not mistake repo `.gstack/` for the canonical `gstack` memory store
- The repo docs match how `gstack` actually works today

---

## Phase 3 — Export the useful part of `gstack` learnings into git

### Phase 3 goal

Preserve the best compound-engineering learnings in the repo without trying to
check in the raw `~/.gstack` state.

### Phase 3 changes

1. Add a checked-in synthesis doc, likely:
   - [`docs/agent/learnings.md`](../agent/learnings.md)
2. Add a small export script, for example:
   - `scripts/export-gstack-learnings.ts`
3. First version of the exporter should be simple:
   - read `~/.gstack/projects/maz-org-squire/learnings.jsonl`
   - select only high-signal entries
   - group by topic
   - emit a human-curated markdown summary into `docs/agent/learnings.md`
4. Do **not** check in raw JSONL dumps from `~/.gstack`

### What belongs in the export

- recurring debugging traps
- environment gotchas
- testing patterns that prevented regressions
- repeated workflow lessons
- decision summaries that are too small for a full ADR

### What does not belong

- low-signal telemetry
- chatty timeline events
- transient branch/session noise

### Phase 3 success criteria

- Claude and Codex both benefit from `gstack` learnings through checked-in docs
- The repo gains durable memory without coupling itself to `gstack`'s internal file format

---

## Phase 4 — Add a lightweight config sync/check command

### Goal

Prevent the adapter layer from drifting.

### Changes

1. Add a script such as `scripts/check-agent-parity.ts`
2. Verify:
   - `CLAUDE.md` and `AGENTS.md` point at the same core docs
   - `.mcp.json` includes the expected Squire MCP endpoint
   - `docs/DEVELOPMENT.md` references the same MCP setup
   - any gstack-state guidance is consistent across files
3. Add `package.json` scripts:
   - `"agent:check": "node scripts/check-agent-parity.ts"`
   - optionally `"agent:export-learnings": "node scripts/export-gstack-learnings.ts"`

### Success criteria

- Drift is caught locally and in CI
- Updating one tool's adapter without the other becomes hard to do accidentally

---

## ADR trigger and architecture promotion

This work should not assume that a `docs/plans/` artifact is the final resting
place for the decision. During implementation:

- scan `docs/adr/` first for any existing decisions this work might extend or contradict
- if the implementation settles a non-obvious, durable architecture choice,
  write a new ADR instead of burying the reasoning in a plan doc
- if an ADR changes the active architecture description, update
  `docs/ARCHITECTURE.md` to reflect the new active state

Likely ADR trigger points:

- the canonical boundary between `~/.gstack/projects/maz-org-squire/` and
  checked-in repo memory
- the role of `docs/agent/learnings.md` relative to ADRs and
  `docs/ARCHITECTURE.md`
- the long-term division of responsibility among `CLAUDE.md`, `AGENTS.md`,
  `.mcp.json`, and helper scripts

If none of those choices turn out to be non-obvious in implementation, do not
force an ADR just to satisfy process.

---

## Concrete file plan

### New files

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/plans/gstack-codex-sync-plan.md`](./gstack-codex-sync-plan.md)
- likely [`docs/agent/learnings.md`](../agent/learnings.md)
- likely `scripts/export-gstack-learnings.ts`
- likely `scripts/check-agent-parity.ts`

### Updated files

- [`CLAUDE.md`](../../CLAUDE.md)
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md)
- [`package.json`](../../package.json)

### Files that should stay conceptually narrow

- [`.mcp.json`](../../.mcp.json): checked-in adapter for the local Squire MCP endpoint
- [`.gstack/`](../../.gstack): repo artifact output only

---

## Exact implementation order

1. Add `AGENTS.md`
2. Update `CLAUDE.md` to document the real `gstack` state boundary
3. Update `docs/DEVELOPMENT.md` with the agent-state model
4. Add `docs/agent/learnings.md`
5. Add `scripts/export-gstack-learnings.ts`
6. Add `scripts/check-agent-parity.ts`
7. Add `package.json` commands
8. Run the exporter once and commit the initial `docs/agent/learnings.md`

---

## Non-goals

- Do not try to reimplement `gstack` inside the repo
- Do not move `gstack` runtime state from `~/.gstack` into the repo
- Do not build a generalized multi-repo framework now
- Do not overdesign per-host MCP generation unless a real host mismatch appears

---

## Recommendation

For Squire, the right move is:

- **Use `gstack` as-is for runtime state**
- **Use this repo for the adapter/manual layer**
- **Add `AGENTS.md` for Codex**
- **Export only the durable subset of `gstack` learnings into checked-in docs**

That gives Claude and Codex practical parity without pretending their native
config systems are identical and without fighting `gstack`'s real model.

---

## Post-merge cleanup

This plan file should not become a permanent dumping ground. After the
implementation lands:

1. Promote durable operating guidance into `CLAUDE.md`, `AGENTS.md`, and
   `docs/DEVELOPMENT.md`
2. Promote any active architecture change into `docs/ARCHITECTURE.md`
3. Capture non-obvious architectural reasoning in an ADR when warranted
4. Delete the staging plan files in `docs/plans/` once their load-bearing
   content has been promoted
