<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-nonreg-scenario-61-unlock

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 24362              | 24362              | 27397           | 27397           |
| multi-hop      | 1    | 1                   | 1                      | 24362              | 24362              | 27397           | 27397           |

| case               | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------ | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scenario-61-unlock | frosthaven | table-qa | scenarios | multi-hop      | deep | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | pass         |                       | 27397      | 24362                 | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f98268cf-cb88-49e8-a155-c8aeda1f7ca9/r/019f3628-1556-7000-8000-0281ca79f636?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f98268cf-cb88-49e8-a155-c8aeda1f7ca9/r/019f3628-1556-7000-8000-0281ca79f636?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f98268cf-cb88-49e8-a155-c8aeda1f7ca9
