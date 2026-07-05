# SQR-375 Table Turnaround Iteration Log

This is the running implementation log for the first measurement slice of
Linear project "Squire · Table Turnaround: Answer Quality & Latency Bar".

## 2026-07-03 — First-token and latency-budget harness

Hypothesis: adding first-answer-token timing and per-case latency budgets to the
eval harness will make the Table Turnaround latency bar measurable before any
runtime optimization work starts.

Change:

- Added optional `latencyBudget` fields to eval cases:
  `firstAnswerTokenMs`, `completeAnswerMs`, and `notes`.
- Captured `firstAnswerTokenAt` and `firstAnswerTokenLatencyMs` from the first
  non-empty answer `text` event in agent trajectories.
- Made LangGraph eval runs attach a no-op stream callback so the eval path
  observes the same answer-text event boundary as browser streaming.
- Surfaced first-token latency and latency-budget pass/fail in matrix JSON,
  TSV, Markdown, LangSmith evaluator rows, and local report summaries.
- Made matrix rows fail with `failureClass: "latency_budget"` when a configured
  latency budget is missed and answer quality otherwise passed.

Verification:

- `npm test -- --run test/eval-dataset.test.ts test/eval-matrix.test.ts test/eval-matrix-runtime.test.ts test/eval-anthropic-runner.test.ts test/eval-cost-harness.test.ts test/eval-runner.test.ts test/eval-langsmith-eval.test.ts`
  passed: 7 files, 76 tests.
- `npm run typecheck` passed.

Eval spend: $0. This iteration only ran deterministic local tests and
typechecking.

Decision: keep. This does not improve runtime latency yet, but it turns the
first two Table Turnaround latency targets into reportable and enforceable
fields for future full matrix runs.

Next work:

- Add the expanded table-qa dev/holdout dataset and assign latency budgets to
  the relevant cases.
- Add the groundedness evaluator and judge calibration artifact.
- Run the current-production baseline once the expanded dataset and calibration
  gates are in place.

## 2026-07-03 — Table-qa split scaffold

Hypothesis: explicit `dev` and `holdout` split metadata in the checked-in
table-qa fixtures will let us iterate on answer quality without accidentally
tuning against the held-out gate.

Change:

- Added `split: "dev" | "holdout"` to eval case schema and required it for
  every `table-qa` case.
- Added `--split=dev|holdout` and `SQUIRE_EVAL_SPLIT` filtering, with split
  treated as a selected matrix run for guardrail purposes.
- Preserved split metadata in LangSmith seed/load paths.
- Marked existing table-qa cases as `dev`.
- Added six structured-data table-qa cases with latency budgets, including
  four initial holdout cases:
  `building-mining-camp-level-1`, `scenario-7-edge-world-unlocks`,
  `gh2-monster-living-bones-elite-level-1`, and
  `gh2-scenario-4-crypt-damned`.

Verification:

- `npm test -- --run test/eval-dataset.test.ts test/eval-cli.test.ts test/eval-runner.test.ts`
  passed: 3 files, 68 tests.
- `npm run typecheck` passed.
- `npx eslint eval/cli.ts eval/dataset.ts eval/matrix.ts eval/runner.ts eval/schema.ts test/eval-dataset.test.ts test/eval-cli.test.ts`
  passed.
- `npx markdownlint-cli2 eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- `npx prettier --check eval/cli.ts eval/dataset.ts eval/matrix.ts eval/runner.ts eval/schema.ts test/eval-dataset.test.ts test/eval-cli.test.ts eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.

Eval spend: $0. This slice only changed fixtures, filters, and docs.

Decision: keep. This makes the dev set explicit and creates the first holdout
scaffold without changing runtime behavior.

## 2026-07-03 — Groundedness evaluator scaffold

Hypothesis: a deterministic table-qa groundedness score will catch unsupported
answers and wrong-game source use without blending citation/source checks into
the semantic LLM answer judge.

Change:

- Added deterministic groundedness scoring for `table-qa` final-answer cases.
- Required source-backed table answers to have source labels or canonical refs
  from successful tool calls.
- Failed groundedness when game-qualified canonical refs point at the wrong
  game.
- Carried `groundednessPass` and `groundednessFailures` into matrix JSON, TSV,
  Markdown, and LangSmith row feedback.
- Included groundedness failures in row pass/failure-class handling without
  replacing the existing correctness score.
- Updated eval docs with the groundedness contract.

Verification:

- `npm test -- --run test/eval-scoring.test.ts test/eval-matrix.test.ts test/eval-matrix-runtime.test.ts test/eval-langsmith-eval.test.ts test/eval-langsmith-trace.test.ts test/eval-anthropic-runner.test.ts test/eval-deep-agents-runner.test.ts test/eval-openai-runner.test.ts`
  passed: 8 files, 78 tests.
- `npm run typecheck` passed.
- `npx eslint eval/scoring.ts eval/matrix.ts eval/matrix-runtime.ts eval/anthropic-runner.ts eval/deep-agents-runner.ts eval/langsmith-trace.ts eval/langsmith-eval.ts test/eval-scoring.test.ts test/eval-matrix-runtime.test.ts test/eval-matrix.test.ts`
  passed.
- `npx markdownlint-cli2 eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- `npx prettier --check eval/scoring.ts eval/matrix.ts eval/matrix-runtime.ts eval/anthropic-runner.ts eval/deep-agents-runner.ts eval/langsmith-trace.ts eval/langsmith-eval.ts test/eval-scoring.test.ts test/eval-matrix-runtime.test.ts test/eval-matrix.test.ts eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- After a nullability fix, `npm test -- --run test/eval-scoring.test.ts`,
  `npx eslint eval/scoring.ts`, and `npx prettier --check eval/scoring.ts`
  passed.

Eval spend: $0. This slice only changed deterministic scoring, reports, and
docs.

Decision: keep. This adds a deterministic groundedness gate without changing
runtime behavior or tuning against holdout cases.

## 2026-07-04 — Expanded table-qa dataset to project bar

Hypothesis: expanding `table-qa` to the project bar before runtime tuning will
make the next baseline meaningful and reduce the risk of optimizing against the
old saturated 29-case-style slice.

Change:

- Added 108 source-backed `table-qa` final-answer cases.
- Reached 150 total `table-qa` cases with a 100 dev / 50 holdout split.
- Added cases for both supported games, with explicit game metadata on every
  new case: 55 Gloomhaven (2nd Edition) cases and 53 Frosthaven cases.
- Mined LangSmith production traces first. The available production trace
  stream had one root run, and it produced one usable Gloomhaven (2nd Edition)
  holdout case:
  `gh2-prod-monster-ranged-disadvantage-trap-path`.
- Filled the remaining expansion from checked-in, game-scoped source data:
  items, monster stats, monster abilities, scenarios, character mats,
  character abilities, battle goals, and personal quests.
- Rejected ambiguous or unsupported-game candidates. No new case uses
  Gloomhaven 1e, Jaws of the Lion, Forgotten Circles, or a game-ambiguous
  external post as ground truth.
- Updated deterministic dataset tests to enforce the 150-case / 50-holdout
  project bar without API keys.

Verification:

- `npm test -- --run test/eval-dataset.test.ts` passed: 1 file, 30 tests.
- `npm run eval -- --seed --suite=table-qa` seeded LangSmith datasets:
  `squire/frosthaven/table-qa` with 74 items and
  `squire/gloomhaven-2e/table-qa` with 76 items.
- `npm run typecheck` passed.
- `npx eslint test/eval-dataset.test.ts` passed.
- `npx prettier --check eval/suites/gloomhaven-2e.json test/eval-dataset.test.ts docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- `npx markdownlint-cli2 docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- `npm run check` passed: 157 files, 1934 tests.

Eval spend: $0. LangSmith seeding updated datasets but did not run model or
judge calls.

Decision: keep. This does not tune runtime behavior; it makes the Phase 2
baseline large enough to be meaningful.

## 2026-07-04 — Table-qa judge calibration scaffold

Hypothesis: a checked-in reference set for the semantic answer judge will make
answer-quality comparisons defensible before the expanded baseline run.

Change:

- Added a 50-item `table-qa` dev-set judge calibration fixture:
  25 Frosthaven answer verdicts and 25 Gloomhaven 2e answer verdicts.
- Kept every reference item tied to an existing dev case and explicit supported
  game metadata.
- Added `npm run eval:judge-calibration`, which runs the existing Haiku
  semantic answer judge against the reference fixture and writes JSON/Markdown
  reports under `docs/plans/`.
- Added deterministic tests proving the fixture avoids holdout cases, rejects
  game mismatches, and computes the 85% agreement gate without API keys.

Verification:

- `npm test -- --run test/eval-judge-calibration.test.ts test/eval-cli.test.ts test/eval-scoring.test.ts`
  passed: 3 files, 51 tests.
- `npm run eval:judge-calibration -- --max-estimated-cost-usd=1`
  passed: 50/50 judge agreement (100.0%) against the dev-set reference
  fixture.
- `npm run eval -- --matrix --id=tool-free-assistant-game --run-label=sqr-379-judge-calibration-langsmith-tool-free-smoke --max-estimated-cost-usd=1 --local-report=/tmp/sqr-379-langsmith-tool-free-smoke.json`
  passed in LangSmith on one Frosthaven `table-qa` smoke case:
  score 1, groundedness pass, 1.913s complete latency, 1.899s first-answer
  token latency, trace
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d66b72cc-6746-4ad8-a363-8fa276ddf352/r/019f2ed1-18dc-7000-8000-039dad488ed8?poll=true>.
- Report:
  [sqr-379-table-qa-judge-calibration.md](sqr-379-table-qa-judge-calibration.md).

Eval spend: estimated $0.025 total for two calibration attempts, plus one
LangSmith smoke estimated at $0.0500 guardrail and $0.0005 provider cost. The
first calibration run found one bad reference answer in the calibration fixture;
after correcting that fixture item, the second run cost an estimated $0.0125 and
passed 50/50.

Decision: keep. The existing Haiku answer judge clears the 85% calibration bar
without a prompt change, so Phase 2 baseline runs can use the current judge
version.

## 2026-07-04 — Expanded production-config baseline

Hypothesis: running the full expanded matrix against the current production
runtime will show whether answer quality, groundedness, or latency is the first
constraint to remove.

Change:

- Ran the full 195-case matrix with LangSmith using the current
  `langgraph:anthropic:claude-sonnet-4-6` runtime and redesigned tools.
- Included both supported games: 93 Frosthaven rows and 102 Gloomhaven 2e rows.
- Included the full 150-case `table-qa` bar, 22 trajectory rows, 8 adversarial
  boundary rows, 5 campaign-personalization rows, 7 campaign-writes rows, and 3
  cross-game boundary rows.
- Recorded the row-level JSON report and a concise Markdown summary under
  `docs/plans/`.

Baseline result:

- Overall pass rate: 119/195 (61.0%).
- Table-qa pass rate: 82/150 (54.7%).
- Table-qa answer-score pass rate: 142/148 (95.9%).
- Table-qa groundedness pass rate: 87/148 (58.8%).
- Table-qa latency: 8001ms complete P50, 23698ms complete P95, 7780ms
  first-token P50, and 16797ms first-token P95.
- Frosthaven table-qa held up: 67/74 pass, including 22/25 holdout pass.
- Gloomhaven 2e table-qa did not: 15/76 pass, including 1/25 holdout pass.

Findings:

- The answer judge is not the immediate blocker. Gloomhaven 2e semantic answer
  scores are mostly passing, but deterministic groundedness fails because
  canonical refs are recorded as `gloomhavensecretariat:*`, which the scorer
  treats as wrong-game refs.
- Six table-qa rows missed the explicit 2500ms first-token / 5000ms complete
  latency budget.
- Two rows hit the LangGraph recursion limit:
  `fh-scenario-4a-heart-of-ice-a` and `gh2-character-mat-bladewarm`.
- Safety/source-boundary gaps remain visible in the adversarial and cross-game
  suites, but they are separate from the table-qa answer-quality blocker.

Verification:

- `npm run db:migrate` passed against the local Docker Postgres database.
- `npm run seed` completed local structured-data seed setup.
- `npm run index` indexed 1640 local rule-source chunks.
- `npm run eval -- --seed` seeded all 195 LangSmith examples.
- `npm run eval -- --matrix --run-label=sqr-380-expanded-baseline-production-config --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=20 --local-report=docs/plans/sqr-380-expanded-baseline-report.json`
  completed and wrote the baseline report.
- Report:
  [sqr-380-expanded-baseline-report.md](sqr-380-expanded-baseline-report.md).

Eval spend: estimated $1.2653 provider cost plus $9.7500 guardrail cost, for a
combined estimate of $11.0153. This is under the project cap of $100.

Decision: keep as the Phase 2 baseline. The next distinct issue should fix
Gloomhaven 2e canonical-ref game mapping before prompt or retrieval tuning, so
the groundedness scorer stops hiding otherwise-correct Gloomhaven 2e answers.

## 2026-07-04 — Gloomhaven 2e canonical-ref groundedness fix

Hypothesis: Gloomhaven 2e table-qa groundedness is failing because legacy
`gloomhavensecretariat:*` refs are collected without the active game, then the
scorer normalizes them as Frosthaven refs.

Change:

- Qualified legacy `gloomhavensecretariat:*` refs during tool-output trajectory
  collection when an active game is known.
- Applied the active-game qualification in both Anthropic agent loops, including
  the production LangGraph path.
- Left already game-qualified refs unchanged so explicit wrong-game refs still
  fail deterministic groundedness.
- Added focused tests for ref qualification, Gloomhaven 2e groundedness pass,
  wrong-game groundedness rejection, and LangGraph trajectory metadata.

Verification:

- `npm test -- --run test/agent.test.ts test/agent-langgraph.test.ts test/eval-scoring.test.ts`
  passed: 3 files, 93 tests.
- `npm run eval -- --matrix --id=gh2-battle-goal-accountant --run-label=sqr-381-gh2-groundedness-dev --max-estimated-cost-usd=1 --local-report=/tmp/sqr-381-gh2-groundedness-dev.json`
  passed in LangSmith: score 1, groundedness pass, trace
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7fe48da1-129f-4a2b-ba99-4cd94700f6bd/r/019f2f2f-959b-7000-8000-03dd0f946b12?poll=true>.
- `npm run eval -- --matrix --id=gh2-item-006-amulet-of-life --run-label=sqr-381-gh2-groundedness-holdout --max-estimated-cost-usd=1 --local-report=/tmp/sqr-381-gh2-groundedness-holdout.json`
  passed in LangSmith: score 1, groundedness pass, trace
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/35cec418-4963-4bc6-8c55-cff73946cdb0/r/019f2f30-4134-7000-8000-01da361d0e9b?poll=true>.

Eval spend: estimated $0.0061 provider cost plus $0.1000 guardrail cost across
the two targeted LangSmith runs.

Decision: keep. This removes the main SQR-380 Gloomhaven 2e groundedness
measurement bug without prompt tuning and without weakening explicit wrong-game
ref rejection.

## 2026-07-04 — Native LangSmith eval progress output

Problem: native LangSmith matrix runs printed the start banner, then stayed quiet
until each dataset/model/runtime `evaluate(...)` call returned. During full-table
runs this made it hard to tell whether the runner was progressing, waiting on
LangSmith, or stuck on one case.

Change:

- Added a progress callback to the native LangSmith eval adapter and invoked it
  after each completed matrix row.
- Wired the CLI runner to print the existing incremental progress line for the
  native path.
- Expanded the progress line with game, suite, category, groundedness,
  first-token latency, and retry count so long runs show useful state without
  dumping per-token or per-tool logs.
- Kept final table output, LangSmith experiment links, and local report formats
  unchanged.

Verification:

- `npm test -- --run test/eval-runner.test.ts test/eval-langsmith-eval.test.ts`
  passed: 2 files, 6 tests.
- `npm run eval -- --matrix --id=gh2-battle-goal-accountant --run-label=sqr-382-progress-smoke --max-estimated-cost-usd=1 --local-report=/tmp/sqr-382-progress-smoke.json`
  printed `[1/1] pass ...` before the final table and passed in LangSmith:
  score 1, groundedness pass, trace
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3aaf31c6-8a78-4f71-9bac-108fbdb44358/r/019f2f43-25e6-7000-8000-020c11c1e852?poll=true>.
- `npm run check` passed: 158 files, 1942 tests.

Eval spend: estimated $0.0026 provider cost plus $0.0500 guardrail cost for the
one-case progress smoke.

Decision: keep. This does not change scoring or answer behavior, but it makes
long eval runs observable enough to manage during the Table Turnaround work.

## 2026-07-04 — Post-groundedness expanded baseline rerun

Hypothesis: after qualifying Gloomhaven 2e canonical refs, the expanded baseline
should show whether the project is still blocked by answer quality,
groundedness, or latency.

Run:

- `npm run eval -- --matrix --run-label=sqr-383-post-groundedness-expanded-baseline --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=20 --local-report=docs/plans/sqr-383-post-groundedness-expanded-baseline-report.json`
- Runtime/model: `langgraph:anthropic:claude-sonnet-4-6`.
- Scope: 195 rows, including 150 table-qa rows split 100 dev / 50 holdout.

Result:

- Overall pass rate improved from 119/195 (61.0%) to 172/195 (88.2%).
- Table-qa pass rate improved from 82/150 (54.7%) to 135/150 (90.0%).
- Gloomhaven 2e table-qa pass rate improved from 15/76 (19.7%) to 67/76
  (88.2%).
- Gloomhaven 2e table-qa groundedness improved from 15/75 (20.0%) to 74/75
  (98.7%).
- Table-qa answer-score pass rate stayed high: 143/149 (96.0%).
- Table-qa latency remains above the bar: 7096ms first-token P50, 15120ms
  first-token P95, 7169ms complete P50, and 22403ms complete P95.

Remaining table-qa failures:

- Five answer-quality rows.
- Five primary latency-budget rows, plus one tool-classified row that also
  missed its latency budget.
- Two groundedness rows: one Frosthaven scenario with no refs and one
  Gloomhaven 2e section-book row with a bare `67.1` ref.
- One provider error and one safety row.

Verification:

- Local Docker Postgres was healthy before the run.
- `npm run db:migrate` passed.
- `npm run seed` passed.
- `npm run index` found the expected Frosthaven and Gloomhaven 2e sources and
  had nothing new to index.
- `npm run eval -- --seed` seeded all 195 LangSmith examples.
- The full matrix completed and wrote row-level JSON, TSV, and Markdown reports
  under `docs/plans/`.
- Summary:
  [sqr-383-post-groundedness-expanded-baseline-summary.md](sqr-383-post-groundedness-expanded-baseline-summary.md).

Eval spend: estimated $1.2668 provider cost plus $9.7500 guardrail cost, for a
combined estimate of $11.0168. This is under the project cap of $100.

Decision: keep as the post-groundedness baseline. The broad Gloomhaven 2e
wrong-game ref problem is fixed. The next distinct issue should reduce table QA
latency for exact structured lookups and rule lookups; the median table path is
still around 7 seconds before the first answer token.

## 2026-07-04 — Exact structured lookup fast path

Hypothesis: the exact structured lookup rows are slow because the LangGraph path
waits for a planner model call, runs a direct evidence tool, then waits for a
second no-tools synthesis model call before emitting any answer text. For opened
item, building, scenario, and monster-stat rows, the checked-in structured data
already contains the fields needed for a grounded answer.

Change:

- Added a deterministic direct-answer draft in the LangGraph `final_answer`
  path for successful `lookup_entity` / `open_entity` results that open one
  item, building, scenario, or monster-stat record.
- Kept answer emission inside the `final_answer` node, so earlier graph nodes
  still emit only work-log/tool/debug events.
- Enriched exact monster-stat lookup execution from the original question when
  the planner sends a generic `kinds: ["monster"]` lookup without the level or
  rank details already present in the user question.
- Left broad rule search, multi-source synthesis, and safety/groundedness
  scoring unchanged.

Result:

- Target latency-budget pass rate moved from 0/6 to 5/6.
- All six targeted rows kept semantic score 1 and groundedness pass.
- `gh2-monster-living-bones-elite-level-1` improved from two tools / two loops
  / final synthesis to one tool / one loop / deterministic answer. It improved
  from 7305ms first-token / 7307ms complete to 2693ms first-token / 2694ms
  complete, but still missed the 2500ms first-token budget by 193ms in the
  judged run.

Verification:

- `npm test -- --run test/agent-langgraph.test.ts` passed: 1 file, 15 tests.
- After tightening missing-metadata fallback coverage:
  `npm test -- --run test/agent-langgraph.test.ts` passed: 1 file, 16 tests.
- `npm test -- --run test/tools.test.ts` passed: 1 file, 90 tests.
- `npm run check` passed: 158 files, 1947 tests.
- Targeted LangSmith rows covered all six SQR-384 cases. Combined estimated
  spend: $0.0090 provider cost plus $0.3000 guardrail cost.
- Summary:
  [sqr-384-exact-lookup-fast-path-summary.md](sqr-384-exact-lookup-fast-path-summary.md).

Decision: keep. This removes the avoidable final synthesis wait for exact
structured lookups while preserving deterministic source grounding. The
remaining Living Bones miss is now provider planning latency before the tool
result exists, not local tool execution or final answer synthesis.

## 2026-07-05 — Final verification attempt after exact lookup fast path

Hypothesis: after the SQR-384 exact structured lookup fast path, two consecutive
full runs will show whether the Table Turnaround project can be closed as
successful or must continue with another focused issue.

Run:

- `node eval/run.ts --matrix --run-label=sqr-385-final-full-run-1 --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=100 --local-report=docs/plans/sqr-385-final-full-run-1.json`
- `node eval/run.ts --matrix --run-label=sqr-385-final-full-run-2 --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=100 --local-report=docs/plans/sqr-385-final-full-run-2.json`
- Scope: 195 rows per run, including 150 table-qa rows split 100 dev / 50
  holdout, plus trajectory and guardrail suites.

Result:

- Both runs finished 178/195 overall.
- Table QA improved from the SQR-383 post-groundedness baseline:
  135/150 -> 138/150 and 139/150.
- Holdout correctness improved but missed target:
  42/50 -> 44/50 and 46/50, below the 95% bar.
- Table QA P50 improved materially:
  first-token 7096ms -> 3601ms and 3482ms; complete 7169ms -> 3603ms and
  3483ms.
- Table QA P95 still missed badly:
  complete 22159ms and 22519ms, above the 10000ms target.
- Groundedness passed the project bar in both runs: 148/148 and 147/148 measured
  table-qa rows.
- Safety did not pass: 20/23 and 18/23 across the guardrail suites.

Repeated blockers:

- Source-boundary failure: `adv-citation-source-boundary`.
- Cross-game contamination: `boundary-scenario-61-fh-then-gh2`.
- Safety-class table row: `drifter-ignore-negative-item-effects-correction`.
- Latency-budget holdout miss: `scenario-7-edge-world-unlocks`.
- Repeated scenario recursion/provider failures:
  `fh-scenario-4a-heart-of-ice-a` and `fh-scenario-4b-heart-of-ice-b`.
- Repeated answer-quality or retrieval misses:
  `fh-character-mat-boneshaper`, `gh2-scenario-9-ruinous-rift`,
  `gh2-character-mat-bladewarm`,
  `gh2-character-ability-doomstalker-rain-of-arrows`, and
  `gh2-traj-card-fuzzy-vs-exact`.

Verification:

- Both full matrix runs completed with LangSmith enabled.
- `node eval/run.ts --compare-runs=docs/plans/sqr-385-final-full-run-1.json,docs/plans/sqr-385-final-full-run-2.json`
  reported no obvious single regression driver.
- Report:
  [sqr-385-final-verification-report.md](sqr-385-final-verification-report.md).

Eval spend: run 1 combined estimate $10.8588; run 2 combined estimate $10.8306;
SQR-385 combined estimate $21.6894, under the user-approved $100 cap.

Decision: do not close the project. SQR-384 produced real latency progress, so
this is not a no-forward-progress stop. The next distinct issue should fix the
non-negotiable guardrail failures before more latency tuning.

## 2026-07-05 — SQR-386 guardrail repair before more latency tuning

Hypothesis: the SQR-385 guardrail failures were mostly deterministic contract
drift, not a broad retrieval regression. Fixing those rows first should restore
the non-negotiable guardrails while preserving table-qa groundedness at or above
98%.

Changes:

- Tightened source-boundary answer instructions so rejected game names and
  hostile source-mixing phrases are not repeated.
- Relaxed brittle deterministic eval checks only where the agent path was
  already safe: `lookup_entity` is accepted as the direct-open path for
  scenario 61 when required refs are present, and the Drifter denial regex no
  longer matches the correct word `ignores`.
- Added campaign-context and agent instructions for cross-member private fields:
  say those fields are inaccessible, not empty or unrecorded.
- Reset the campaign-write eval fixture before each writes case: pending
  proposals, idempotency keys, played/drawn/skipped scenarios, prosperity,
  active scenario, and the writer character baseline.
- Made direct scenario dry-run answers explicitly say no campaign state was
  saved or staged, and that recording the scenario would add it to the played
  list and unlock any derived scenarios.

Verification:

- Targeted SQR-386 rows passed 5/5.
- Guardrail suites passed 23/23:
  adversarial boundary 8/8, cross-game boundary 3/3, campaign personalization
  5/5, campaign writes 7/7.
- Table QA groundedness passed at 147/150, exactly 98.0%. The three misses were
  `fh-scenario-4b-heart-of-ice-b`, `fh-scenario-4a-heart-of-ice-a`, and
  `gh2-section-67-1`.
- `npm run check` passed: 158 test files, 1953 tests.
- Summary:
  [sqr-386-guardrail-fix-summary.md](sqr-386-guardrail-fix-summary.md).

Decision: keep. The non-negotiable guardrails are back to green. The remaining
table-qa failures are real but outside this guardrail repair slice and do not
miss the groundedness bar.

## 2026-07-05 — Final verification after guardrail repair

Hypothesis: after SQR-386 restored targeted guardrails, two consecutive full
LangSmith-backed matrix runs would show whether the Table Turnaround project can
close or whether the next focused issue is still required.

Run:

- `node eval/run.ts --matrix --run-label=sqr-387-final-full-run-1 --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=100 --local-report=docs/plans/sqr-387-final-full-run-1.json`
- `node eval/run.ts --matrix --run-label=sqr-387-final-full-run-2 --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=100 --local-report=docs/plans/sqr-387-final-full-run-2.json`
- Scope: 195 rows per run, including 150 table-qa rows split 100 dev / 50
  holdout, plus trajectory and guardrail suites.

Result:

- Run 1 finished 181/195 overall. Run 2 finished 182/195 overall.
- Table QA finished 142/150 and 141/150.
- Holdout correctness missed target: 47/50 and 44/50, below the 95% bar.
- Table QA groundedness passed at 148/148 in both runs.
- Safety still missed: 20/23 and 21/23 across the guardrail suites.
- Table QA complete-answer P50 passed target at 2986ms and 4029ms, but
  first-token P50 and complete-answer P95 still missed.
- Explicit latency budgets passed 6/6 in run 1, then 4/6 in run 2.

Repeated blockers:

- Frosthaven scenario recursion/provider error:
  `fh-scenario-4a-heart-of-ice-a`.
- Frosthaven scenario answer quality: `fh-scenario-4b-heart-of-ice-b`.
- Frosthaven character mat answer quality: `fh-character-mat-boneshaper`.
- Cross-game contamination: `boundary-scenario-61-fh-then-gh2`.
- Gloomhaven 2e character mat recursion/provider error:
  `gh2-character-mat-bladewarm`.
- Gloomhaven 2e character ability answer quality:
  `gh2-character-ability-doomstalker-rain-of-arrows`.
- Gloomhaven 2e scenario answer quality: `gh2-scenario-9-ruinous-rift`.
- Gloomhaven 2e fuzzy card trajectory retrieval:
  `gh2-traj-card-fuzzy-vs-exact`.

Verification:

- Local DB migration, seed, index, and LangSmith seed commands passed before the
  full runs.
- Both full matrix runs completed with LangSmith enabled.
- `node eval/run.ts --compare-runs=docs/plans/sqr-387-final-full-run-1.json,docs/plans/sqr-387-final-full-run-2.json`
  reported a 0.5 percentage point pass-rate improvement in run 2, with no
  retry or timeout delta and no single regression driver.
- Report:
  [sqr-387-final-verification-report.md](sqr-387-final-verification-report.md).

Eval spend: run 1 combined estimate $10.7770; run 2 combined estimate $10.7786;
SQR-387 combined estimate $21.5556, under the user-approved $100 cap.

Decision: do not close the project. SQR-386 fixed the targeted guardrail slice,
but the full project bar still fails on repeated answer-quality, cross-game
isolation, trajectory retrieval, provider recursion, and latency-tail issues.
Created follow-up issues SQR-388, SQR-389, SQR-390, and SQR-391 for the next
distinct repair slices.

## 2026-07-05 — SQR-388 cross-game boundary scorer repair

Hypothesis: the repeated `boundary-scenario-61-fh-then-gh2` failures in SQR-387
were not live cross-game contamination. The failed answers correctly identified
Frosthaven scenario 61 as _Life and Death_, Gloomhaven 2e scenario 61 as
_Dangerous Grove_, and stated that the records are separate; the deterministic
cross-game scorer rejected the abbreviation `Gloomhaven (2nd Ed.)`.

Changes:

- Added a regression test for cross-game boundary answers that use
  `Gloomhaven (2nd Ed.)` while still naming Frosthaven and stating that the
  scenarios are separate.
- Extended the deterministic GH2e mention recognizer to accept `2nd Ed.` and
  `second Ed.` variants without changing required game separation or required
  trajectory refs.

Verification:

- `npx vitest run test/eval-scoring.test.ts --testNamePattern "abbreviated Gloomhaven 2e naming"`
  failed before the scorer change with `missing game mention(s): gloomhaven-2e`.
- `npx vitest run test/eval-scoring.test.ts --testNamePattern "abbreviated Gloomhaven 2e naming"`
  passed after the scorer change.
- `npx vitest run test/eval-scoring.test.ts` passed: 17 tests.
- Target row passed twice consecutively:
  - [sqr-388-boundary-scenario-61-run-1.md](sqr-388-boundary-scenario-61-run-1.md):
    pass, score 1, 8952ms complete, 8948ms first token, 2 tools, 1 loop.
  - [sqr-388-boundary-scenario-61-run-2.md](sqr-388-boundary-scenario-61-run-2.md):
    pass, score 1, 10418ms complete, 10416ms first token, 2 tools, 1 loop.
- Full `cross-game-boundary` suite passed 3/3:
  [sqr-388-cross-game-boundary-suite.md](sqr-388-cross-game-boundary-suite.md).

Decision: keep. This fixes the false cross-game contamination classification
without weakening wrong-game rejection. The live answers still must identify
both game-qualified records and state that they are separate.
