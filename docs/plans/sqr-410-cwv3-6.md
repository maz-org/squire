<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-cwv3-6

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                 | game          | suite           | category          | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------- | ------------- | --------------- | ----------------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cw-session-end-batch | gloomhaven-2e | campaign-writes | session-end-batch |                | deep | contract         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 15064      | 9792                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/67ccfbd7-75f3-4903-9030-95b5aa46908a/r/019f3d2a-d585-7000-8000-02a50aac3ec8?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/67ccfbd7-75f3-4903-9030-95b5aa46908a/r/019f3d2a-d585-7000-8000-02a50aac3ec8?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/67ccfbd7-75f3-4903-9030-95b5aa46908a
