# SQR-234 PDF Extraction Vendor Decision Report

## Decision

Use Marker/Datalab as the next Gloomhaven (2nd Edition) rulebook extraction
provider, implemented through SQR-235. Apple Vision remains the checked-in
baseline until SQR-235 lands the production refresh path, runs the full
rulebook, and reindexes the normalized snapshot.

This is a replacement recommendation, not a production cutover by itself.
SQR-235 should make the refresh path repeatable, run the full Gloomhaven
(2nd Edition) rulebook with the same guardrails, and update the indexed
rulebook source only after the full-run artifact validates.

## Evidence Scope

Selected-page eval set:

```text
2,30,31,32,33,41,42,57,72
```

The selected pages cover table-of-contents behavior, loot rules, two-column
combat rules, campaign pages, dense index/reference content, and the page 30
sidebar boundary that previously produced misleading retrieval context.

No full-rulebook provider run was approved or performed for this report. The
full-rulebook decision input is a documented cost ceiling for the 74-page
Gloomhaven (2nd Edition) PDF.

## Selected-Page Results

All rows used the shared `eval/pdf-extraction` harness and the
production-identical retrieval scoring path: Voyage embeddings
`voyage-4-large:dim1024:prod-v1` plus Cohere reranking. The retrieval columns
are hit counts out of 8 ground-truth queries.

| Provider       | Run label                               | Required phrase recall | Reading order | Noise ratio | Top 1 | Top 3 | Top 5 | Citable context | Selected cost | Latency |
| -------------- | --------------------------------------- | ---------------------: | ------------: | ----------: | ----: | ----: | ----: | --------------: | ------------: | ------: |
| Apple Vision   | `apple-vision-baseline`                 |                  0.901 |          1.00 |       0.262 |     7 |     7 |     7 |               0 |        $0.000 |   41.0s |
| AWS Textract   | `sqr-234-aws-textract-selected-pages`   |                  0.901 |          0.00 |       0.314 |     7 |     7 |     8 |               0 |        $0.135 |   20.4s |
| LlamaParse     | `sqr-234-llamaparse-selected-pages`     |                  0.901 |          1.00 |       0.158 |     6 |     8 |     8 |               2 |        $0.450 |   61.8s |
| Unstructured   | `sqr-234-unstructured-selected-pages`   |                  0.926 |          0.50 |       0.080 |     6 |     8 |     8 |               2 |        $0.270 |   76.4s |
| Marker/Datalab | `sqr-234-marker-datalab-selected-pages` |                  0.901 |          1.00 |       0.150 |     7 |     8 |     8 |               2 |        $0.060 |   49.4s |

The scorer's `averageCharacterErrorRate` was `1.0` for every provider in this
run, so it was not useful for provider ranking. The decision uses required
phrase recall, structure scores, retrieval outcomes, cost, and the recorded
failure classes instead.

## Provider Assessment

### Apple Vision

Apple Vision remains valuable as the zero-cost local baseline. It has good
top 1 retrieval on the selected pages, but it returned no citable-context
hits and still carried the known misleading-context failure on the page 30
loot cases. Its noise ratio was also materially worse than the managed parser
candidates.

Keep it only as the fallback until SQR-235 lands the Datalab refresh path.

### AWS Textract

Textract was fast and operationally clean, but the output is OCR/layout
primitive oriented rather than rulebook-ready Markdown. It had the worst
reading-order score, the highest noise ratio, heading hierarchy mismatches,
and no citable-context hits. It is not the right primary provider for this
rulebook refresh path.

### LlamaParse

LlamaParse produced useful Markdown and matched Datalab on top 3, top 5, and
citable-context counts. It is weaker than Datalab for this project because it
had lower top 1 retrieval, higher selected-page cost, slower selected-page
latency, and an `unknown` training-use posture in the artifact.

Keep it as the nearest backup if Datalab full-rulebook execution fails in
SQR-235.

### Unstructured

Unstructured had the best phrase recall and lowest noise ratio in the selected
run, but it underperformed Datalab on top 1 retrieval and reading order. The
selected run also recorded heading hierarchy mismatches for the page 30 cases
and an `unknown` training-use posture.

It is a credible secondary candidate, but not the first production path.

### Marker/Datalab

Marker/Datalab is the selected provider. It tied Apple Vision on top 1 retrieval,
beat Apple Vision on top 3, top 5, citable-context hits, and noise ratio, and
kept a clean reading-order score. It also had the lowest managed-provider cost
and the artifact records `trainingUse: not-used-for-training`.

The remaining retrieval failure class is still `misleading_context` on some
queries. That is not unique to Datalab; it appears across all providers on the
same page 30 boundaries. Datalab is still the best candidate because it turns
the two numbered-treasure queries into citable context while preserving the
same or better retrieval envelope.

## Cost Ceiling

The Gloomhaven (2nd Edition) PDF has 74 pages.

| Provider       | Configured cost per page | Selected-page actual | Full-rulebook estimate |   Conservative ceiling |
| -------------- | -----------------------: | -------------------: | ---------------------: | ---------------------: |
| Apple Vision   |                   $0.000 |               $0.000 |                 $0.000 | local Mac runtime only |
| AWS Textract   |                   $0.015 |               $0.135 |                 $1.110 |                  $1.25 |
| LlamaParse     |                   $0.050 |               $0.450 |                 $3.700 |                  $4.00 |
| Unstructured   |                   $0.030 |               $0.270 |                 $2.220 |                  $2.50 |
| Marker/Datalab |                   $0.006 |               $0.060 |                 $0.444 |                  $0.74 |

The Datalab ceiling uses the selected run's observed cent-denominated billing
as the conservative bound: 74 pages at up to $0.01 per page. SQR-235 should run
the full rulebook with:

```bash
npm run pdf-extraction:run -- \
  --provider=marker-datalab \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=all \
  --output-dir=eval/results/pdf-extraction \
  --run-label=marker-datalab-full-rulebook \
  --allow-full-rulebook \
  --max-estimated-cost-usd=0.50 \
  --timeout-ms=1800000
```

If provider-side billing reports more than the configured estimate but remains
at or below $0.74, the run is still within this report's documented ceiling.

## Privacy And Operations

Marker/Datalab operational requirements:

- Secret: `DATALAB_API_KEY`.
- Optional config: `DATALAB_BASE_URL`, `DATALAB_MODE`, `DATALAB_REGION`,
  `DATALAB_SKIP_CACHE`, `DATALAB_COST_PER_PAGE_USD`.
- Default mode: `accurate`.
- Region recorded in artifacts: `us`.
- Training use recorded in artifacts: `not-used-for-training`.
- Retention posture recorded in artifacts: Datalab managed conversion stores
  hosted results temporarily; raw outputs are persisted only in the configured
  eval output directory.
- Artifact reuse: cached by provider, source hash, provider config hash, and
  page set. Pass `--refresh-provider-output` when forcing a fresh provider run.
- Refresh guardrails: selected pages are default; full-rulebook runs require
  `--allow-full-rulebook`; cost overruns require an explicit override.

Production refresh procedure for SQR-235:

1. Run the full Marker/Datalab extraction with the cost ceiling above.
2. Validate the normalized artifact schema and report output.
3. Review page 30 and the table-of-contents page manually before replacing the
   Apple Vision snapshot.
4. Write the approved Markdown snapshot to `data/rule-sources/gh2-rule-book.md`
   or the agreed normalized-source path.
5. Update `data/rule-sources/metadata.json` if the normalized snapshot path or
   refresh notes change.
6. Run `npm run index` with `SQUIRE_INDEX_GAME=gloomhaven-2e`.
7. Run `npm run production-data:smoke -- --game gh2` after production indexing.

## Follow-Up Issues

No extra follow-up issue is needed from SQR-234. SQR-235 already covers the
production implementation and refresh path for the selected provider.

If the full-rulebook Datalab run fails validation in SQR-235, use LlamaParse as
the first backup candidate before expanding to new vendors.

## Evidence Paths

Selected-page reports:

- `eval/results/pdf-extraction/reports/apple-vision/.../pages-2-30-31-32-33-41-42-57-72.json`
- `eval/results/pdf-extraction/reports/aws-textract/.../pages-2-30-31-32-33-41-42-57-72.json`
- `eval/results/pdf-extraction/reports/llamaparse/.../pages-2-30-31-32-33-41-42-57-72.json`
- `eval/results/pdf-extraction/reports/unstructured/.../pages-2-30-31-32-33-41-42-57-72.json`
- `eval/results/pdf-extraction/reports/marker-datalab/.../pages-2-30-31-32-33-41-42-57-72.json`

Commands run for the managed provider comparison:

```bash
AWS_REGION=us-east-1 AWS_TEXTRACT_S3_BUCKET=maz-squire-dev \
  node --env-file=.env eval/pdf-extraction/run.ts \
  --provider=aws-textract \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=sqr-234-aws-textract-selected-pages \
  --max-estimated-cost-usd=0.25 \
  --timeout-ms=900000

node --env-file=.env eval/pdf-extraction/run.ts \
  --provider=llamaparse \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=sqr-234-llamaparse-selected-pages \
  --max-estimated-cost-usd=0.50 \
  --timeout-ms=900000

node --env-file=.env eval/pdf-extraction/run.ts \
  --provider=unstructured \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=sqr-234-unstructured-selected-pages \
  --max-estimated-cost-usd=0.30 \
  --timeout-ms=900000

node --env-file=.env eval/pdf-extraction/run.ts \
  --provider=marker-datalab \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=sqr-234-marker-datalab-selected-pages \
  --max-estimated-cost-usd=0.10 \
  --timeout-ms=900000
```
