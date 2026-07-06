<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-fh-multihop-scenario-14-conclusion-unlock

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1347               | 1347               | 2337            | 2337            |
| multi-hop      | 1    | 1                   | 1                      | 1347               | 1347               | 2337            | 2337            |

| case                                      | game       | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ----------------------------------------- | ---------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-multihop-scenario-14-conclusion-unlock | frosthaven | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 2337       | 1347                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6ba97bc1-2025-4a6f-adc4-9f96a350da4e/r/019f3623-a586-7000-8000-02dfff232fc7?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6ba97bc1-2025-4a6f-adc4-9f96a350da4e/r/019f3623-a586-7000-8000-02dfff232fc7?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6ba97bc1-2025-4a6f-adc4-9f96a350da4e
