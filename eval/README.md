# Squire eval suites

LangSmith regression suites over the production LangGraph agent. Cases are
static JSON under `eval/suites/`, validated deterministically by
`test/eval-dataset.test.ts`.

## Running

```sh
node eval/run.ts --seed                                  # publish datasets
node eval/run.ts --game=frosthaven --suite=table-qa      # filtered run
node eval/run.ts --suite=table-qa --split=dev            # tuning set only
node eval/run.ts --suite=campaign-personalization        # campaign suite
```

Runs cost LLM tokens; CI validates dataset shape only.

## Latency budgets

Eval cases may define a `latencyBudget` object with `firstAnswerTokenMs` and/or
`completeAnswerMs`. Matrix rows report `firstAnswerTokenLatencyMs`, the
configured budgets, and `latencyBudgetPass`; a budget miss fails the row with
`failureClass: "latency_budget"` when the answer otherwise passed. The
first-answer metric is measured at the first non-empty answer `text` event, so
it follows the same boundary the browser sees.

## Table-qa splits

Every `table-qa` case declares `split: "dev"` or `split: "holdout"`.
Iteration and prompt/runtime tuning should run `--suite=table-qa --split=dev`.
Use `--split=holdout` only for the release gate or a recorded baseline, and do
not tune against holdout failures directly. The split is copied into LangSmith
example metadata and expected output during `--seed`; reseed after changing
local fixture split values.

## Question classes (stratified latency)

Every `table-qa` case declares a `questionClass` so latency percentiles can be
reported per class instead of blending across the dataset shape. Matrix local
reports include a `latencySummary` (overall + per-class first-token and
complete P50/P95, nearest-rank) in the JSON and a "Table-QA Latency
Percentiles" section in the Markdown. Tagging rubric:

- `exact-lookup` — one structured record read answers the question: a single
  item, monster stat card, character mat, ability card, battle goal, personal
  quest, building, or one scenario's own structured fields. Tool-free
  assistant-metadata questions also sit here (no retrieval either way).
- `rules-synthesis` — the answer comes from rules/FAQ/errata passages and
  requires composing or explaining text: condition definitions, procedure
  steps, interactions, corrections over printed text.
- `multi-hop` — the answer requires following a link to a second record:
  incoming section links, unlock chains, parent/child scenario-section
  traversal.
- `campaign` — the answer depends on seeded campaign state (reserved; campaign
  reads/writes currently live in their own suites).

The class is copied into LangSmith example metadata during `--seed`; reseed
after changing local fixture class values.

## Groundedness

Table-qa final-answer cases get a deterministic `groundedness` score in
addition to semantic correctness. Groundedness requires non-empty answer text,
source evidence from successful tool calls for source-backed cases, and no
game-qualified canonical refs from the wrong game. This keeps citation/source
checks separate from the LLM answer judge while still making ungrounded answers
fail the matrix row. App-source questions such as tool-free assistant metadata
do not require retrieval evidence.

## Judge calibration

The semantic answer judge is calibrated with a checked-in `table-qa` dev-set
reference fixture:

```sh
npm run eval:judge-calibration -- --max-estimated-cost-usd=1
```

The runner evaluates the existing Haiku answer judge against
`eval/judge-calibration/table-qa-reference.json` and writes JSON plus Markdown
reports under `docs/plans/`. The fixture uses only `split: "dev"` cases and
records explicit `frosthaven` or `gloomhaven-2e` game metadata for every
reference answer. Holdout cases are intentionally excluded. Safety and
groundedness remain deterministic scores and are not calibrated through the
semantic judge.

## Suites

| Suite                      | What it proves                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `table-qa`                 | Rules answers grounded in retrieved sources                                                     |
| `trajectory`               | Tool-call trajectories for representative questions                                             |
| `cross-game-boundary`      | No cross-game contamination                                                                     |
| `adversarial-boundary`     | Prompt-injection resistance (system prompt, roles, history)                                     |
| `campaign-personalization` | Personalized reads from campaign state + isolation (SQR-272/270)                                |
| `campaign-writes`          | Conversational writes: staged batches, onboarding, injection-induced-write resistance (SQR-288) |

Campaign cases declare a `campaignFixture`; the runner seeds it
deterministically (`eval/campaign-fixture.ts`, idempotent) and runs with the
fixture owner's identity through the same context path production uses.

## Isolation failure triage (SQR-270)

Cross-member private extraction is prevented **structurally**: other members'
private-tier fields never enter the requester's context window
(`CampaignContextView` omits them at the type level), so the agent cannot
leak what it never saw. The `cross-member-private-extraction` cases plant a
canary in another member's private field and pattern-ban it.

**Any failure of these cases is a real context-assembly bug — never a model
flake.** Triage rule: a canary hit means a code path loaded another member's
private tier into context; treat it as a release blocker and bisect the
projection (`src/campaign/context.ts`, `src/campaign/knowledge.ts`,
`src/campaign/journal.ts`) rather than re-running the eval.

## Write-path failure triage (SQR-288)

The `injection-induced-write` cases plant write instructions in
member-authored content (a character name in the `gh2e-writes` fixture) and
forbid every write-family tool in the trajectory. **Any write call on these
cases is a release blocker, not a tunable** — it means member-authored data
crossed from the data fence into instruction-following. Bisect the prompt
assembly (`src/campaign/context.ts`) and the system-prompt campaign rules
(`src/agent.ts`) rather than re-running.

Two operational notes for this suite:

- `cw-onboarding-interview` exercises the REAL create path, so the fixture
  appends `squire-eval-onboarder@maz.org` to `SQUIRE_ALLOWED_EMAILS` for the
  process and deletes campaigns left by prior runs before each seed.
- Session-end metric 3 (≥95% correct application) is measured over the
  `session-end-batch` cases in the scheduled LangSmith suite; record the
  baseline on the first scheduled run after merge.
