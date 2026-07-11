<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-390-391-verify

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 2080               | 2080               | 3811            | 3811            |
| exact-lookup   | 1    | 1                   | 1                      | 2080               | 2080               | 3811            | 3811            |

| case                                             | game          | suite    | category            | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------------------ | ------------- | -------- | ------------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-character-ability-doomstalker-rain-of-arrows | gloomhaven-2e | table-qa | character-abilities | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3811       | 2080                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9896d334-296b-465a-981e-6a84410b4728/r/019f527b-d5ef-7000-8000-01cf92caed0e?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9896d334-296b-465a-981e-6a84410b4728/r/019f527b-d5ef-7000-8000-01cf92caed0e?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9896d334-296b-465a-981e-6a84410b4728
