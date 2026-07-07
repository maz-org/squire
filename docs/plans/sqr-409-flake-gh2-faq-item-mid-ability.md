<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-flake-gh2-faq-item-mid-ability

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 1325               | 1325               | 4251            | 4251            |
| rules-synthesis | 1    | 1                   | 1                      | 1325               | 1325               | 4251            | 4251            |

| case                     | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-faq-item-mid-ability | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | faq              | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | pass         |                       | 4251       | 1325                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a0df65f3-ac5f-42b2-bae7-685bde0305c3/r/019f3afc-1032-7000-8000-01146637aec4?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a0df65f3-ac5f-42b2-bae7-685bde0305c3/r/019f3afc-1032-7000-8000-01146637aec4?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a0df65f3-ac5f-42b2-bae7-685bde0305c3
