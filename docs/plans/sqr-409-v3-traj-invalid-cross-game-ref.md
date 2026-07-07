<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-v3-traj-invalid-cross-game-ref

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                        | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class            | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------------------ | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| traj-invalid-cross-game-ref | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | fail | cross_game_contamination | 1     | -            |                       | 18617      | 16359                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9f4fac51-8cdb-46a3-9c27-41a5b2f419a9/r/019f3ad9-fa25-7000-8000-02e11b744866?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9f4fac51-8cdb-46a3-9c27-41a5b2f419a9/r/019f3ad9-fa25-7000-8000-02e11b744866?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9f4fac51-8cdb-46a3-9c27-41a5b2f419a9
