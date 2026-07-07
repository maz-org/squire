<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-prov-algox-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1272               | 1272               | 3518            | 3518            |
| exact-lookup   | 1    | 1                   | 1                      | 1272               | 1272               | 3518            | 3518            |

| case                          | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-3-algox-offensive | frosthaven | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 0.8   | pass         |                       | 3518       | 1272                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/262a6da5-6114-4909-afc3-c050d1117fc5/r/019f3afe-c37a-7000-8000-03cc4b18eb11?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/262a6da5-6114-4909-afc3-c050d1117fc5/r/019f3afe-c37a-7000-8000-03cc4b18eb11?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/262a6da5-6114-4909-afc3-c050d1117fc5
