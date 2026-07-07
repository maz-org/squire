<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-fuzzy-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                         | game          | suite      | category   | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ---------------------------- | ------------- | ---------- | ---------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-traj-card-fuzzy-vs-exact | gloomhaven-2e | trajectory | trajectory |                | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | retrieval     | 0     | -            |                       | 32247      | 32239                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/184a125e-f5d3-4f76-8f2d-f3a83f0c882b/r/019f3ab8-0e6a-7000-8000-0274cca5f45c?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/184a125e-f5d3-4f76-8f2d-f3a83f0c882b/r/019f3ab8-0e6a-7000-8000-0274cca5f45c?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/184a125e-f5d3-4f76-8f2d-f3a83f0c882b
