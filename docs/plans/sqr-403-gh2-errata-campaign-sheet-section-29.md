<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-403-gh2-errata-campaign-sheet-section-29

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1527               | 1527               | 2748            | 2748            |
| rules-synthesis | 1    | 1                   | 1                      | 1527               | 1527               | 2748            | 2748            |

| case                                 | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-errata-campaign-sheet-section-29 | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | errata           | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 2748       | 1527                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d9930b2e-1db7-4e78-a567-36b35c634827/r/019f3601-4d08-7000-8000-025a9b2b1916?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d9930b2e-1db7-4e78-a567-36b35c634827/r/019f3601-4d08-7000-8000-025a9b2b1916?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d9930b2e-1db7-4e78-a567-36b35c634827
