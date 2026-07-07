<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-prov-algox-1

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1450               | 1450               | 3484            | 3484            |
| exact-lookup   | 1    | 1                   | 1                      | 1450               | 1450               | 3484            | 3484            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-3-algox-offensive | frosthaven | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 0.8   | pass         |                       | 3484       | 1450                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/2c65ccbc-4cf5-49a6-9a5f-ec9dec515c2b/r/019f3afe-42e2-7000-8000-037de4a18857?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/2c65ccbc-4cf5-49a6-9a5f-ec9dec515c2b/r/019f3afe-42e2-7000-8000-037de4a18857?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/2c65ccbc-4cf5-49a6-9a5f-ec9dec515c2b
