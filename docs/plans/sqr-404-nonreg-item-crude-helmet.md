<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-nonreg-item-crude-helmet

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 2592               | 2592               | 3771            | 3771            |
| exact-lookup   | 1    | 1                   | 1                      | 2592               | 2592               | 3771            | 3771            |

| case              | game       | suite    | category | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------- | ---------- | -------- | -------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item-crude-helmet | frosthaven | table-qa | items    | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | latency_budget | 1     | pass         |                       | 3771       | 2592                  | fail           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7d18b174-6476-44e3-bf88-f3e1837e0846/r/019f3627-7fbf-7000-8000-03bab2bc9bd6?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7d18b174-6476-44e3-bf88-f3e1837e0846/r/019f3627-7fbf-7000-8000-03bab2bc9bd6?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7d18b174-6476-44e3-bf88-f3e1837e0846
