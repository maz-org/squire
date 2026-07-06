<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-nonreg-gh2-rule-advantage

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 2098               | 2098               | 4672            | 4672            |
| rules-synthesis | 1    | 1                   | 1                      | 2098               | 2098               | 4672            | 4672            |

| case               | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------ | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-rule-advantage | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 4672       | 2098                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8a3aceb3-eec2-443e-901e-e983fcef8244/r/019f3629-2a6c-7000-8000-005071efd22a?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8a3aceb3-eec2-443e-901e-e983fcef8244/r/019f3629-2a6c-7000-8000-005071efd22a?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8a3aceb3-eec2-443e-901e-e983fcef8244
