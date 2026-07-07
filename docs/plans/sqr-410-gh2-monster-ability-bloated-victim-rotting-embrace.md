<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-gh2-monster-ability-bloated-victim-rotting-embrace

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 8574               | 8574               | 14595           | 14595           |
| exact-lookup   | 1    | 1                   | 1                      | 8574               | 8574               | 14595           | 14595           |

| case                                               | game          | suite    | category          | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------------------------- | ------------- | -------- | ----------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-monster-ability-bloated-victim-rotting-embrace | gloomhaven-2e | table-qa | monster-abilities | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 14595      | 8574                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/52a98c91-45da-4172-a710-e6a850730f8f/r/019f3d12-a977-7000-8000-02e1f0d4306c?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/52a98c91-45da-4172-a710-e6a850730f8f/r/019f3d12-a977-7000-8000-02e1f0d4306c?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/52a98c91-45da-4172-a710-e6a850730f8f
