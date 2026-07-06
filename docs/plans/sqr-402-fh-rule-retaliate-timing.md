<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-402-concepts-fh-rule-retaliate-timing

## Table-QA Latency Percentiles

| question class  | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| --------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall         | 1    | 1                   | 1                      | 2217               | 2217               | 4439            | 4439            |
| rules-synthesis | 1    | 1                   | 1                      | 2217               | 2217               | 4439            | 4439            |

| case                     | game       | suite    | category | question class  | lane | source authority | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| ------------------------ | ---------- | -------- | -------- | --------------- | ---- | ---------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fh-rule-retaliate-timing | frosthaven | table-qa | rulebook | rules-synthesis | fast | rulebook         | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 4439       | 2217                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/395fe302-bce6-46aa-a945-90bad6f811cf/r/019f35d9-966e-7000-8000-02ddc9684ff9?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/395fe302-bce6-46aa-a945-90bad6f811cf/r/019f35d9-966e-7000-8000-02ddc9684ff9?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/395fe302-bce6-46aa-a945-90bad6f811cf
