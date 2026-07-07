<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-monster-living-bones-immunity

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 5730               | 5730               | 5738            | 5738            |
| exact-lookup   | 1    | 1                   | 1                      | 5730               | 5730               | 5738            | 5738            |

| case                          | game       | suite    | category      | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | ------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| monster-living-bones-immunity | frosthaven | table-qa | monster-stats | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 5738       | 5730                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/050fbf00-47d8-427d-a4a6-d24d1f065738/r/019f3d11-01a0-7000-8000-01fa67a85d23?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/050fbf00-47d8-427d-a4a6-d24d1f065738/r/019f3d11-01a0-7000-8000-01fa67a85d23?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/050fbf00-47d8-427d-a4a6-d24d1f065738
