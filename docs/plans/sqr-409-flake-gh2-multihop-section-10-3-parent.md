<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-flake-gh2-multihop-section-10-3-parent

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1212               | 1212               | 1722            | 1722            |
| multi-hop      | 1    | 1                   | 1                      | 1212               | 1212               | 1722            | 1722            |

| case                             | game          | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-multihop-section-10-3-parent | gloomhaven-2e | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 1722       | 1212                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/095561dc-0a41-42f4-863c-69aed1c7cf4d/r/019f3afb-8f92-7000-8000-0116d6ee4680?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/095561dc-0a41-42f4-863c-69aed1c7cf4d/r/019f3afb-8f92-7000-8000-0116d6ee4680?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/095561dc-0a41-42f4-863c-69aed1c7cf4d
