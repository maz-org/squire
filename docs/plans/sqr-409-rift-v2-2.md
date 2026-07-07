<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-rift-v2-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1470               | 1470               | 2620            | 2620            |
| exact-lookup   | 1    | 1                   | 1                      | 1470               | 1470               | 2620            | 2620            |

| case                        | game          | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-scenario-9-ruinous-rift | gloomhaven-2e | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2620       | 1470                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/642582e9-a921-4e00-9f65-95db91c560b6/r/019f3ae0-8779-7000-8000-01d45bd9c7ec?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/642582e9-a921-4e00-9f65-95db91c560b6/r/019f3ae0-8779-7000-8000-01d45bd9c7ec?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/642582e9-a921-4e00-9f65-95db91c560b6
