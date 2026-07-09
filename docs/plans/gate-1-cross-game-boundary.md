<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: gate-1-cross-game-boundary

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class            | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------------------ | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | tool                     | 1     | -            |                       | 16642      | 14216                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-6339-7000-8000-013c75fe830d?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-6339-7000-8000-013c75fe830d?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | fast | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | fail | cross_game_contamination | 1     | -            |                       | 3159       | 1023                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-a445-7000-8000-02ffeaf8cd4f?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-a445-7000-8000-02ffeaf8cd4f?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none                     | 1     | -            |                       | 16741      | 14007                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-b0a0-7000-8000-032c764b6c46?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103/r/019f471f-b0a0-7000-8000-032c764b6c46?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f4bba495-91a1-4ec7-94c5-de38444fa103
