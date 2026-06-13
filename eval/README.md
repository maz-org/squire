# Squire eval suites

LangSmith regression suites over the production LangGraph agent. Cases are
static JSON under `eval/suites/`, validated deterministically by
`test/eval-dataset.test.ts`.

## Running

```sh
node eval/run.ts --seed                                  # publish datasets
node eval/run.ts --game=frosthaven --suite=table-qa      # filtered run
node eval/run.ts --suite=campaign-personalization        # campaign suite
```

Runs cost LLM tokens; CI validates dataset shape only.

## Suites

| Suite                      | What it proves                                                   |
| -------------------------- | ---------------------------------------------------------------- |
| `table-qa`                 | Rules answers grounded in retrieved sources                      |
| `trajectory`               | Tool-call trajectories for representative questions              |
| `cross-game-boundary`      | No cross-game contamination                                      |
| `adversarial-boundary`     | Prompt-injection resistance (system prompt, roles, history)      |
| `campaign-personalization` | Personalized reads from campaign state + isolation (SQR-272/270) |

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
