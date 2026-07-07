<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-spot2-fh-rule-retaliate-timing

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1533               | 1533               | 3877            | 3877            |
| rules-synthesis | 1    | 1                   | 1                      | 1533               | 1533               | 3877            | 3877            |

| case                     | game       | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------ | ---------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-rule-retaliate-timing | frosthaven | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 3877       | 1533                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b927c4b9-86a7-4fc4-9f5e-4f9cd4ae19df/r/019f3b02-505c-7000-8000-00f9d480e6eb?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b927c4b9-86a7-4fc4-9f5e-4f9cd4ae19df/r/019f3b02-505c-7000-8000-00f9d480e6eb?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b927c4b9-86a7-4fc4-9f5e-4f9cd4ae19df
