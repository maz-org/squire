<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-403-gh2-rule-looting-definition

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 4203               | 4203               | 5963            | 5963            |
| rules-synthesis | 1    | 1                   | 1                      | 4203               | 4203               | 5963            | 5963            |

| case                        | game          | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| --------------------------- | ------------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-rule-looting-definition | gloomhaven-2e | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 5963       | 4203                  | -              | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/11d18ece-051b-4706-8634-cb65fe37239f/r/019f3601-e81d-7000-8000-010ae582f53b?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/11d18ece-051b-4706-8634-cb65fe37239f/r/019f3601-e81d-7000-8000-010ae582f53b?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/11d18ece-051b-4706-8634-cb65fe37239f
