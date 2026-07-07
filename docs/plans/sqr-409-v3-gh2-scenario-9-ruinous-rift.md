<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-gh2-scenario-9-ruinous-rift

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1983               | 1983               | 3399            | 3399            |
| exact-lookup   | 1    | 1                   | 1                      | 1983               | 1983               | 3399            | 3399            |

| case                        | game          | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-scenario-9-ruinous-rift | gloomhaven-2e | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | pass         |                       | 3399       | 1983                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/228922ff-22b4-475b-b96f-e0c954548b70/r/019f3ad7-3d3e-7000-8000-00a3bd2168d0?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/228922ff-22b4-475b-b96f-e0c954548b70/r/019f3ad7-3d3e-7000-8000-00a3bd2168d0?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/228922ff-22b4-475b-b96f-e0c954548b70
