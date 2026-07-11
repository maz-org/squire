<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-390-391-verify

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 13407              | 13407              | 16408           | 16408           |
| exact-lookup   | 1    | 1                   | 1                      | 13407              | 13407              | 16408           | 16408           |

| case                        | game       | suite    | category       | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ---------- | -------- | -------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-character-mat-boneshaper | frosthaven | table-qa | character-mats | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 16408      | 13407                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/4321cffd-3fb2-45f8-bd47-a10ded4ab940/r/019f527b-23be-7000-8000-009e9bbc1e0d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/4321cffd-3fb2-45f8-bd47-a10ded4ab940/r/019f527b-23be-7000-8000-009e9bbc1e0d?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/4321cffd-3fb2-45f8-bd47-a10ded4ab940
