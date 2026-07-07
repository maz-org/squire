<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-fh-scenario-1-a-town-in-flames

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1939               | 1939               | 3582            | 3582            |
| exact-lookup   | 1    | 1                   | 1                      | 1939               | 1939               | 3582            | 3582            |

| case                           | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------ | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-1-a-town-in-flames | frosthaven | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3582       | 1939                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8b11663c-34cb-401b-961b-8b1f1a31bf5f/r/019f3a78-ffef-7000-8000-016e28cab502?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8b11663c-34cb-401b-961b-8b1f1a31bf5f/r/019f3a78-ffef-7000-8000-016e28cab502?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8b11663c-34cb-401b-961b-8b1f1a31bf5f
