<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-safety2-cross-game-boundary

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | tool          | 1     | -            |                       | 15605      | 13415                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aee-c321-7000-8000-00199d936648?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aee-c321-7000-8000-00199d936648?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 17730      | 15760                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aef-001f-7000-8000-0179fe2c6a9c?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aef-001f-7000-8000-0179fe2c6a9c?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 16592      | 14197                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aef-4566-7000-8000-002413d64d8b?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9/r/019f3aef-4566-7000-8000-002413d64d8b?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1847bd84-c710-45a1-a78a-ee07ceedffc9
