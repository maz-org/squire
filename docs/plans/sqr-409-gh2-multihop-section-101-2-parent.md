<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-gh2-multihop-section-101-2-parent

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1307               | 1307               | 1798            | 1798            |
| multi-hop      | 1    | 1                   | 1                      | 1307               | 1307               | 1798            | 1798            |

| case                              | game          | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-multihop-section-101-2-parent | gloomhaven-2e | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 1798       | 1307                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2941e07-4524-4318-8ef5-6b737b81e3fb/r/019f3ab7-2c8b-7000-8000-0063542b8e08?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2941e07-4524-4318-8ef5-6b737b81e3fb/r/019f3ab7-2c8b-7000-8000-0063542b8e08?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a2941e07-4524-4318-8ef5-6b737b81e3fb
