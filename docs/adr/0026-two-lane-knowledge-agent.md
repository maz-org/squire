---
type: ADR
id: '0026'
title: 'Two-lane knowledge agent: fast pipeline lane + deep reasoning lane'
status: active
date: 2026-07-06
---

## Context

The epoch-2 baseline (SQR-395) measured the production LangGraph loop at
~10s first-token / 14–17s complete P50 for rules-synthesis questions and up
to 32s P95 for multi-hop — against project targets of ≤2.5s first-token P50
and ≤10s complete P95. The structural causes are the loop shape itself:
every answer pays at least one planner model call before retrieval starts,
a deterministic verify gate that only accepts "opened" evidence, and a
separate final-answer model call after the loop ends.

The epoch-1 mitigation (SQR-384/658) was a deterministic template fast path
inside `final_answer` — string-formatted answers keyed off question regexes.
It hit latency budgets on its target rows but omitted asked-for content
(the "missing monsters" failures in Brian's calibration labels), broke on
unanticipated phrasings, and moved judgment out of the model — the pattern
the Table Turnaround II project explicitly retires.

Most table questions are single-fact lookups or single-passage rules
definitions that need exactly one retrieval and one grounded synthesis.
The dataset now tags these classes (`questionClass`, SQR-393), and the
matrix measures them separately.

## Decision

**Split the knowledge agent into two lanes behind the same `ask()` boundary:
a fast lane — deterministic classification, speculative retrieval fired
immediately, and a single fast-model (Haiku-class) synthesis call that
writes prose from the retrieved bundle — for single-fact lookups and simple
rules definitions; and the existing LangGraph deep lane, unchanged, for
everything else (multi-hop, traversal, comparisons, campaign reads, all
writes). The template fast path (`directAnswerDraft*`) is deleted once the
fast lane matches or beats it on the eval rows it was built for.**

Non-negotiable invariants, both lanes:

- The SSE contract holds: answer prose originates from a single sanctioned
  emission point per turn; retrieval work appears as work-log/tool events.
- Trajectory capture (tool calls, model calls, token usage, first-token
  timestamps) and groundedness/consulted-sources provenance are recorded
  identically, so evals, comparisons, and the web footer keep working.
- The fast lane answers from retrieved evidence only; when retrieval comes
  back empty or the classifier abstains, the question falls through to the
  deep lane rather than guessing (escalation is the correctness backstop —
  those turns pay deep-lane latency by design).
- Campaign context or any write intent forces the deep lane. The fast lane
  never sees write tools.

## Options considered

- **Two lanes with deterministic classification (chosen):** heuristic
  routing (exact-reference and definition patterns; no campaign context; no
  write verbs) keeps the fast lane's latency floor at retrieval + one
  synthesis call, with a small-model classifier as a later upgrade if
  heuristic precision proves insufficient. Pros: no added model call on the
  hot path, honest fallback, model writes every answer. Cons: heuristic
  recall bounds how much traffic gets the fast path.
- **Keep one loop, tune it (rejected):** epoch-1 spent five slices here;
  the loop shape itself pays 3-4 model calls for simple questions. The
  remaining tuning space is per-case special-casing — the failure mode this
  project exists to end.
- **Extend the template fast path (rejected):** fastest possible responses,
  but regex-parsed questions and string-formatted answers systematically
  omit asked-for content and cannot generalize; judged unacceptable by the
  human-labeled calibration.
- **Small-model classifier from day one (rejected for now):** adds a model
  round-trip (or a parallel call) before routing on every question; the
  heuristic covers the measured question classes, and the eval harness will
  show if its precision is the binding constraint.

## Consequences

- Rules-synthesis and exact-lookup first-token latency is bounded by one
  retrieval round plus a Haiku-class synthesis call (~1-2.5s measured in the
  epoch-1 matrix) instead of the full loop.
- Two prompts and two model configurations exist behind `ask()`; the eval
  matrix must record which lane served each row so per-lane pass rates and
  latency stay observable.
- Misrouting is the new failure mode to watch: a fast-laned question that
  needed traversal shows up as a groundedness or answer-quality failure and
  escalation-rate metrics in the trajectory. The eval dataset's multi-hop
  and campaign classes guard the routing boundary.
- The deep lane inherits the project's Phase 2/3 work (knowledge-graph
  substrate, model-judged verification) without interference from fast-lane
  changes.
- Re-evaluate the deterministic classifier if eval shows either >10% of
  fast-lane-eligible questions escalating or any fast-laned multi-hop or
  campaign case.

## Advice

Brian approved the lane split direction in the Phase 0 checkpoint review of
the Table Turnaround II project (2026-07-05), including retiring the
template path once the fast lane matches it on eval. The judged calibration
set (SQR-392) supplied the evidence that template answers fail the human
bar.
