<!-- markdownlint-disable -->

# Eval Matrix Report

Run label: sqr-404-gh2-multihop-section-10-3-parent

## Table-QA Latency Percentiles

| question class | rows | measured (complete) | measured (first token) | first token P50 ms | first token P95 ms | complete P50 ms | complete P95 ms |
| -------------- | ---- | ------------------- | ---------------------- | ------------------ | ------------------ | --------------- | --------------- |
| overall        | 1    | 1                   | 1                      | 1317               | 1317               | 1697            | 1697            |
| multi-hop      | 1    | 1                   | 1                      | 1317               | 1317               | 1697            | 1697            |

| case                             | game          | suite    | category  | question class | lane | source authority       | game pair | runtime model                         | pass | failure class | score | groundedness | groundedness failures | latency ms | first answer token ms | latency budget | trace                                                                                                                                                               | LangSmith trace                                                                                                                                                     |
| -------------------------------- | ------------- | -------- | --------- | -------------- | ---- | ---------------------- | --------- | ------------------------------------- | ---- | ------------- | ----- | ------------ | --------------------- | ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh2-multihop-section-10-3-parent | gloomhaven-2e | table-qa | scenarios | multi-hop      | fast | scenario-section-books | -         | langgraph:anthropic:claude-sonnet-4-6 | pass | none          | 1     | pass         |                       | 1697       | 1317                  | pass           | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/345d96ec-b3bb-4cfb-8087-bea5eb5d1deb/r/019f3625-e683-7000-8000-0122eaa3894b?poll=true | https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/345d96ec-b3bb-4cfb-8087-bea5eb5d1deb/r/019f3625-e683-7000-8000-0122eaa3894b?poll=true |

## LangSmith Experiments

- https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/345d96ec-b3bb-4cfb-8087-bea5eb5d1deb
