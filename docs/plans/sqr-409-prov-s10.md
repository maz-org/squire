<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-prov-s10

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1306               | 1306               | 2098            | 2098            |
| multi-hop      | 1    | 1                   | 1                      | 1306               | 1306               | 2098            | 2098            |

| case                                      | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-10-conclusion-unlock | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2098       | 1306                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c247f080-9022-4a25-a8e0-8317ac1ae703/r/019f3aff-c93a-7000-8000-0102e0b5a70d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c247f080-9022-4a25-a8e0-8317ac1ae703/r/019f3aff-c93a-7000-8000-0102e0b5a70d?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c247f080-9022-4a25-a8e0-8317ac1ae703
