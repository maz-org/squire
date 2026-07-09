<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-412-cg-1

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 0    | 0                   | 0                      | -                  | -                  | -               | -               |

| case                             | game          | suite               | category   | question class | lane | source authority | game pair                | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | ------------------- | ---------- | -------------- | ---- | ---------------- | ------------------------ | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundary-scenario-61-fh-then-gh2 | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 11870      | 11858                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f4729-8823-7000-8000-02d73b004190?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f4729-8823-7000-8000-02d73b004190?poll=true |
| traj-invalid-cross-game-ref      | gloomhaven-2e | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 19259      | 19255                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f4729-b68e-7000-8000-014a7c776813?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f4729-b68e-7000-8000-014a7c776813?poll=true |
| boundary-section-67-gh2-then-fh  | frosthaven    | cross-game-boundary | trajectory |                | deep | contract         | frosthaven:gloomhaven-2e | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | -            |                       | 14148      | 14144                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f472a-01ca-7000-8000-0149bcd1d7c3?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745/r/019f472a-01ca-7000-8000-0149bcd1d7c3?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3ea69fae-355e-4bea-82a2-d1748a1c0745
