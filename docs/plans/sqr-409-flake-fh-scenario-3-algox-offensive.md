<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-flake-fh-scenario-3-algox-offensive

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1693               | 1693               | 4195            | 4195            |
| exact-lookup   | 1    | 1                   | 1                      | 1693               | 1693               | 4195            | 4195            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-3-algox-offensive | frosthaven | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | pass         |                       | 4195       | 1693                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/74e37669-dd41-4c13-9350-e5338dff30d7/r/019f3afb-0dd7-7000-8000-0341fb7d289d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/74e37669-dd41-4c13-9350-e5338dff30d7/r/019f3afb-0dd7-7000-8000-0341fb7d289d?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/74e37669-dd41-4c13-9350-e5338dff30d7
