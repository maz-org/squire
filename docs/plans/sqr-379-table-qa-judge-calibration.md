# SQR-379 Table-QA Judge Calibration

Generated: 2026-07-04T20:21:42.341Z

## Summary

| Metric                | Value                                            |
| --------------------- | ------------------------------------------------ |
| Fixture               | `eval/judge-calibration/table-qa-reference.json` |
| Suite                 | `table-qa`                                       |
| Split                 | `dev`                                            |
| Judge model           | `claude-haiku-4-5-20251001`                      |
| Judge prompt version  | `table-qa-answer-judge-v1`                       |
| Judge prompt changed  | no                                               |
| Estimated judge spend | $0.0125                                          |
| Agreement             | 50/50 (100.0%)                                   |
| Required agreement    | 85.0%                                            |
| Calibration gate      | pass                                             |

## By Game

| Game          | Agreement      |
| ------------- | -------------- |
| Frosthaven    | 25/25 (100.0%) |
| Gloomhaven 2e | 25/25 (100.0%) |

## Disagreements

| Case | Expected | Judge | Score | Reasoning |
| ---- | -------- | ----- | ----- | --------- |
| None | -        | -     | -     | -         |

## Notes

- This calibration uses only `table-qa` dev cases. Holdout cases were not used.
- Safety, groundedness, and source-boundary scoring remain deterministic and separate from this semantic answer judge.
- Judge prompt changes invalidate comparisons. This run did not change the judge prompt.
