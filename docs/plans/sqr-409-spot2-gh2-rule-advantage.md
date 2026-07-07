<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-spot2-gh2-rule-advantage

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1817               | 1817               | 4245            | 4245            |
| rules-synthesis | 1    | 1                   | 1                      | 1817               | 1817               | 4245            | 4245            |

| case               | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-rule-advantage | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 4245       | 1817                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9bd9dd54-5e98-4a8d-a321-6bb68d7cdf0f/r/019f3b01-45b8-7000-8000-03f6f2ad2570?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9bd9dd54-5e98-4a8d-a321-6bb68d7cdf0f/r/019f3b01-45b8-7000-8000-03f6f2ad2570?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9bd9dd54-5e98-4a8d-a321-6bb68d7cdf0f
