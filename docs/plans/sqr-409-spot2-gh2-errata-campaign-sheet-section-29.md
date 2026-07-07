<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-spot2-gh2-errata-campaign-sheet-section-29

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 2364               | 2364               | 3785            | 3785            |
| rules-synthesis | 1    | 1                   | 1                      | 2364               | 2364               | 3785            | 3785            |

| case                                 | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-errata-campaign-sheet-section-29 | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | errata           | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 3785       | 2364                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/48cd8fe6-d55d-406c-a40d-a9bad13ccdc0/r/019f3b02-d19f-7000-8000-035fd979d770?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/48cd8fe6-d55d-406c-a40d-a9bad13ccdc0/r/019f3b02-d19f-7000-8000-035fd979d770?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/48cd8fe6-d55d-406c-a40d-a9bad13ccdc0
