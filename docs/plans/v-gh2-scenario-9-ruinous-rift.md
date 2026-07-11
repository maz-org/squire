<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-390-391-verify

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1629               | 1629               | 2879            | 2879            |
| exact-lookup   | 1    | 1                   | 1                      | 1629               | 1629               | 2879            | 2879            |

| case                        | game          | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-scenario-9-ruinous-rift | gloomhaven-2e | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2879       | 1629                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/62c265b0-fc24-4454-b162-37d4b371801a/r/019f527c-5dc9-7000-8000-0325eb30ed25?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/62c265b0-fc24-4454-b162-37d4b371801a/r/019f527c-5dc9-7000-8000-0325eb30ed25?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/62c265b0-fc24-4454-b162-37d4b371801a
