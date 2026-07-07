<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-gh2-faq-range-one-still-ranged

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1488               | 1488               | 2573            | 2573            |
| rules-synthesis | 1    | 1                   | 1                      | 1488               | 1488               | 2573            | 2573            |

| case                           | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-faq-range-one-still-ranged | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | faq              | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2573       | 1488                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ea8ea785-f944-4781-9a5e-bf00957faf25/r/019f3ad9-79d5-7000-8000-027a14e35d18?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ea8ea785-f944-4781-9a5e-bf00957faf25/r/019f3ad9-79d5-7000-8000-027a14e35d18?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ea8ea785-f944-4781-9a5e-bf00957faf25
