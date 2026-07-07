<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-spot-gh2-rule-advantage

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1509               | 1509               | 3949            | 3949            |
| rules-synthesis | 1    | 1                   | 1                      | 1509               | 1509               | 3949            | 3949            |

| case               | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-rule-advantage | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3949       | 1509                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f01ac6eb-2a2b-474f-a4cf-610529d6c1b7/r/019f3a97-8efc-7000-8000-0014501efd3a?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f01ac6eb-2a2b-474f-a4cf-610529d6c1b7/r/019f3a97-8efc-7000-8000-0014501efd3a?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f01ac6eb-2a2b-474f-a4cf-610529d6c1b7
