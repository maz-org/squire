<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-409-rift-1

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 2177               | 2177               | 3313            | 3313            |
| exact-lookup   | 1    | 1                   | 1                      | 2177               | 2177               | 3313            | 3313            |

| case                        | game          | suite    | category  | question class | lane | source authority | game pair | runtime model                         | pass | failure class  | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | -------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-scenario-9-ruinous-rift | gloomhaven-2e | table-qa | scenarios | exact-lookup   | fast | structured-data  | -         | langgraph:anthropic:claude-sonnet-4-6 | fail | answer_quality | 0.6   | pass         |                       | 3313       | 2177                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6fd180e6-2e85-4079-a59e-f854f714efb7/r/019f3adc-ee9c-7000-8000-0309882a4587?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6fd180e6-2e85-4079-a59e-f854f714efb7/r/019f3adc-ee9c-7000-8000-0309882a4587?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6fd180e6-2e85-4079-a59e-f854f714efb7
