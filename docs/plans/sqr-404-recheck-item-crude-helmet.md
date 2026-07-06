<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-recheck-item-crude-helmet

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1727               | 1727               | 3010            | 3010            |
| exact-lookup   | 1    | 1                   | 1                      | 1727               | 1727               | 3010            | 3010            |

| case              | game       | suite    | category | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------- | ---------- | -------- | -------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item-crude-helmet | frosthaven | table-qa | items    | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3010       | 1727                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6c9667b9-e1f4-4e13-8eaa-2c961bdd44b8/r/019f362b-f7de-7000-8000-03675a8dde0f?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6c9667b9-e1f4-4e13-8eaa-2c961bdd44b8/r/019f362b-f7de-7000-8000-03675a8dde0f?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6c9667b9-e1f4-4e13-8eaa-2c961bdd44b8
