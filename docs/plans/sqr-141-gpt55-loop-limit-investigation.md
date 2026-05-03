# SQR-141 GPT-5.5 Loop-Limit Investigation

Generated on 2026-05-03 for SQR-141.

## Decision

Keep OpenAI out of production routing for now.

The loop-limit symptom is mitigated in eval-only code, but the rerun still shows
GPT-5.5 missing the trajectory contract on `traj-card-fuzzy-vs-exact`. It
answers after the tool budget guard fires, but it does not use the required
`resolve_entity` and `open_entity` path. That is enough reason not to put GPT-5.5
behind production `/api/ask`.

No production provider routing was added.

## Root Cause

There were two separate causes behind the SQR-134 loop-limit failures.

1. The OpenAI eval runner did not apply the production agent's default repeated
   rule-search synthesis guard. The live Anthropic path defaults to forcing a
   final answer after three broad rule searches. The OpenAI eval runner only did
   this when `--broad-search-synthesis-threshold` was explicitly set, so the
   SQR-134 matrix let GPT-5.5 keep searching until the loop limit.

2. Trajectory evals had a `maxToolCalls` contract, but the OpenAI eval runner did
   not use that contract to stop tools. On `traj-card-fuzzy-vs-exact`, GPT-5.5
   kept tool access after it had enough context and spent the remaining loop
   budget on broad fallback searches, including high-volume `list_cards` calls.

The traces do not show provider API errors or tool execution failures. They show
tool-loop control failures and model/tool-choice drift.

## Mitigation

The eval-only OpenAI runner now:

- defaults repeated broad rule-search synthesis to three searches, matching the
  production Anthropic agent path;
- disables tools and asks for final synthesis once a trajectory case reaches its
  `maxToolCalls` budget.

This is intentionally limited to `eval/openai-runner.ts`.

## Evidence

### `rule-looting-definition`

Before:

- Trace:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-full-matrix-2026-05-02-timeout60%3Aopenai%3Agpt-5.5%3Arule-looting-definition>
- Result: loop limit, no final answer.
- Tool calls: 10.
- Loop iterations: 10.
- Tokens: 200,889.

After:

- Trace:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-141-gpt55-rule-mitigated%3Aopenai%3Agpt-5.5%3Arule-looting-definition>
- Result: pass.
- Tool calls: 3.
- Loop iterations: 4.
- Tokens: 35,722.

The rule-search guard fixed this case and reduced token use by about 82%.

### `traj-card-fuzzy-vs-exact`

Before:

- Trace:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>
- Result: loop limit, no final answer.
- Tool calls recorded by the runner: 10.
- Loop iterations: 10.
- Tokens: 202,023.
- Notable behavior: GPT-5.5 used high-volume fallback calls including an
  unfiltered `list_cards` over monster abilities.

After:

- Trace:
  <https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-141-gpt55-traj-mitigated%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>
- Result: final answer produced, but trajectory failed.
- Tool calls: 8.
- Loop iterations: 9.
- Tokens: 174,966.
- Remaining failure:
  missing required tool `resolve_entity`, missing required tool `open_entity`,
  missing required tool kind `resolution`, and missing required tool kind
  `open`.

The tool-budget guard prevents the no-answer loop-limit failure, but it does not
make GPT-5.5 follow the required trajectory. That remaining behavior is a prompt
and model/tool-selection issue, not a loop-control issue.

## Verification

Focused regression tests:

```bash
npm test -- test/eval-openai-runner.test.ts
```

Live reruns:

```bash
npm run eval -- --provider=openai --model=gpt-5.5 \
  --id=rule-looting-definition \
  --run-label=sqr-141-gpt55-rule-mitigated \
  --timeout-ms=60000

npm run eval -- --provider=openai --model=gpt-5.5 \
  --id=traj-card-fuzzy-vs-exact \
  --run-label=sqr-141-gpt55-traj-mitigated \
  --timeout-ms=60000
```

## Follow-Up

Do not expand this ticket into production provider routing.

If OpenAI production routing is revisited later, the next work should focus on
OpenAI-specific trajectory prompting and tool-result shaping so it uses
`resolve_entity` and `open_entity` for exact-record tasks instead of relying on
large fuzzy searches.
