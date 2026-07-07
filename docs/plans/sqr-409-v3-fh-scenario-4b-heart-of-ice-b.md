<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-fh-scenario-4b-heart-of-ice-b

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 7925               | 7925               | 7934            | 7934            |
| exact-lookup   | 1    | 1                   | 1                      | 7925               | 7925               | 7934            | 7934            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-4b-heart-of-ice-b | frosthaven | table-qa | scenarios | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 7934       | 7925                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d90fa225-4a5b-47c2-816c-abff8bcba0f5/r/019f3ad7-c053-7000-8000-034b0f8adc5f?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d90fa225-4a5b-47c2-816c-abff8bcba0f5/r/019f3ad7-c053-7000-8000-034b0f8adc5f?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d90fa225-4a5b-47c2-816c-abff8bcba0f5
