<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-390-391-verify

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 7453               | 7453               | 7461            | 7461            |
| exact-lookup   | 1    | 1                   | 1                      | 7453               | 7453               | 7461            | 7461            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-4b-heart-of-ice-b | frosthaven | table-qa | scenarios | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 7461       | 7453                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/adf140c6-0453-4903-be78-d45f60b63adb/r/019f527a-9b60-7000-8000-03256546c909?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/adf140c6-0453-4903-be78-d45f60b63adb/r/019f527a-9b60-7000-8000-03256546c909?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/adf140c6-0453-4903-be78-d45f60b63adb
