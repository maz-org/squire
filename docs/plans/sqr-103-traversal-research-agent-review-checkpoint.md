# SQR-103 Traversal-First Research Agent — Eng Review Checkpoint

**Session:** `plan-eng-review` preparation for Linear issue `SQR-103`
**Started:** 2026-04-18
**Branch:** `bcm/sqr-103-make-scenario-section-books-first-class-in-retrieval`
**Reviewer:** Codex using the gstack `plan-eng-review` workflow
**Status:** Design approved, eng review not yet resumed

This file is the durable review record for SQR-103.

If a later session picks this up, read:

- `docs/agent/planning-artifacts.md`
- `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
- this file

Then continue from **Next checkpoint** below.

---

## Durability protocol

This review is being hardened against context compaction on purpose.

From this point on, after **every eng-review answer**, update this file with:

1. the question/decision just resolved
2. the chosen direction
3. any new risks or open questions
4. the next checkpoint the following session should resume from

Do not rely on chat history alone.

---

## Approved design summary

The approved design direction is:

- traversal-first research agent
- sparse explicit reference artifact, not a full graph platform
- deterministic traversal tools for scenarios and sections
- semantic search as fallback, not primary planner
- game-scoped shape so Gloomhaven 2.0 can be added later

The motivating failure is the scenario 61 conclusion question, which currently
times out and forces manual PDF chain-following.

---

## Facts already established

### 1. Existing exact lookup primitives already exist

The repo already has:

- DB-backed extracted loading in `src/extracted-data.ts`
- exact scenario/card lookup via `listCards()` and `getCard()` in `src/tools.ts`
- canonical scenario IDs such as `gloomhavensecretariat:scenario/061`

### 2. The current gap is structured traversal

`src/import-scenarios.ts` imports useful scenario metadata but does not expose
section-link chains. There is no deterministic way today to go from:

- scenario -> conclusion section
- section -> next section

### 3. Current agent behavior is too fuzzy

`src/agent.ts` has a good tool loop but currently relies too heavily on freeform
search and model inference for multi-hop traversal.

### 4. Scope should stay boring

The design should not become a general GraphRAG system. The right-sized version
is a sidecar reference artifact plus traversal tools.

---

## Pre-review concerns

These are the main risks to challenge during eng review:

1. Overbuilding a new storage/model layer when a generated artifact is enough
2. Underbuilding by leaving too much chain-following inside the model
3. Failing to define clean test coverage for chained traversal
4. Forgetting the Gloomhaven 2.0 extension seam while optimizing for Frosthaven

---

## Answer log

### 2026-04-18 12:00 ET — Setup checkpoint

- Approved repo-side source of truth:
  - tech spec in `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
  - this review checkpoint file
- Decision:
  commit the approved design into the repo before resuming eng review
- Known unrelated worktree changes left unstaged:
  - `src/agent.ts`
  - `test/agent.test.ts`
    These were not included in the docs commit.

---

## Next checkpoint

Resume at **Step 0: Scope Challenge** of `/plan-eng-review`.

The first live decision to revisit is:

- whether the approved design should be reduced further to a generated
  sidecar artifact plus deterministic tools, or whether any broader graph-like
  modeling is still justified
