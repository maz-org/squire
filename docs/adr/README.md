# Architecture Decision Records

This directory holds ADRs — short, dated records of decisions that shape the
codebase. They exist so future agents and humans can see *why* we built things
the way we did, not just *what* exists today.

ADRs are the primary intermediate artifact for reviewing design and engineering
decisions. They're easier to review than a diff of individual lines, and they
compound over time into a history the project can reason about.

## When to write one

Write an ADR when any of these are true:

- A `/plan-eng-review` or `/plan-design-review` produces a non-obvious choice.
- You pick an approach after weighing alternatives and want the trade-off captured.
- You're about to do something that contradicts, narrows, or extends an earlier ADR.
- A human reviewer would benefit from seeing the reasoning before approving the code.

Not every commit needs an ADR. Bug fixes, refactors, and obvious changes don't.
If you'd have to invent a "Context" section, you don't need an ADR.

## Rules

1. **One decision per file.**
2. **Filename:** `NNNN-short-title.md`, monotonic numbering. Next ID is
   `max(existing) + 1`, zero-padded to 4 digits.
3. **Once `status: active`, never edit the body.** If the decision changes,
   write a *new* ADR that supersedes the old one.
4. **Superseding:** set the old ADR's `status: superseded` and add
   `superseded_by: "NNNN"` in its frontmatter. That's the only permitted edit
   to an active ADR.
5. **`docs/ARCHITECTURE.md` reflects the current state** — active decisions
   only. Superseded ADRs stay in this directory as historical record but should
   not be referenced from ARCHITECTURE.md.
6. **Statuses:** `proposed` (under discussion) → `active` (in force) →
   `superseded` (replaced) or `retired` (no longer relevant, not replaced).

## Workflow for agents

Before implementing a feature, read the workflow in
[docs/agent/adrs.md](../agent/adrs.md). The short version: check existing ADRs
first, take inspiration from past decisions, write a new ADR when the work
introduces something novel, mark old ADRs superseded when a new decision makes
them so.

## Template

See [`0000-template.md`](0000-template.md). Copy it, don't edit it.
