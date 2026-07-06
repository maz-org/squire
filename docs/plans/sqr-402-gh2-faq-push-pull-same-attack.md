<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-402-concepts-gh2-faq-push-pull-same-attack

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1784               | 1784               | 3454            | 3454            |
| rules-synthesis | 1    | 1                   | 1                      | 1784               | 1784               | 3454            | 3454            |

| case                          | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------- | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-faq-push-pull-same-attack | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | faq              | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 3454       | 1784                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/09f9ec32-b955-47cb-b6dd-fbcc85e5d0aa/r/019f35da-4f2d-7000-8000-03697ca66a16?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/09f9ec32-b955-47cb-b6dd-fbcc85e5d0aa/r/019f35da-4f2d-7000-8000-03697ca66a16?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/09f9ec32-b955-47cb-b6dd-fbcc85e5d0aa
