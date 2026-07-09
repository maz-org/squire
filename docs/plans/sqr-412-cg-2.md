<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-412-cg-2

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 10396      | 10386                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-8b11-7000-8000-017aec3766d0?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-8b11-7000-8000-017aec3766d0?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 19065      | 19060                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-b3b6-7000-8000-0032ababf322?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-b3b6-7000-8000-0032ababf322?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 13342      | 13338                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-fe31-7000-8000-0147533b5a50?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d/r/019f472a-fe31-7000-8000-0147533b5a50?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/78d5c261-e011-4f03-a113-ed8b08092a5d
