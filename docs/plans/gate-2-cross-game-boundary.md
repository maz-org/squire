<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: gate-2-cross-game-boundary

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | -            |                       | 16447      | 16442                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4940-8227-7000-8000-004df14fffb4?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4940-8227-7000-8000-004df14fffb4?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 20412      | 20408                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4940-c26e-7000-8000-0063d139e5c4?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4940-c26e-7000-8000-0063d139e5c4?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 15794      | 15790                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4941-122d-7000-8000-02b96a8a98a1?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833/r/019f4941-122d-7000-8000-02b96a8a98a1?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5f5f8248-59b3-4b57-8b66-58753dc87833
