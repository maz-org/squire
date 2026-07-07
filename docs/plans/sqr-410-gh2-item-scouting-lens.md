<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-410-gh2-item-scouting-lens

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 7032               | 7032               | 12521           | 12521           |
| exact-lookup   | 1    | 1                   | 1                      | 7032               | 7032               | 12521           | 12521           |

| case                   | game          | suite    | category | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ---------------------- | ------------- | -------- | -------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-item-scouting-lens | gloomhaven-2e | table-qa | items    | exact-lookup   | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 12521      | 7032                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6b0968da-6b1a-4cef-9e71-824253e9a03f/r/019f3d12-0ceb-7000-8000-0042bbaac1bc?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6b0968da-6b1a-4cef-9e71-824253e9a03f/r/019f3d12-0ceb-7000-8000-0042bbaac1bc?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6b0968da-6b1a-4cef-9e71-824253e9a03f
