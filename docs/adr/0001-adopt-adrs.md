---
type: ADR
id: "0001"
title: "Adopt Architecture Decision Records"
status: active
date: 2026-04-08
---

## Context

Squire's design and engineering decisions were scattered across Linear
comments, PR descriptions, `docs/plans/` artifacts, and CLAUDE-assisted
review sessions. None of these survive well:

- PR discussions disappear from an agent's view after merge.
- `docs/plans/` files are staging and get deleted post-merge (see
  [planning-artifacts.md](../agent/planning-artifacts.md)).
- Linear is the tracker, not a design archive.
- `docs/ARCHITECTURE.md` describes the *current* state but not *why* we got there.

When Claude implements a new feature, there's no durable record of prior
decisions to build on, contradict, or supersede. Each session re-derives
reasoning the project has already done.

The author has been trialing ADRs on another project for two weeks and is
happy with the workflow: ADRs work as an intermediate artifact that's easier
to review than line-level diffs, and they compound into useful context for
future agent sessions.

## Decision

**Adopt lightweight ADRs stored in `docs/adr/`.** One decision per file,
numbered monotonically, immutable once active, superseded rather than edited.
Agents read existing ADRs before implementing new features and write new ones
when the work introduces a non-obvious choice.

## Options considered

- **Option A** (chosen): ADRs in `docs/adr/` with the rules in
  [`docs/adr/README.md`](README.md) and the agent workflow in
  [`docs/agent/adrs.md`](../agent/adrs.md). Trialed successfully on another
  project. Cheap to adopt; compounds over time. Small risk of ADR sprawl if
  written too eagerly — mitigated by the "don't write one unless the Context
  section is real" rule.
- **Option B**: Keep putting rationale in `docs/ARCHITECTURE.md` sections.
  Already the post-merge destination for load-bearing content, but it
  describes *current* state, not the decision trail. Loses the history of
  superseded choices.
- **Option C**: Linear project documents. Auto-archive with projects, but
  not visible to agents during implementation and not in the repo for
  reviewers to see alongside the diff.

## Consequences

- **Easier:** reviewing design decisions without reading the full diff;
  onboarding future agent sessions to prior reasoning; detecting when new
  work contradicts an old decision.
- **Harder:** discipline is required to write ADRs during reviews rather
  than after the fact. Retired/superseded ADRs accumulate — acceptable
  because git-visible history is the whole point.
- **Re-evaluate if:** ADRs become a ritual nobody reads, or if the count
  grows faster than decisions are actually being made (a sign we're writing
  them for trivial changes).

## Advice

*Decision made unilaterally by the maintainer after trialing the pattern on
another project.*
