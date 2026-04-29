# SQR-122 Retrieval Eval Decision Report

**Date:** 2026-04-29  
**Decision:** Defer the redesigned tool surface and keep the legacy
prompt-routed tool surface for Phase 1 production.

## Recommendation

Proceed to the deployment and production-readiness work that was gated by
SQR-115, but ship Phase 1 on the legacy tool surface. Do not ship the redesigned
self-describing tool surface as the production default yet.

This report does not recommend a Deep Agents spike before production. The
observed failures are mostly answer-quality, exact-open discipline, source-data,
and invalid-ref behavior. Those should be fixed in the existing follow-up work
before revisiting runtime migration.

## Runs

Both runs used the same checked-in `eval/dataset.json` suite:

- 29 total cases
- 18 final-answer cases
- 12 trajectory cases
- `traj-invalid-cross-game-ref` counts in both groups because it has both
  final-answer and trajectory expectations

Commands:

```bash
npm run eval -- --tool-surface=legacy --name=sqr-122-legacy --local-report=/tmp/sqr-122-legacy.json
npm run eval -- --tool-surface=redesigned --name=sqr-122-redesigned --local-report=/tmp/sqr-122-redesigned.json
```

The local JSON report mode uses the same agent, judge prompt, final-answer
scoring, and trajectory scorer as `eval/run.ts`. It also records per-case
latency, token usage, tool-call count, tool names, source labels, canonical refs,
and failure reasons.

## Summary

| Metric                                    |            Legacy surface |        Redesigned surface |
| ----------------------------------------- | ------------------------: | ------------------------: |
| Final-answer pass rate                    |               15/18 (83%) |               13/18 (72%) |
| Average final-answer score                |                    4.28/5 |                    3.83/5 |
| Trajectory pass rate                      |                      0/12 |                      8/12 |
| Required canonical refs found             |                      8/13 |                     12/13 |
| Forbidden-tool or forbidden-kind failures |                         2 |                         0 |
| Tool-budget failures                      |                         1 |                         1 |
| Average tool calls per case               |                      2.55 |                      3.21 |
| Average latency per case                  |                    12.99s |                    14.45s |
| Total latency                             |                   376.58s |                   418.97s |
| Input tokens                              |                   563,757 |                   481,395 |
| Output tokens                             |                    16,333 |                    17,654 |
| Total tokens                              |                   580,090 |                   499,049 |
| System prompt length                      | 2,565 chars (~642 tokens) | 1,424 chars (~356 tokens) |

Dollar cost is not frozen in this repo because model prices are external. The
raw token totals are included so current provider pricing can be applied later.
On raw model tokens, the redesigned surface used 81,041 fewer total tokens
(-14.0%) despite producing 1,321 more output tokens.

## Final-Answer Results

| Case                            |   Legacy | Redesigned | Notes                                                                                                          |
| ------------------------------- | -------: | ---------: | -------------------------------------------------------------------------------------------------------------- |
| `rule-long-rest-init`           | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-long-rest-steps`          | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-scenario-level`           | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-poison`                   | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-brittle`                  | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-advantage`                | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-small-items`              | pass 5/5 |   pass 5/5 |                                                                                                                |
| `rule-looting-definition`       | pass 5/5 |   pass 5/5 |                                                                                                                |
| `monster-vermling-scout`        | pass 5/5 |   fail 1/5 | Redesigned retrieved ability cards but not the monster stat record.                                            |
| `monster-living-bones-immunity` | fail 1/5 |   fail 1/5 | Both surfaces answered that Living Bones have no immunities, contradicting the expected Poison/Wound immunity. |
| `monster-flame-demon-elite`     | pass 5/5 |   pass 5/5 |                                                                                                                |
| `building-alchemist`            | fail 1/5 |   fail 1/5 | Both surfaces failed to provide the expected level-1 build cost.                                               |
| `item-spyglass`                 | pass 4/5 |   pass 4/5 |                                                                                                                |
| `item-crude-boots`              | pass 4/5 |   pass 5/5 |                                                                                                                |
| `scenario-61-unlock`            | fail 2/5 |   fail 1/5 | Legacy answered section 79.4 instead of 67.1; redesigned hit the iteration limit.                              |
| `rule-wound`                    | pass 5/5 |   pass 5/5 |                                                                                                                |
| `tool-free-assistant-game`      | pass 5/5 |   pass 5/5 |                                                                                                                |
| `traj-invalid-cross-game-ref`   | pass 5/5 |   fail 1/5 | Redesigned failed the Gloomhaven 2 rejection expectation.                                                      |

## Trajectory Results

| Case                                  |         Legacy |     Redesigned | Redesigned failure reason                                                                                                   |
| ------------------------------------- | -------------: | -------------: | --------------------------------------------------------------------------------------------------------------------------- |
| `traj-source-discovery`               | fail (2 calls) |  pass (1 call) |                                                                                                                             |
| `traj-scenario-conclusion-open`       | fail (3 calls) | pass (4 calls) |                                                                                                                             |
| `traj-section-read-now-chain`         | fail (4 calls) | pass (4 calls) |                                                                                                                             |
| `traj-exact-item-open`                | fail (3 calls) | fail (7 calls) | Expected at most 6 tool calls, saw 7.                                                                                       |
| `traj-rule-brittle-citation`          |  fail (1 call) |  pass (1 call) |                                                                                                                             |
| `traj-ambiguous-algox-archer`         | fail (3 calls) | fail (3 calls) | Missing required tool: `resolve_entity`; missing required tool kind: `resolution`.                                          |
| `traj-scenario-neighbors`             | fail (7 calls) | pass (4 calls) |                                                                                                                             |
| `traj-section-unlocks-scenario`       |  fail (1 call) | pass (2 calls) |                                                                                                                             |
| `traj-scenario-conclusion-next-links` | fail (5 calls) | pass (5 calls) |                                                                                                                             |
| `traj-rule-during-scenario`           | fail (3 calls) | pass (4 calls) |                                                                                                                             |
| `traj-card-fuzzy-vs-exact`            | fail (5 calls) | fail (2 calls) | Missing required tool: `open_entity`; missing required tool kind: `open`.                                                   |
| `traj-invalid-cross-game-ref`         | fail (2 calls) | fail (2 calls) | Missing required tool: `open_entity`; missing required tool kind: `open`; missing required ref: `section:gloomhaven2/67.1`. |

## Failure Modes

Legacy surface:

- Better final-answer pass rate today.
- Fails the redesigned trajectory suite because it cannot use the new
  self-describing operations by design.
- Uses forbidden or wasteful paths on two trajectory cases, including scenario
  traversal when the scenario mention is incidental.
- Uses the longer prompt and more total tokens.

Redesigned surface:

- Much better trajectory behavior: 8/12 pass, 12/13 required refs found, and no
  forbidden-tool failures.
- Worse final-answer quality: 13/18 versus legacy's 15/18.
- Still misses exact-open behavior after resolution in card cases.
- Fails the cross-game invalid-ref case in both final answer and trajectory.
- Hits the iteration limit on `scenario-61-unlock`.
- Is slower on this run despite lower token usage.

## Decision Rationale

The redesigned surface is a real improvement for tool-path shape, prompt length,
and token volume. It is not ready to be the production default because the Phase
1 user-facing final-answer score regressed and the remaining failures are
load-bearing:

- exact monster/card record lookup is inconsistent
- cross-game ref handling can silently reuse the wrong game path
- scenario unlock traversal can still stall
- known source-data or fixture issues remain in the final-answer suite

The legacy surface is not a good long-term retrieval contract, but it is the
better Phase 1 production default because users experience the final answer, not
the internal tool contract. SQR-136 and SQR-137 already track the redesigned
trajectory and final-answer follow-up work.

## Gate Outcome

SQR-115 can be unblocked after this report lands. Deployment/readiness steps 4
and 5 may proceed on the legacy production surface. The redesigned surface
should remain selectable for evals and follow-up tickets, but it should not be
the default production path until its final-answer pass rate is at least level
with legacy and the remaining trajectory failures are fixed.
