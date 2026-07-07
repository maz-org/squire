<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-fh-multihop-scenario-14-conclusion-unlock

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 9693               | 9693               | 10924           | 10924           |
| multi-hop      | 1    | 1                   | 1                      | 9693               | 9693               | 10924           | 10924           |

| case                                      | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-14-conclusion-unlock | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | latency_budget | 1     | pass         |                       | 10924      | 9693                  | fail           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c64cf80d-d17e-4ac7-9d43-c06e72f7526d/r/019f3a7a-0c89-7000-8000-03dbae438e2d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c64cf80d-d17e-4ac7-9d43-c06e72f7526d/r/019f3a7a-0c89-7000-8000-03dbae438e2d?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c64cf80d-d17e-4ac7-9d43-c06e72f7526d
