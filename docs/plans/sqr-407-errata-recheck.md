<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-407-errata-recheck

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 2402               | 2402               | 3448            | 3448            |
| rules-synthesis | 1    | 1                   | 1                      | 2402               | 2402               | 3448            | 3448            |

| case                                 | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-errata-campaign-sheet-section-29 | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | errata           | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 3448       | 2402                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2b61a2c-09f9-4123-a65e-7d2923edcef6/r/019f3a62-b749-7000-8000-0245eed959f6?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2b61a2c-09f9-4123-a65e-7d2923edcef6/r/019f3a62-b749-7000-8000-0245eed959f6?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2b61a2c-09f9-4123-a65e-7d2923edcef6
