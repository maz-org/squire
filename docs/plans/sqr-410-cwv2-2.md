<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-cwv2-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                 | game          | suite           | category          | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------- | ------------- | --------------- | ----------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cw-session-end-batch | gloomhaven-2e | campaign-writes | session-end-batch |                | deep | contract         | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | -            |                       | 14428      | 9173                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/82c9bdc7-3b47-4e57-84e0-643920f50ff5/r/019f3d24-7193-7000-8000-02c7e20c252e?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/82c9bdc7-3b47-4e57-84e0-643920f50ff5/r/019f3d24-7193-7000-8000-02c7e20c252e?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/82c9bdc7-3b47-4e57-84e0-643920f50ff5
