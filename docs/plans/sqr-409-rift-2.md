<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-rift-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 2143               | 2143               | 3426            | 3426            |
| exact-lookup   | 1    | 1                   | 1                      | 2143               | 2143               | 3426            | 3426            |

| case                        | game          | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-scenario-9-ruinous-rift | gloomhaven-2e | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | pass         |                       | 3426       | 2143                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8af343f4-3288-4d67-899d-ee68b48e447c/r/019f3add-70dc-7000-8000-01fdb68fdc75?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8af343f4-3288-4d67-899d-ee68b48e447c/r/019f3add-70dc-7000-8000-01fdb68fdc75?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8af343f4-3288-4d67-899d-ee68b48e447c
