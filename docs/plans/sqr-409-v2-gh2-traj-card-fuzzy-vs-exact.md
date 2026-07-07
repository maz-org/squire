<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v2-gh2-traj-card-fuzzy-vs-exact

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                         | game          | suite      | category   | question class | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ---------------------------- | ------------- | ---------- | ---------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-traj-card-fuzzy-vs-exact | gloomhaven-2e | trajectory | trajectory |                | deep | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | retrieval     | 0     | -            |                       | 35881      | 35873                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/cfe257c4-0c0b-46e9-9976-e0fb536ccd03/r/019f3abb-4523-7000-8000-0395ba5f8f9b?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/cfe257c4-0c0b-46e9-9976-e0fb536ccd03/r/019f3abb-4523-7000-8000-0395ba5f8f9b?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/cfe257c4-0c0b-46e9-9976-e0fb536ccd03
