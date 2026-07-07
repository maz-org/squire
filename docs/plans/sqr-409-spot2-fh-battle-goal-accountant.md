<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-spot2-fh-battle-goal-accountant

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1199               | 1199               | 1783            | 1783            |
| exact-lookup   | 1    | 1                   | 1                      | 1199               | 1199               | 1783            | 1783            |

| case                      | game       | suite    | category     | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------- | ---------- | -------- | ------------ | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-battle-goal-accountant | frosthaven | table-qa | battle-goals | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 1783       | 1199                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/93f64faf-b5cc-4b6b-86e9-100c8e9c5789/r/019f3b03-54b5-7000-8000-01ffe3939f3c?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/93f64faf-b5cc-4b6b-86e9-100c8e9c5789/r/019f3b03-54b5-7000-8000-01ffe3939f3c?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/93f64faf-b5cc-4b6b-86e9-100c8e9c5789
