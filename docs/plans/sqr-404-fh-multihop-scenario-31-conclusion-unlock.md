<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-fh-multihop-scenario-31-conclusion-unlock

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1345               | 1345               | 2458            | 2458            |
| multi-hop      | 1    | 1                   | 1                      | 1345               | 1345               | 2458            | 2458            |

| case                                      | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-31-conclusion-unlock | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2458       | 1345                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/abc27a73-79f0-4e98-a121-48c0a4b03595/r/019f3624-456a-7000-8000-029cf8249157?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/abc27a73-79f0-4e98-a121-48c0a4b03595/r/019f3624-456a-7000-8000-029cf8249157?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/abc27a73-79f0-4e98-a121-48c0a4b03595
