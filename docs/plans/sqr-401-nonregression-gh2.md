<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-401-neighbors-nonregression-gh2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 3551               | 3551               | 3559            | 3559            |
| multi-hop      | 1    | 1                   | 1                      | 3551               | 3551               | 3559            | 3559            |

| case                             | game          | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-multihop-section-10-3-parent | gloomhaven-2e | table-qa | scenarios | multi-hop      | deep | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | retrieval     | 1     | pass         |                       | 3559       | 3551                  | fail           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7a9108db-232f-4b6d-8a55-ff04e8d4d0c5/r/019f35bb-5fc8-7000-8000-01aec5bbbdf8?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7a9108db-232f-4b6d-8a55-ff04e8d4d0c5/r/019f35bb-5fc8-7000-8000-01aec5bbbdf8?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7a9108db-232f-4b6d-8a55-ff04e8d4d0c5
