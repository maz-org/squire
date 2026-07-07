<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-gh2-monster-living-bones-immunity

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 12417              | 12417              | 12428           | 12428           |
| exact-lookup   | 1    | 1                   | 1                      | 12417              | 12417              | 12428           | 12428           |

| case                              | game          | suite    | category      | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------------- | ------------- | -------- | ------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-monster-living-bones-immunity | gloomhaven-2e | table-qa | monster-stats | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 12428      | 12417                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4e96b22-8155-4467-b19e-e15da7cd1046/r/019f3ad8-4847-7000-8000-033ac23b4f0d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4e96b22-8155-4467-b19e-e15da7cd1046/r/019f3ad8-4847-7000-8000-033ac23b4f0d?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4e96b22-8155-4467-b19e-e15da7cd1046
