---
name: eval-compare
description: Pull and compare Squire eval experiment runs from Langfuse side-by-side. Use when asked to compare evals, show experiment history, diff two runs, check if a change moved RAG scores, or review how the latest eval run stacks up against previous ones on the frosthaven-qa dataset.
argument-hint: [--filter <substring>]
allowed-tools: Bash
---

# eval-compare

Render a side-by-side comparison of Squire eval runs on the `frosthaven-qa`
Langfuse dataset. Squire's eval harness (`eval/run.ts`) publishes runs with
`correctness` (1–5 LLM-as-judge) and `pass` (categorical) scores per trace.
This skill pulls them via the Langfuse CLI, joins traces to scores, and shows
them next to each other so you can see whether a change actually moved the
needle.

## When to invoke

- "how does this eval compare to previous runs"
- "show me the last N eval runs"
- "did SQR-XX improve the eval scores"
- "compare experiment A vs experiment B"
- "what's the eval history for frosthaven-qa"

## Prerequisites

This skill delegates all Langfuse API access to the official `langfuse` skill
(installed at `~/.claude/skills/langfuse/`). Load it if you haven't already —
its `SKILL.md` covers the CLI basics, `references/cli.md` has common patterns.

The project's `.env` has `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY` — load them before calling the CLI:

```bash
set -a; source .env; set +a
export LANGFUSE_HOST="$LANGFUSE_BASE_URL"
```

The CLI expects `LANGFUSE_HOST` (not `LANGFUSE_BASE_URL`), so the re-export is
required.

## Workflow

### 1. List the runs

```bash
npx --yes langfuse-cli api datasets get-get-runs frosthaven-qa --limit 50 --json
```

Parse the JSON response. The structure is `{ok, status, body: {data: [...], meta}}`.
Each run has `id`, `name`, `createdAt`. Sort oldest → newest. Apply the
user's `--filter` if they passed one (substring match on `name`).

### 2. Get per-run trace IDs + item labels

For each run, fetch its detail:

```bash
npx --yes langfuse-cli api datasets get-get-run frosthaven-qa '<run-name>' --json
```

The `body.datasetRunItems` array has `{traceId, datasetItemId, datasetRunId}`
per item. Also fetch dataset items once for human labels:

```bash
npx --yes langfuse-cli api dataset-items list --dataset-name frosthaven-qa --limit 100 --json
```

Each item has `metadata.id` (e.g. `rule-poison`, `monster-vermling-scout`) —
use that as the row label. Fall back to `id[:8]` for older items that predate
the `metadata.id` convention in `eval/run.ts`.

### 3. Fetch correctness scores in bulk

Bulk-fetch all `correctness` scores in one paginated call rather than
per-trace (per-trace hits the 429 rate limit immediately):

```bash
npx --yes langfuse-cli api scores list --name correctness --limit 100 --page 1 --json
```

Page through `body.meta.totalPages`. Note: scores do **not** currently set
`datasetRunId`, so `--dataset-run-id` returns empty — you must join by
`traceId` in memory.

### 4. Normalise scores

Langfuse stores `correctness` as a 0..1 float. The eval harness grades on
1..5. Convert each score:

```text
score_1_to_5 = round(value * 4 + 1)   # 0 → 1, 0.25 → 2, 0.5 → 3, 0.75 → 4, 1.0 → 5
```

### 5. Render the comparison table

Build a matrix: `item_label × run_name → score`. Columns left-to-right oldest
→ newest. Rows sorted: named items alphabetically first, then hex-ID
fallbacks. Show `-` for missing cells (run predates the item).

Append two aggregate rows:

- `avg (correctness)` — mean across all items in the run
- `pass (>=4)` — pass rate (items scoring ≥ 4)

### 6. Interpret the output

Don't just dump the table. Walk the user through it:

1. **Lead with the headline.** Compare the newest run's avg + pass rate
   against the most recent prior run that shares the same item labels.
   Ancient runs with different item IDs (hex-only columns) are
   apples-to-oranges — mention them but don't use them for the headline.

2. **Call out items that actually moved** (delta ≥ 1 point). Group as
   improvements vs regressions.

3. **Separate real movement from LLM-as-judge noise.** The eval is N=15 with
   a Claude-based judge. A single 1-point swing on an untouched code path is
   almost always non-determinism, not a regression. Ask: did the PR touch
   the code path for this item?

4. **Name the causal code paths.** Squire's eval items split into two lanes:
   - **Rule cases** (`rule-*`) → `searchRules` → pgvector (`src/vector-store.ts`)
   - **Card cases** (`monster-*`, `item-*`, `building-*`, `scenario-*`) →
     `searchCards` / `listCards` / `getCard` → `extracted-data.ts`

   If a PR only touches vector-store, card regressions are noise. If a PR
   touches card-data, rule regressions are noise.

5. **Recommend next steps.** If the signal is noisy, suggest re-running. If
   there's a real regression on a touched path, flag it.

## Troubleshooting

**Columns showing 0/0 with no scores.** The eval harness flushes scores to
Langfuse on process exit. If a run was killed before the flush (e.g., the
process was torn down quickly or the user ran multiple evals back-to-back
without waiting), the run's dataset items exist in Langfuse but the
correctness scores never made it. This shows up as `0/0` in the aggregate
row. Not a bug in this skill — the scores genuinely aren't in Langfuse. The
run has to be re-executed to populate them.

**Score count is lower than expected.** Expected count = N runs × 15 items
for the `frosthaven-qa` dataset. If `body.meta.totalItems` on
`scores list --name correctness` is lower, some runs are missing scores
(see above). The `totalItems` value is authoritative; don't paginate
chasing scores that aren't there.

## Duplicate run-name handling

If two runs share the same short name (everything before `- <timestamp>`),
suffix the second and later occurrences with `#2`, `#3`, … so columns stay
distinct. Squire's harness includes a timestamp suffix on every run name by
default, so this only matters if the user manually reused a name.

## Why this skill is thin

The previous iteration of this skill shipped a 300-line TypeScript wrapper
that reimplemented auth, pagination, retries, and Retry-After handling. The
official Langfuse CLI (`npx langfuse-cli`) already does all of that. The
project-specific value is:

1. Knowing which Langfuse calls to chain for the frosthaven-qa dataset
2. The 0..1 → 1..5 score normalisation
3. Rule-lane vs card-lane interpretation of results
4. The noise-floor caveat at N=15

All of which lives in this SKILL.md as instructions, not code. If Langfuse
changes their API shape, the CLI team fixes it upstream — no patch needed
here.

## Related

- `~/.claude/skills/langfuse/SKILL.md` — official Langfuse skill covering
  the CLI + documentation lookup (installed via `skills add langfuse/skills`)
- `eval/run.ts` — the harness that produces the runs this skill reads
- `eval/dataset.json` — dataset definition; item labels come from
  `metadata.id` on each dataset item
- `npm run eval -- --name="<experiment>"` — kick off a new run that this
  skill can then include in the comparison
- `docs/ARCHITECTURE.md` §Observability — how Squire wires OpenTelemetry +
  Langfuse trace export
