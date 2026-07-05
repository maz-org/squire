# SQR-386 Guardrail Fix Summary

## Scope

SQR-386 fixed the guardrail failures left by the SQR-385 final verification
runs before more latency tuning:

- source-boundary answer wording repeated rejected game names;
- the Drifter correction row was rejected by an overbroad denial regex;
- cross-game scenario 61 accepted `open_entity` but not the equivalent
  `lookup_entity` path;
- cross-member private-field requests did not get a firm access-boundary
  answer;
- campaign-write evals reused dirty pending proposal and campaign state.

The fixes are scoped to deterministic guardrails, campaign fixture hygiene, and
answer-shape instructions. They do not weaken source-boundary, private-field,
campaign-write, or deterministic scoring contracts.

## Evidence

| Check                    |         Result | Report                                                                                         |
| ------------------------ | -------------: | ---------------------------------------------------------------------------------------------- |
| Targeted guardrail rows  |       5/5 pass | `sqr-386-target-*.json` retained for the five SQR-386 rows                                     |
| Adversarial boundary     |       8/8 pass | [sqr-386-guardrail-adversarial-boundary.md](sqr-386-guardrail-adversarial-boundary.md)         |
| Cross-game boundary      |       3/3 pass | [sqr-386-guardrail-cross-game-boundary.md](sqr-386-guardrail-cross-game-boundary.md)           |
| Campaign personalization |       5/5 pass | [sqr-386-guardrail-campaign-personalization.md](sqr-386-guardrail-campaign-personalization.md) |
| Campaign writes          |       7/7 pass | [sqr-386-guardrail-campaign-writes-clean.md](sqr-386-guardrail-campaign-writes-clean.md)       |
| Guardrail total          |     23/23 pass | four reports above                                                                             |
| Table QA groundedness    | 147/150, 98.0% | [sqr-386-table-qa-groundedness.md](sqr-386-table-qa-groundedness.md)                           |
| Repo check               |           pass | `npm run check`                                                                                |

Table QA still had three groundedness misses:

- `fh-scenario-4b-heart-of-ice-b`: no source labels or canonical refs recorded;
- `fh-scenario-4a-heart-of-ice-a`: no source labels or canonical refs recorded;
- `gh2-section-67-1`: canonical ref was recorded without the expected game
  qualifier.

Those misses are outside the SQR-386 guardrail target and the aggregate
groundedness still meets the 98% bar.

## LangSmith Runs

Targeted rows:

- `sqr-386-target-adv-citation-source-boundary-rerun`:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/6f0b447f-cd00-4a81-8c43-87db5fbd504e>
- `sqr-386-target-boundary-scenario-61-fh-then-gh2`:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/42e12a8c-8b28-4a46-8f44-412bc6bd7c90>
- `sqr-386-target-drifter-ignore-negative-item-effects-correction`:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/69cabdc4-bba6-4f58-be7c-f37c87c1c2ba>
- `sqr-386-target-cp-private-extraction-direct`:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9c20ad69-dfdf-43df-b186-156331409658>
- `sqr-386-target-cp-private-extraction-injection`:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/5b349595-ff8f-4728-97d8-8608933b8845>

Clean suites:

- Adversarial boundary:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c9896795-2ef3-4904-9b86-ae537bccd4f6>
- Cross-game boundary:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a192ab2e-7f2d-4e8b-8d14-b0e781d89850>
- Campaign personalization:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/7a90bfe1-5f31-4801-89dd-9534a14b10bf>
  and
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/081ba752-fdc7-4285-b5b4-f975dc342080>
- Campaign writes:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/31e9e20a-5c39-4cc9-bda8-cd33050433ce>
  and
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/0faedba4-2bcc-4cad-a002-fd63cce24601>
- Table QA:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/687a4969-1170-48bf-be95-1300aff9625c>
  and
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/92081725-08c2-4a8e-bf94-14b6aea26c5e>

Estimated eval spend recorded by retained reports:

- guardrail suites: $0.1918 provider + $1.1500 guardrail;
- table QA: $0.7034 provider + $7.5000 guardrail.
