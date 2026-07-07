<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-fh-scenario-4b-heart-of-ice-b

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 8440               | 8440               | 8449            | 8449            |
| exact-lookup   | 1    | 1                   | 1                      | 8440               | 8440               | 8449            | 8449            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-4b-heart-of-ice-b | frosthaven | table-qa | scenarios | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 8449       | 8440                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e6165943-7fac-4e79-9512-1de9ac8c11b5/r/019f3d11-86ac-7000-8000-035b7cfa7a89?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e6165943-7fac-4e79-9512-1de9ac8c11b5/r/019f3d11-86ac-7000-8000-035b7cfa7a89?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e6165943-7fac-4e79-9512-1de9ac8c11b5
