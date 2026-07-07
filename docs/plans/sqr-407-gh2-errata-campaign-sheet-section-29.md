<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-407-gh2-errata-campaign-sheet-section-29

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 12257              | 12257              | 17063           | 17063           |
| rules-synthesis | 1    | 1                   | 1                      | 12257              | 12257              | 17063           | 17063           |

| case                                 | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-errata-campaign-sheet-section-29 | gloomhaven-2e | table-qa | rulebook | rules-synthesis | deep | errata           | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 17063      | 12257                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ccd696cc-c0f2-473b-9c34-4b9c3c2ff3d1/r/019f3a60-d3f6-7000-8000-00f4527eae00?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ccd696cc-c0f2-473b-9c34-4b9c3c2ff3d1/r/019f3a60-d3f6-7000-8000-00f4527eae00?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ccd696cc-c0f2-473b-9c34-4b9c3c2ff3d1
