<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-gh2-monster-living-bones-immunity

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 5228               | 5228               | 5236            | 5236            |
| exact-lookup   | 1    | 1                   | 1                      | 5228               | 5228               | 5236            | 5236            |

| case                              | game          | suite    | category      | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------------- | ------------- | -------- | ------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-monster-living-bones-immunity | gloomhaven-2e | table-qa | monster-stats | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 5236       | 5228                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b61a3d76-c902-4dcd-a338-12806b8b1855/r/019f3d10-7a98-7000-8000-030f836f718e?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b61a3d76-c902-4dcd-a338-12806b8b1855/r/019f3d10-7a98-7000-8000-030f836f718e?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b61a3d76-c902-4dcd-a338-12806b8b1855
