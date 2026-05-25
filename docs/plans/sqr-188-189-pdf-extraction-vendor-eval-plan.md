# GH2 PDF Extraction Vendor Evaluation Plan

## Context

SQR-188 and SQR-189 add the official Gloomhaven (2nd Edition) rulebook, FAQ, and errata
as first-class rule sources. The official GH2 rulebook PDF is image-based for
our current parser: `pdf-parse` sees 74 pages but extracts no non-whitespace
text. The current branch therefore uses a checked-in Apple Vision OCR Markdown
snapshot as the baseline indexed source while keeping the official PDF as the
source of record.

That baseline is acceptable for source acquisition, metadata, and end-to-end
indexing, but it is not the final quality target. Apple Vision has visible
reading-order and layout issues on two-column pages, table-of-contents pages,
headers, page numbers, and dense rule sections.

## Goal

Choose a repeatable PDF extraction provider for official rulebooks that gives
Squire better retrieval quality than the Apple Vision baseline at a cost that
is acceptable for occasional rule-source refreshes.

The decision must be evidence-based. We should not replace the baseline until
the vendor output is scored against ground truth and end-to-end retrieval.

## Candidate Providers

Evaluate these first:

| Provider                         | Mode               | Why evaluate                                                                   | Main risk                                             |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Apple Vision                     | Local baseline     | Already works locally on the GH2 rulebook and costs nothing per run            | macOS-only, weak reading order on complex pages       |
| AWS Textract                     | Managed OCR/layout | Stable managed OCR for PDFs/images, words, lines, tables, async multipage jobs | Produces OCR primitives, not clean rulebook Markdown  |
| LlamaParse                       | Managed parser     | Built for LLM-ready Markdown/JSON, scans, tables, charts, layout-aware parsing | Less deterministic; cost and lock-in need measurement |
| Unstructured                     | Managed parser     | RAG-oriented JSON, high-res partitioning, bounding boxes, VLM OCR refinement   | Pipeline complexity and enrichment page cost          |
| Datalab Marker / Datalab managed | Local or managed   | Strong Markdown/JSON output, force OCR, optional LLM correction                | Self-host licensing/runtime complexity                |

Secondary candidates if the first pass is inconclusive:

- Google Document AI layout parser / Enterprise Document OCR
- Azure Document Intelligence Read/Layout
- Mistral Document AI OCR
- Docling local parser

## Ground Truth Dataset

Create a vendor-neutral dataset under `eval/pdf-extraction/ground-truth/`.

Use JSONL records shaped like:

```json
{
  "id": "gh2-rulebook-page-30-loot",
  "source": "data/pdfs/gh2-rule-book.pdf",
  "page": 30,
  "region": null,
  "category": "rules-text",
  "expectedHeadings": ["Loot"],
  "expectedText": "Loot X is an ability that allows a figure to loot all loot tokens...",
  "expectedTables": [],
  "retrievalQueries": ["How does Loot X work?", "Can monsters loot treasure tiles?"]
}
```

Initial sample set:

- Table of contents pages to measure ordering and noise.
- Core rules pages for line-of-sight, movement, attack, advantage/disadvantage,
  suffer damage, conditions, heal, loot, end-of-turn looting, and elements.
- Monster AI pages for focus, movement, attacks, named monsters, bosses, and
  death/kill credit.
- Campaign pages for character sheet, campaign sheet, item supplies, city
  phase, reputation, and prosperity.
- Rulebook tables and reference/index pages.
- Pages with icons, callouts, diagrams, or dense two-column layout.

The first dataset should cover 25-40 page/region records. It should be small
enough to review by hand and broad enough to catch the Apple Vision failures.

## Adapter Contract

Each provider adapter should produce one normalized JSON artifact:

```json
{
  "provider": "aws-textract",
  "providerVersion": "2026-05",
  "source": "data/pdfs/gh2-rule-book.pdf",
  "startedAt": "2026-05-24T00:00:00Z",
  "completedAt": "2026-05-24T00:00:00Z",
  "latencyMs": 0,
  "costUsd": 0,
  "pages": [
    {
      "page": 30,
      "markdown": "...",
      "text": "...",
      "blocks": [],
      "tables": []
    }
  ]
}
```

Provider-specific raw output should be stored separately for debugging, but
scoring must run only against the normalized artifact.

## Quality Metrics

Score at three layers:

1. Text fidelity
   - Character error rate against `expectedText`.
   - Word error rate against `expectedText`.
   - Required phrase recall for important rules terms.

2. Structure
   - Heading precision/recall.
   - Reading-order score for two-column pages.
   - Table cell precision/recall where tables exist.
   - Noise ratio: page numbers, repeated headers, broken hyphenation, and
     unrelated sidebars inserted into a rule block.

3. Retrieval usefulness
   - Index each provider output into a temporary embeddings table or fixture.
   - Run `retrievalQueries` from the ground truth records.
   - Score whether the expected page/region appears in top 1, top 3, and top 5.
   - Record whether the returned chunk is citeable without misleading context.

## Cost Metrics

Track cost separately from quality:

- One-time cost to process the full GH2 rulebook.
- Cost per page.
- Cost per successful ground-truth record.
- Cost per top-3 retrieval hit.
- Latency for full-book processing.
- Setup and operational cost: credentials, queues, storage, callbacks, and
  manual steps.
- Data handling: retention policy, region controls, and whether source PDFs are
  used for model training.

Because rulebook refreshes are infrequent, quality should dominate raw price,
but the chosen provider should still have a documented cost ceiling for a full
rulebook refresh.

## Decision Rule

Apple Vision remains the baseline until a provider beats it on:

- Lower text error on the ground-truth records.
- Better reading order on two-column rules pages.
- Better or equal retrieval top-3 hit rate.
- No unacceptable privacy or retention behavior.
- A documented full-rulebook processing cost.

If no provider beats Apple Vision decisively, keep Apple Vision as the baseline
and create targeted cleanup rules for its known failure modes.

## Implementation Milestones

1. Add ground-truth dataset and scorer.
2. Add Apple Vision adapter output as the baseline fixture.
3. Add managed-provider adapters for AWS Textract, LlamaParse, and
   Unstructured.
4. Add Marker/Datalab adapter or managed Datalab run.
5. Produce a decision report with quality, retrieval, cost, privacy, and
   operational tradeoffs.
6. Replace `data/rule-sources/gh2-rule-book.md` only after a provider wins.

## Acceptance Criteria

- The repo contains a repeatable extraction eval command.
- The eval compares at least Apple Vision, AWS Textract, LlamaParse,
  Unstructured, and Marker/Datalab.
- The report includes quality scores, retrieval scores, latency, and cost.
- The selected provider has a documented refresh procedure.
- The selected provider output is reproducible enough for future source
  updates.
