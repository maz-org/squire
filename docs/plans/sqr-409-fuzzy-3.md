<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-fuzzy-3

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                         | game          | suite      | category   | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ---------------------------- | ------------- | ---------- | ---------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-traj-card-fuzzy-vs-exact | gloomhaven-2e | trajectory | trajectory |                | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | -            |                       | 55664      | 31589                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/65f9d1d5-1394-4610-89c1-3fbdd7e76c05/r/019f3abf-7ddf-7000-8000-036509f18b27?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/65f9d1d5-1394-4610-89c1-3fbdd7e76c05/r/019f3abf-7ddf-7000-8000-036509f18b27?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/65f9d1d5-1394-4610-89c1-3fbdd7e76c05
