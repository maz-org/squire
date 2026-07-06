<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-401-neighbors-nonregression

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 11022              | 11022              | 11029           | 11029           |
| multi-hop      | 1    | 1                   | 1                      | 11022              | 11022              | 11029           | 11029           |

| case                                      | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-10-conclusion-unlock | frosthaven | table-qa | scenarios | multi-hop      | deep | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | latency_budget | 1     | pass         |                       | 11029      | 11022                 | fail           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e67298c0-8d65-406a-83b2-50f0b143ca53/r/019f35b9-aae6-7000-8000-033abc081d86?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e67298c0-8d65-406a-83b2-50f0b143ca53/r/019f35b9-aae6-7000-8000-033abc081d86?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e67298c0-8d65-406a-83b2-50f0b143ca53
