<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Architecture Decision Records (agent workflow)

ADRs live in [`docs/adr/`](../adr/). Read
[`docs/adr/README.md`](../adr/README.md) for the rules (one decision per file,
immutable once active, supersede-don't-edit, naming). This file is the
*workflow* you follow when doing work that touches decisions.

## Before implementing a feature

1. **Scan `docs/adr/`** for ADRs relevant to the area you're about to touch.
   Read the ones that look related. They are the project's design memory.
2. **Take inspiration from active decisions.** If a prior ADR already decided
   how something works, match that approach unless you have a reason not to.
3. **Notice contradictions.** If the work you're about to do contradicts,
   narrows, or invalidates an active ADR, that's a signal you need a new ADR
   to supersede it — not a signal to quietly diverge.

## During `/plan-eng-review` and `/plan-design-review`

These review skills are the primary source of new ADRs. When a review
produces a non-obvious choice — an approach selected over alternatives, a
trade-off weighed deliberately, a pattern that future work should copy —
write an ADR capturing it.

- Start from [`docs/adr/0000-template.md`](../adr/0000-template.md).
- Pick the next monotonic ID: `max(existing NNNN) + 1`, zero-padded.
- Fill in Context, Decision, Options considered, Consequences. Include
  Advice if the decision was influenced by outside review (codex review,
  plan-ceo-review, etc.).
- Set `status: active` when the decision is made, not `proposed` — in a
  solo-maintainer project there's no separate approval step.

## When a new decision supersedes an old one

1. Write the new ADR as normal (`status: active`).
2. Edit *only the frontmatter* of the superseded ADR:
   - `status: superseded`
   - `superseded_by: "NNNN"` (the new ADR's ID)
3. Do not touch the body of the superseded ADR. Its whole point is to
   preserve the reasoning that was valid at the time.
4. If `docs/ARCHITECTURE.md` referenced the old decision, update it to
   reflect the new one. ARCHITECTURE.md tracks active state only.

## When NOT to write an ADR

- Bug fixes that restore intended behavior.
- Refactors with no behavioral change.
- Obvious choices where you'd have to invent a Context section.
- Anything where the "Options considered" list would be fake.

If in doubt, don't. A too-eager ADR culture is worse than a sparse one —
ADRs should be load-bearing, not decorative.

## Relationship to other artifacts

- **Linear issues** track *what* is being worked on. ADRs track *why* a
  decision was made. Link from the Linear issue to the ADR when relevant.
- **`docs/plans/`** is staging for tech specs and review checkpoints; it
  gets deleted post-merge (see
  [planning-artifacts.md](planning-artifacts.md)). ADRs are the permanent
  home for the *decisions* that came out of those plans.
- **`docs/ARCHITECTURE.md`** describes the current system. ADRs describe
  how we got there. ARCHITECTURE.md should cite active ADRs when a section
  has a non-obvious rationale.
- **PR descriptions** are ephemeral from an agent's perspective. If a PR
  discussion produces a decision worth remembering, promote it into an ADR
  before merge.
