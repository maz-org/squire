<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-408-gh2-errata-campaign-sheet-section-29

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 2892               | 2892               | 3909            | 3909            |
| rules-synthesis | 1    | 1                   | 1                      | 2892               | 2892               | 3909            | 3909            |

| case                                 | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-errata-campaign-sheet-section-29 | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | errata           | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 3909       | 2892                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f3110fce-de51-41c9-9e81-a85202b5b90d/r/019f3a79-8364-7000-8000-02b706f6dde8?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f3110fce-de51-41c9-9e81-a85202b5b90d/r/019f3a79-8364-7000-8000-02b706f6dde8?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f3110fce-de51-41c9-9e81-a85202b5b90d
