# SQR-134 Multi-Model Eval Decision Report

Generated on 2026-05-02 for SQR-134. Updated after expanding the matrix from
three models to seven candidate models from the provided pricing sheets.

## Decision

Keep Phase 1 production on the existing Anthropic-only path with
`anthropic:claude-sonnet-4-6` as the default model.

The expanded seven-model sweep does not change the production call. Sonnet 4.6
still has the highest pass rate and is the only model that passed every
trajectory case.

Do not add a production multi-provider abstraction now. The OpenAI eval lane is
valuable for continued comparison work, but none of the OpenAI candidates
matched Sonnet's trajectory reliability. `openai:gpt-5.5` also still hit a
loop-limit failure in the expanded run.

Do not switch production to `anthropic:claude-opus-4-7`. Opus is close, but it
still missed one trajectory case and cost more than Sonnet in this run.

Do not switch production to `anthropic:claude-haiku-4-5` yet. Haiku is the most
interesting new candidate because it was fast and cheap, but it missed three
cases including one trajectory case.

## Source Run

Primary raw checked-in export:
[`docs/plans/sqr-134-expanded-full-matrix-report.json`](./sqr-134-expanded-full-matrix-report.json)

Earlier three-model export:
[`docs/plans/sqr-134-full-matrix-report.json`](./sqr-134-full-matrix-report.json)

Primary run label: `sqr-134-expanded-full-matrix-2026-05-02`

Command:

```bash
npm run eval -- --matrix --allow-full-dataset --allow-estimated-cost \
  --max-estimated-cost-usd=15 --retry-count=1 --timeout-ms=60000 \
  --anthropic-concurrency=2 --openai-concurrency=2 \
  --name=sqr-134-expanded-full-matrix-2026-05-02 \
  --local-report=docs/plans/sqr-134-expanded-full-matrix-report.json
```

The earlier three-model attempt used the same matrix without `--timeout-ms`; it
was stopped after roughly 11 minutes because no report had been written and the
process was still waiting inside provider calls. The expanded timeout-bounded
run is now the source of record for this report.

Run settings:

- Dataset: 29 eval cases, 203 model-case rows.
- Tool surface: `redesigned`.
- Models:
  - `anthropic:claude-sonnet-4-6`
  - `anthropic:claude-opus-4-7`
  - `anthropic:claude-haiku-4-5`
  - `openai:gpt-5.5`
  - `openai:gpt-5.4`
  - `openai:gpt-5.4-mini`
  - `openai:gpt-5.4-nano`
- Provider timeout: 60 seconds.
- Retry count: 1.
- Provider concurrency: 2 Anthropic, 2 OpenAI.
- Matrix guardrail estimate: $10.15 total, $1.45 per model.

Pricing sources:

- Claude pricing from the provided local PDF,
  `/Users/bcm/Downloads/Models overview - Claude API Docs.pdf`: Opus 4.7 at
  $5/input MTok and $25/output MTok; Sonnet 4.6 at $3/input MTok and
  $15/output MTok; Haiku 4.5 at $1/input MTok and $5/output MTok.
- OpenAI pricing from the provided screenshot: GPT-5.5 standard short context
  at $5/input MTok and $30/output MTok; GPT-5.4 at $2.50/input MTok and
  $15/output MTok; GPT-5.4-mini at $0.75/input MTok and $4.50/output MTok;
  GPT-5.4-nano at $0.20/input MTok and $1.25/output MTok. The screenshot also
  shows long-context GPT-5.5 and GPT-5.4 pricing; because the eval export does
  not mark whether long-context pricing applied, the table uses short-context
  pricing and notes the all-long-context upper estimates separately.

Cost note: the current matrix export records a flat guardrail estimate of
$0.05 per model-case row. That remains useful for run safety, but the dollar
cost below is calculated from the exported input/output token counts and the
provided provider prices. The export does not break out cached input tokens, so
cached-input discounts are not included.

## Summary By Model

| Model                         |     Pass rate | Scored avg | Avg latency | P95 latency | Input tokens | Output tokens | Total tokens | Provider cost | Avg tools | Avg loops | Failures |
| ----------------------------- | ------------: | ---------: | ----------: | ----------: | -----------: | ------------: | -----------: | ------------: | --------: | --------: | -------: |
| `anthropic:claude-sonnet-4-6` | 28/29 (96.6%) |      0.972 |       10.9s |       17.3s |      352,825 |        14,797 |      367,622 |         $1.28 |      2.41 |      3.10 |        1 |
| `anthropic:claude-opus-4-7`   | 27/29 (93.1%) |      0.931 |        9.9s |       22.8s |      359,834 |        16,518 |      376,352 |         $2.21 |      1.97 |      2.69 |        2 |
| `anthropic:claude-haiku-4-5`  | 26/29 (89.7%) |      0.924 |        4.6s |        9.9s |      349,456 |        10,360 |      359,816 |         $0.40 |      2.34 |      3.07 |        3 |
| `openai:gpt-5.5`              | 26/29 (89.7%) |      0.936 |       14.9s |       30.3s |    1,476,957 |        13,742 |    1,490,699 |         $7.80 |      3.90 |      4.86 |        3 |
| `openai:gpt-5.4`              | 24/29 (82.8%) |      0.821 |       10.3s |       20.8s |      820,786 |        10,003 |      830,789 |         $2.20 |      2.48 |      3.48 |        5 |
| `openai:gpt-5.4-mini`         | 19/29 (65.5%) |      0.697 |        5.5s |        9.6s |      752,722 |         5,242 |      757,964 |         $0.59 |      2.34 |      3.34 |       10 |
| `openai:gpt-5.4-nano`         | 15/29 (51.7%) |      0.559 |        7.6s |       13.2s |    1,018,180 |         6,460 |    1,024,640 |         $0.21 |      2.97 |      3.97 |       14 |

`Scored avg` excludes unscored loop-limit rows where no final answer existed.
GPT-5.5 would be $15.39 and GPT-5.4 would be $4.33 if every exported token for
those models were billed at the long-context rates shown in the provided OpenAI
screenshot.

## Category Results

| Model                         | Rulebook | Monster stats | Buildings | Items | Scenarios | Tool-free | Trajectory |
| ----------------------------- | -------: | ------------: | --------: | ----: | --------: | --------: | ---------: |
| `anthropic:claude-sonnet-4-6` |      9/9 |           3/3 |       0/1 |   2/2 |       1/1 |       1/1 |      12/12 |
| `anthropic:claude-opus-4-7`   |      9/9 |           3/3 |       1/1 |   1/2 |       1/1 |       1/1 |      11/12 |
| `anthropic:claude-haiku-4-5`  |      9/9 |           3/3 |       0/1 |   1/2 |       1/1 |       1/1 |      11/12 |
| `openai:gpt-5.5`              |      8/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      10/12 |
| `openai:gpt-5.4`              |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       7/12 |
| `openai:gpt-5.4-mini`         |      8/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       3/12 |
| `openai:gpt-5.4-nano`         |      5/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       2/12 |

## Representative Langfuse Traces

Wins:

- Sonnet rule answer win, `rule-poison`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-sonnet-4-6%3Arule-poison>
- Opus rule answer win, `rule-long-rest-steps`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-opus-4-7%3Arule-long-rest-steps>
- Haiku speed/cost win, `rule-long-rest-init`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-haiku-4-5%3Arule-long-rest-init>
- GPT-5.4 rulebook win, `rule-looting-definition`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aopenai%3Agpt-5.4%3Arule-looting-definition>

Losses:

- Shared Anthropic data-quality loss, `building-alchemist`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-sonnet-4-6%3Abuilding-alchemist>
- OpenAI loop-limit loss, `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>
- GPT-5.4 traversal loss, `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aopenai%3Agpt-5.4%3Atraj-card-fuzzy-vs-exact>
- Haiku traversal loss, `traj-scenario-conclusion-open`:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-haiku-4-5%3Atraj-scenario-conclusion-open>

Confusing cases:

- Sonnet passed `traj-card-fuzzy-vs-exact`, but still needed 4 tool calls and
  20k tokens:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-sonnet-4-6%3Atraj-card-fuzzy-vs-exact>
- OpenAI failed the same `traj-card-fuzzy-vs-exact` case at loop limit after
  10 tool calls and 202k tokens:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>

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

Opus failed two cases:

- `item-spyglass`
- `traj-card-fuzzy-vs-exact`

The pattern is not provider instability. It is still attractive for latency, but
it does not beat Sonnet on reliability and it costs more.

Operational profile:

- No timeouts.
- No loop-limit failures.
- No provider API errors.
- Slightly faster average latency than Sonnet, but lower pass rate and higher
  provider-estimated dollar cost.

### Haiku 4.5

Haiku failed three cases:

- `building-alchemist`
- `item-crude-boots`
- `traj-scenario-conclusion-open`

This is the most interesting new candidate. It was the fastest model in the
expanded run and cost about one third of Sonnet's provider-estimated cost, but
it missed one trajectory case and two final-answer quality cases.

Operational profile:

- No timeouts.
- No loop-limit failures.
- No provider API errors.
- Fastest average latency.
- Lowest useful-model cost, but below Sonnet and Opus on pass rate.

### OpenAI GPT-5.5

GPT-5.5 passed many cases, including `building-alchemist`, but its failures are
still concerning for production:

- `rule-long-rest-steps` returned a judged answer but failed quality at score
  0.6.
- `traj-exact-item-open` failed the trajectory contract.
- `traj-card-fuzzy-vs-exact` reached loop limit with 10 tool calls and 202,023
  tokens.

The loop-limit case is still the blocker. It turns a normal user question into a
large token spend with no answer. This is the exact behavior a production
provider abstraction would need to prevent before OpenAI can safely sit behind
the live `/api/ask` path.

Operational profile:

- No provider API errors.
- No timeout rows under the 60s timeout.
- One loop-limit failure.
- About 4.1x Sonnet's token volume across the same dataset.
- About 6.1x Sonnet's provider-estimated dollar cost under GPT-5.5
  short-context pricing.
- Highest average latency.
- Highest average tool-call and loop counts.

### Other OpenAI Candidates

GPT-5.4 is cheaper than GPT-5.5 and avoided loop-limit failures in this run, but
it passed only 7/12 trajectory cases and 24/29 overall. That is not production
default material for Squire.

GPT-5.4-mini and GPT-5.4-nano are too weak for this eval suite today:

- GPT-5.4-mini passed 19/29 overall and only 3/12 trajectory cases.
- GPT-5.4-nano passed 15/29 overall and only 2/12 trajectory cases.

They may still be useful later for a narrowly-scoped cheap classifier or
tool-free helper, but not for the current answer path.

## Production Call

Recommended Phase 1 default: `anthropic:claude-sonnet-4-6`.

Reasoning:

1. It had the highest pass rate: 28/29.
2. It passed every trajectory case, which matters most for Squire's retrieval
   reliability.
3. It had no timeout, retry, provider, or loop-limit failures.
4. It used far fewer tokens than GPT-5.5 and beat every OpenAI candidate on
   trajectory reliability.
5. It was less expensive than Opus and materially more reliable than Haiku.
6. Its only failure is already in the known building-data/answer-quality area,
   not in provider access or loop control.

Production multi-provider refactor: defer.

The eval lane should keep running OpenAI, Opus, and Haiku comparisons, but
production should not add provider routing until a future eval shows a candidate
can match Sonnet on trajectory reliability. If SQR-135 continues, it should be a
plan for future production abstraction, not an implementation plan for the
current Phase 1 default.

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
- SQR-144: Investigate whether Haiku 4.5 can serve a constrained cheap
  Anthropic lane after its three expanded-run failures are understood.
