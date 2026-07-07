<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v2-scenario-61-unlock

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1541               | 1541               | 3734            | 3734            |
| multi-hop      | 1    | 1                   | 1                      | 1541               | 1541               | 3734            | 3734            |

| case               | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------ | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scenario-61-unlock | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3734       | 1541                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/316a5575-17c4-4e97-af61-dd2ad307295c/r/019f3abc-00ba-7000-8000-01b2c2570188?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/316a5575-17c4-4e97-af61-dd2ad307295c/r/019f3abc-00ba-7000-8000-01b2c2570188?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/316a5575-17c4-4e97-af61-dd2ad307295c
