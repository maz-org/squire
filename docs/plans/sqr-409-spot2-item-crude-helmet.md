<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-spot2-item-crude-helmet

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1473               | 1473               | 2608            | 2608            |
| exact-lookup   | 1    | 1                   | 1                      | 1473               | 1473               | 2608            | 2608            |

| case              | game       | suite    | category | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------- | ---------- | -------- | -------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item-crude-helmet | frosthaven | table-qa | items    | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2608       | 1473                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/90b6becf-0541-45b5-89e5-ecbf7d9cfa96/r/019f3b00-c426-7000-8000-012a7861206f?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/90b6becf-0541-45b5-89e5-ecbf7d9cfa96/r/019f3b00-c426-7000-8000-012a7861206f?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/90b6becf-0541-45b5-89e5-ecbf7d9cfa96
