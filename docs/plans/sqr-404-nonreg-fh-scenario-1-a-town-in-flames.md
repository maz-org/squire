<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-nonreg-fh-scenario-1-a-town-in-flames

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1457               | 1457               | 2897            | 2897            |
| exact-lookup   | 1    | 1                   | 1                      | 1457               | 1457               | 2897            | 2897            |

| case                           | game       | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------ | ---------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-scenario-1-a-town-in-flames | frosthaven | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2897       | 1457                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/996d694e-2a63-4695-aeba-9a5f86ba5e50/r/019f3626-e88c-7000-8000-0311a8511bbd?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/996d694e-2a63-4695-aeba-9a5f86ba5e50/r/019f3626-e88c-7000-8000-0311a8511bbd?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/996d694e-2a63-4695-aeba-9a5f86ba5e50
