<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-spot-item-crude-helmet

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1270               | 1270               | 2401            | 2401            |
| exact-lookup   | 1    | 1                   | 1                      | 1270               | 1270               | 2401            | 2401            |

| case              | game       | suite    | category | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------- | ---------- | -------- | -------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item-crude-helmet | frosthaven | table-qa | items    | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2401       | 1270                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7b3098d7-449e-4b2e-8bad-f2a5d07410af/r/019f3a97-0dc1-7000-8000-02d052548c29?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7b3098d7-449e-4b2e-8bad-f2a5d07410af/r/019f3a97-0dc1-7000-8000-02d052548c29?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7b3098d7-449e-4b2e-8bad-f2a5d07410af
