<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-fh-multihop-scenario-2-read-now-chain

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1441               | 1441               | 2040            | 2040            |
| multi-hop      | 1    | 1                   | 1                      | 1441               | 1441               | 2040            | 2040            |

| case                                  | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-2-read-now-chain | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2040       | 1441                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c001081d-b6ed-41d2-a1ae-abb5cc03f66b/r/019f3625-52a3-7000-8000-038bb9360309?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c001081d-b6ed-41d2-a1ae-abb5cc03f66b/r/019f3625-52a3-7000-8000-038bb9360309?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c001081d-b6ed-41d2-a1ae-abb5cc03f66b
