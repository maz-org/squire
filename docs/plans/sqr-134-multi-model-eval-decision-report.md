# SQR-134 Multi-Model Eval Decision Report

Generated on 2026-05-02 for SQR-134.

## Decision

Keep Phase 1 production on the existing Anthropic-only path with
`anthropic:claude-sonnet-4-6` as the default model.

Do not add a production multi-provider abstraction now. The OpenAI eval lane is
valuable for continued comparison work, but this run shows it is not stable
enough to justify production routing. It used far more tokens, took longer on
average, and hit loop-limit failures that the current Anthropic production path
did not hit.

Do not switch production to `anthropic:claude-opus-4-7`. Opus was faster and
used slightly fewer tokens than Sonnet in this run, but it missed three
trajectory cases that Sonnet passed.

## Source Run

Raw checked-in export:
[`docs/plans/sqr-134-full-matrix-report.json`](./sqr-134-full-matrix-report.json)

Run label: `sqr-134-full-matrix-2026-05-02-timeout60`

Command:

```bash
npm run eval -- --matrix --allow-full-dataset --allow-estimated-cost \
  --max-estimated-cost-usd=5 --retry-count=1 --timeout-ms=60000 \
  --anthropic-concurrency=2 --openai-concurrency=2 \
  --name=sqr-134-full-matrix-2026-05-02-timeout60 \
  --local-report=docs/plans/sqr-134-full-matrix-report.json
```

The first attempt used the same matrix without `--timeout-ms`; it was stopped
after roughly 11 minutes because no report had been written and the process was
still waiting inside provider calls. The timeout-bounded run is the source of
record for this report.

Run settings:

- Dataset: 29 eval cases, 87 model-case rows.
- Tool surface: `redesigned`.
- Models:
  - `anthropic:claude-sonnet-4-6`
  - `anthropic:claude-opus-4-7`
  - `openai:gpt-5.5`
- Provider timeout: 60 seconds.
- Retry count: 1.
- Provider concurrency: 2 Anthropic, 2 OpenAI.
- Matrix guardrail estimate: $4.35 total, $1.45 per model.

Pricing sources:

- Claude pricing from the provided local PDF,
  `/Users/bcm/Downloads/Models overview - Claude API Docs.pdf`: Opus 4.7 at
  $5/input MTok and $25/output MTok; Sonnet 4.6 at $3/input MTok and
  $15/output MTok.
- OpenAI pricing from the provided screenshot: GPT-5.5 standard short context
  at $5/input MTok and $30/output MTok. The screenshot also shows
  long-context GPT-5.5 pricing at $10/input MTok and $45/output MTok; because
  the eval export does not mark whether long-context pricing applied, the table
  uses short-context pricing and notes the all-long-context upper estimate
  separately.

Cost note: the current matrix export records a flat guardrail estimate of
$0.05 per model-case row. That remains useful for run safety, but the dollar
cost below is calculated from the exported input/output token counts and the
provided provider prices. The export does not break out cached input tokens, so
cached-input discounts are not included.

## Summary By Model

| Model                         |     Pass rate | Scored avg | Avg latency | P95 latency | Input tokens | Output tokens | Total tokens | Provider cost | Avg tools | Avg loops |       Timeouts/errors |
| ----------------------------- | ------------: | ---------: | ----------: | ----------: | -----------: | ------------: | -----------: | ------------: | --------: | --------: | --------------------: |
| `anthropic:claude-sonnet-4-6` | 28/29 (96.6%) |      0.966 |       12.2s |       24.8s |      363,574 |        15,480 |      379,054 |         $1.32 |      2.55 |      3.10 |                     0 |
| `anthropic:claude-opus-4-7`   | 25/29 (86.2%) |      0.862 |        9.8s |       23.1s |      350,593 |        13,678 |      364,271 |         $2.09 |      1.76 |      2.59 |                     0 |
| `openai:gpt-5.5`              | 26/29 (89.7%) |      0.978 |       14.9s |       29.5s |    1,421,074 |        13,990 |    1,435,064 |         $7.53 |      3.55 |      4.48 | 2 loop-limit failures |

`Scored avg` excludes unscored loop-limit rows where no final answer existed.
GPT-5.5 would be $14.84 if every exported token were billed at the long-context
rates shown in the provided OpenAI screenshot.

## Category Results

| Model                         | Rulebook | Monster stats | Buildings | Items | Scenarios | Tool-free | Trajectory |
| ----------------------------- | -------: | ------------: | --------: | ----: | --------: | --------: | ---------: |
| `anthropic:claude-sonnet-4-6` |      9/9 |           3/3 |       0/1 |   2/2 |       1/1 |       1/1 |      12/12 |
| `anthropic:claude-opus-4-7`   |      9/9 |           3/3 |       0/1 |   2/2 |       1/1 |       1/1 |       9/12 |
| `openai:gpt-5.5`              |      8/9 |           3/3 |       1/1 |   1/2 |       1/1 |       1/1 |      11/12 |

## Representative Langfuse Traces

Wins:

- Sonnet rule answer win, `rule-poison`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aanthropic%3Aclaude-sonnet-4-6%3Arule-poison>
- Opus rule answer win, `rule-long-rest-steps`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aanthropic%3Aclaude-opus-4-7%3Arule-long-rest-steps>
- OpenAI card-data win, `building-alchemist`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aopenai%3Agpt-5.5%3Abuilding-alchemist>

Losses:

- Shared Anthropic data-quality loss, `building-alchemist`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aanthropic%3Aclaude-sonnet-4-6%3Abuilding-alchemist>
- OpenAI loop-limit loss, `rule-looting-definition`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aopenai%3Agpt-5.5%3Arule-looting-definition>
- Opus traversal loss, `traj-scenario-conclusion-open`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aanthropic%3Aclaude-opus-4-7%3Atraj-scenario-conclusion-open>

Confusing cases:

- Sonnet passed `traj-card-fuzzy-vs-exact`, but needed 8 tool calls and 32k
  tokens:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aanthropic%3Aclaude-sonnet-4-6%3Atraj-card-fuzzy-vs-exact>
- OpenAI failed the same `traj-card-fuzzy-vs-exact` case at loop limit after
  10 tool calls and 142k tokens:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>

## Failure Modes

### Sonnet 4.6

Sonnet failed only `building-alchemist`. The answer correctly said the level 1
Alchemist has no build cost, but also included unsupported/wrong framing about
the building effect and upgrade state. This is a data/answer-quality issue, not
a model access or loop issue.

Operational profile:

- No timeouts.
- No loop-limit failures.
- No provider API errors.
- Lowest pass risk in the matrix.

### Opus 4.7

Opus failed the same `building-alchemist` case, plus three trajectory cases:

- `traj-scenario-conclusion-open`
- `traj-scenario-conclusion-next-links`
- `traj-card-fuzzy-vs-exact`

The pattern is not provider instability. It is a behavior problem: Opus often
used fewer tools and shorter loops, but sometimes stopped before satisfying the
trajectory contract. That makes it attractive for latency but worse as a Phase 1
default.

Operational profile:

- No timeouts.
- No loop-limit failures.
- No provider API errors.
- Fastest average latency and lowest token volume, but lower pass rate.

### OpenAI GPT-5.5

OpenAI passed many cases, including `building-alchemist`, but its failures are
more concerning for production:

- `rule-looting-definition` reached loop limit with 10 tool calls and 200,889
  tokens.
- `traj-card-fuzzy-vs-exact` reached loop limit with 10 tool calls and 141,979
  tokens.
- `item-spyglass` returned a judged answer but failed quality at score 0.6.

The loop-limit cases are the blocker. They turn a normal user question into a
large token spend with no answer. This is the exact behavior a production
provider abstraction would need to prevent before OpenAI can safely sit behind
the live `/api/ask` path.

Operational profile:

- No provider API errors.
- No timeout rows under the 60s timeout.
- Two loop-limit failures.
- About 3.8x Sonnet's token volume across the same dataset.
- About 5.7x Sonnet's provider-estimated dollar cost under GPT-5.5
  short-context pricing.
- Highest average latency.
- Highest average tool-call and loop counts.

## Production Call

Recommended Phase 1 default: `anthropic:claude-sonnet-4-6`.

Reasoning:

1. It had the highest pass rate: 28/29.
2. It passed every trajectory case, which matters most for Squire's retrieval
   reliability.
3. It had no timeout, retry, provider, or loop-limit failures.
4. It used far fewer tokens than OpenAI.
5. Its only failure is already in the known building-data/answer-quality area,
   not in provider access or loop control.

Production multi-provider refactor: defer.

The eval lane should keep running OpenAI and Opus comparisons, but production
should not add provider routing until a future eval shows OpenAI can avoid
loop-limit failures and keep token volume closer to Anthropic. If SQR-135
continues, it should be a plan for future production abstraction, not an
implementation plan for the current Phase 1 default.

## Follow-Up Work

- SQR-143: Fix or re-evaluate the `building-alchemist` expected-answer/data
  contract so correct "no build cost" answers are not mixed with unsupported
  effect text.
- SQR-140: Add provider/model price metadata to the matrix cost estimator. The
  current flat $0.05 row estimate is not enough for dollar-cost decisions.
- SQR-141: Investigate OpenAI loop behavior on broad rulebook and fuzzy/exact
  card questions before any production OpenAI routing is considered.
- SQR-142: Investigate why Opus stops early on traversal cases despite using
  fewer tools.
