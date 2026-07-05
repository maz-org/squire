# SQR-379 Table-QA Judge Calibration

Generated: 2026-07-05T21:56:47.152Z

## Summary

| Metric                | Value                                            |
| --------------------- | ------------------------------------------------ |
| Fixture               | `eval/judge-calibration/table-qa-reference.json` |
| Suite                 | `table-qa`                                       |
| Split                 | `dev`                                            |
| Judge model           | `claude-haiku-4-5-20251001`                      |
| Judge prompt version  | `table-qa-answer-judge-v2`                       |
| Judge prompt changed  | no                                               |
| Estimated judge spend | $0.0080                                          |
| Agreement             | 29/32 (90.6%)                                    |
| Required agreement    | 85.0%                                            |
| Calibration gate      | pass                                             |

## By Game

| Game          | Agreement     |
| ------------- | ------------- |
| Frosthaven    | 21/23 (91.3%) |
| Gloomhaven 2e | 8/9 (88.9%)   |

## Disagreements

| Case                              | Expected | Judge | Score | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fh-scenario-7-edge-of-the-world` | fail     | pass  | 4/5   | Required parts: (1) scenario name, (2) unlocks, (3) rewards, (4) monsters. The actual answer correctly identifies scenario 7 as 'Edge of the World' (Frosthaven, not another game). It correctly states unlocks as scenarios 13 and 14. It correctly lists rewards as 10 XP and campaign sticker coral-shard. However, the monsters list is entirely absent—the answer does not mention Lurker Clawcrusher or Lurker Soldier. This is an omission of a required part. Per hard failure rules, this caps the score at 3 maximum. However, the omission is minor (one of four required elements), the three present elements are entirely correct, and the answer is otherwise well-structured and usable at a game table for most purposes. Score 4 reflects that all explicitly stated content is accurate, but the missing monsters list prevents a perfect score. |
| `fh-scenario-3-algox-offensive`   | fail     | pass  | 5/5   | REQUIRED PARTS: (1) Scenario 3 name, (2) Unlock information, (3) Reward information, (4) Monster list, (5) Frosthaven game confirmation. All present and correct. The actual answer identifies the scenario as 'Algox Offensive' ✓, states it unlocks 'Scenario 4A' ✓, confirms no explicit rewards (null field) ✓, and lists all four monster types (Algox Archer, Algox Guard, Algox Priest, Hound) ✓. The answer is clearly from Frosthaven (references Scenario Book 2-21, Copperneck Mountains, Frosthaven-specific mechanics) ✓. Extra detail (complexity, location, loot deck breakdown, goal mechanics, section references) adds helpful context without contradicting the expected answer. Perfect execution.                                                                                                                                              |
| `gh2-scenario-1-bandit-camp`      | fail     | pass  | 4/5   | Required parts: (1) scenario name, (2) unlocks information, (3) rewards information, (4) monsters information. The actual answer correctly identifies Bandit Camp as scenario 1 (✓), correctly states it unlocks scenario 2 (✓), and correctly states the reward as 10 gold (✓). However, the monsters information is entirely absent from the actual answer (✗ omission of required part). This is a hard failure rule violation (OMISSION), which caps the score at 3 maximum. However, the answer is otherwise accurate and complete for three of four required parts, making it functionally usable at a game table for most purposes. Score 4 is appropriate because the omission is a single element (monsters) rather than a fundamental misunderstanding, and the three present parts are entirely correct.                                                 |

## Notes

- This calibration uses only `table-qa` dev cases. Holdout cases were not used.
- Safety, groundedness, and source-boundary scoring remain deterministic and separate from this semantic answer judge.
- Judge prompt changes invalidate comparisons. This run did not change the judge prompt.
