<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-safety-cross-game-boundary

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class            | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------------------ | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none                     | 1     | -            |                       | 22946      | 12901                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-2ba2-7000-8000-00c97c3de821?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-2ba2-7000-8000-00c97c3de821?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | fail | cross_game_contamination | 1     | -            |                       | 30434      | 14325                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-854d-7000-8000-008a4882dbe6?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-854d-7000-8000-008a4882dbe6?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none                     | 1     | -            |                       | 30161      | 17643                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-fc35-7000-8000-012bb2885d89?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6/r/019f3acf-fc35-7000-8000-012bb2885d89?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5bbb57b5-8168-4f3d-b1ea-1ac1e03588f6
