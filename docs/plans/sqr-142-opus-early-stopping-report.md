# SQR-142 Opus 4.7 Trajectory Early-Stopping Report

Generated on 2026-05-03 for SQR-142.

## Summary

The SQR-134 failures were not provider errors, timeouts, loop-limit stops, or a
bad trajectory evaluator. Opus 4.7 reached `end_turn` with plausible answers
before opening the exact records the user had asked to show or inspect.

The root cause was prompt-loop wording: the system prompt said to open exact
records, but the post-tool guidance made it too easy for Opus to answer from a
scenario pointer, a neighbor result, or resolver/search summaries.

The fix is a narrow eval-loop prompt adjustment:

- after `resolve_entity` returns candidates, remind the model to open the best
  exact ref before answering exact-record/source-text questions
- after `neighbors` returns targets, explicitly require `open_entity` when the
  user asks to show, open, quote, cite, list, or explain returned
  scenario/section content

No production model switch was made.

## Original Failure Evidence

Source run: `sqr-134-full-matrix-2026-05-02-timeout60`

| Case                                  | Opus failed because                                                                                                           | Failed Opus trace                                                                                                                                                                                | Passing Sonnet trace                                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traj-scenario-conclusion-open`       | Opus used `resolve_entity -> neighbors`, then answered from the conclusion pointer without opening `section:frosthaven/67.1`. | [Opus trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-opus-4-7:traj-scenario-conclusion-open)       | [Sonnet trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-sonnet-4-6:traj-scenario-conclusion-open)       |
| `traj-scenario-conclusion-next-links` | Opus used `resolve_entity -> neighbors -> neighbors`, then answered without opening the conclusion section.                   | [Opus trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-opus-4-7:traj-scenario-conclusion-next-links) | [Sonnet trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-sonnet-4-6:traj-scenario-conclusion-next-links) |
| `traj-card-fuzzy-vs-exact`            | Opus used `resolve_entity -> search_knowledge`, then stated it should open exact stat records but answered without doing so.  | [Opus trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-opus-4-7:traj-card-fuzzy-vs-exact)            | [Sonnet trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-134-full-matrix-2026-05-02-timeout60:anthropic:claude-sonnet-4-6:traj-card-fuzzy-vs-exact)            |

All three Opus traces had `status: completed` and `stop reason: end_turn`. The
trajectory score failed only because `open_entity` was missing. That matches
the eval contract: these prompts ask the assistant to show/open exact content,
not merely identify a pointer to it.

## Rerun Evidence

After the prompt-loop adjustment, the three targeted Opus cases passed.

Langfuse-backed run label: `sqr-142-opus-open-nudge-langfuse-2026-05-03`

```bash
npm run eval -- --id=<case-id> --provider=anthropic \
  --model=claude-opus-4-7 --timeout-ms=60000 \
  --name=sqr-142-opus-open-nudge-langfuse-2026-05-03
```

| Case                                  | Result | Tool path                                                          | Rerun trace                                                                                                                                                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traj-scenario-conclusion-open`       | Pass   | `resolve_entity -> neighbors -> open_entity`                       | [Trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-142-opus-open-nudge-langfuse-2026-05-03:anthropic:claude-opus-4-7:traj-scenario-conclusion-open)       |
| `traj-scenario-conclusion-next-links` | Pass   | `neighbors -> open_entity -> resolve_entity -> neighbors`          | [Trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-142-opus-open-nudge-langfuse-2026-05-03:anthropic:claude-opus-4-7:traj-scenario-conclusion-next-links) |
| `traj-card-fuzzy-vs-exact`            | Pass   | `open_entity -> open_entity -> resolve_entity -> search_knowledge` | [Trace](https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-142-opus-open-nudge-langfuse-2026-05-03:anthropic:claude-opus-4-7:traj-card-fuzzy-vs-exact)            |

A local JSON rerun with the same code path also passed all three cases:

| Case                                  | Tool calls | Iterations | Stop reason |
| ------------------------------------- | ---------: | ---------: | ----------- |
| `traj-scenario-conclusion-open`       |          3 |          4 | `end_turn`  |
| `traj-scenario-conclusion-next-links` |          3 |          4 | `end_turn`  |
| `traj-card-fuzzy-vs-exact`            |          4 |          3 | `end_turn`  |

## Default-Routing Call

Opus 4.7 can stay under consideration for future default routing because the
early-stopping blocker reproduced by SQR-142 passed in the focused rerun.

That is not enough to switch production. SQR-134 still showed Sonnet 4.6 as the
best full-matrix default, and Opus had at least one non-trajectory miss
(`item-spyglass`) plus higher cost. A production change would need another full
matrix after this prompt-loop adjustment.

## Verification

```bash
npx vitest run test/agent.test.ts
npm run db:migrate
npm run db:migrate:test
npm run index
npm run seed:dev
npm run eval -- --id=traj-scenario-conclusion-open --provider=anthropic --model=claude-opus-4-7 --timeout-ms=60000 --name=sqr-142-opus-open-nudge-langfuse-2026-05-03
npm run eval -- --id=traj-scenario-conclusion-next-links --provider=anthropic --model=claude-opus-4-7 --timeout-ms=60000 --name=sqr-142-opus-open-nudge-langfuse-2026-05-03
npm run eval -- --id=traj-card-fuzzy-vs-exact --provider=anthropic --model=claude-opus-4-7 --timeout-ms=60000 --name=sqr-142-opus-open-nudge-langfuse-2026-05-03
```
