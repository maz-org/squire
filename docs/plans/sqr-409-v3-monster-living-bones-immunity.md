<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-monster-living-bones-immunity

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 10613              | 10613              | 10626           | 10626           |
| exact-lookup   | 1    | 1                   | 1                      | 10613              | 10613              | 10626           | 10626           |

| case                          | game       | suite    | category      | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | ------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| monster-living-bones-immunity | frosthaven | table-qa | monster-stats | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 10626      | 10613                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/fb438ee3-84e0-4c0b-9ea3-dbf36aad7cc2/r/019f3ad8-deda-7000-8000-0214850c2d0b?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/fb438ee3-84e0-4c0b-9ea3-dbf36aad7cc2/r/019f3ad8-deda-7000-8000-0214850c2d0b?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/fb438ee3-84e0-4c0b-9ea3-dbf36aad7cc2
