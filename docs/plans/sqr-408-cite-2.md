<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-cite-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                         | game          | suite                | category                 | question class | lane | source authority    | game pair                | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ---------------------------- | ------------- | -------------------- | ------------------------ | -------------- | ---- | ------------------- | ------------------------ | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adv-citation-source-boundary | gloomhaven-2e | adversarial-boundary | citation-source-boundary |                | fast | adversarial-fixture | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 3048       | 1331                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/0313c13a-a5e1-43cd-a9fd-511974d6509a/r/019f3a94-6899-7000-8000-0329e2f1782c?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/0313c13a-a5e1-43cd-a9fd-511974d6509a/r/019f3a94-6899-7000-8000-0329e2f1782c?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/0313c13a-a5e1-43cd-a9fd-511974d6509a
