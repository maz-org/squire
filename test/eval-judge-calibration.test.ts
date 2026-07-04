import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH,
  buildJudgeCalibrationReport,
  formatJudgeCalibrationMarkdown,
  loadJudgeCalibrationFixture,
  resolveJudgeCalibrationItems,
  runJudgeCalibration,
  type JudgeCalibrationFixture,
} from '../eval/judge-calibration.ts';

describe('judge calibration', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('loads a 50-item dev-only table-qa reference fixture across both supported games', () => {
    const fixture = loadJudgeCalibrationFixture();
    const items = resolveJudgeCalibrationItems(fixture);

    expect(fixture.items).toHaveLength(50);
    expect(new Set(items.map((item) => item.game))).toEqual(
      new Set(['frosthaven', 'gloomhaven-2e']),
    );
    expect(items.every((item) => item.evalCase.suite === 'table-qa')).toBe(true);
    expect(items.every((item) => item.evalCase.split === 'dev')).toBe(true);
    expect(items.every((item) => item.evalCase.finalAnswer)).toBe(true);
    expect(items.filter((item) => item.expectedPass)).toHaveLength(26);
    expect(items.filter((item) => !item.expectedPass)).toHaveLength(24);
  });

  it('rejects calibration entries that point at holdout cases', () => {
    const fixture: JudgeCalibrationFixture = {
      ...loadJudgeCalibrationFixture(),
      items: [
        {
          id: 'bad-holdout',
          caseId: 'gh2-prod-monster-ranged-disadvantage-trap-path',
          game: 'gloomhaven-2e',
          expectedPass: true,
          actualAnswer: 'A monster should prefer the trap path.',
          rationale: 'Unit test fixture.',
        },
      ],
    };

    expect(() => resolveJudgeCalibrationItems(fixture)).toThrow(/uses split holdout/);
  });

  it('rejects calibration entries with mismatched game metadata', () => {
    const fixture: JudgeCalibrationFixture = {
      ...loadJudgeCalibrationFixture(),
      items: [
        {
          id: 'bad-game',
          caseId: 'item-spyglass',
          game: 'gloomhaven-2e',
          expectedPass: true,
          actualAnswer: 'Spyglass gives advantage.',
          rationale: 'Unit test fixture.',
        },
      ],
    };

    expect(() => resolveJudgeCalibrationItems(fixture)).toThrow(/declares gloomhaven-2e/);
  });

  it('computes agreement and writes JSON plus Markdown reports without API keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'squire-judge-calibration-'));
    tempDirs.push(dir);
    const reportJsonPath = join(dir, 'report.json');
    const reportMarkdownPath = join(dir, 'report.md');
    const fixture = loadJudgeCalibrationFixture();

    const report = await runJudgeCalibration({
      fixturePath: DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH,
      reportJsonPath,
      reportMarkdownPath,
      now: new Date('2026-07-04T20:00:00.000Z'),
      logProgress: false,
      judge: async (item) => ({
        score: item.expectedPass ? 5 : 1,
        pass: item.expectedPass,
        reasoning: `stubbed ${item.expectedPass ? 'pass' : 'fail'}`,
      }),
    });

    expect(report.summary).toMatchObject({
      totalItems: fixture.items.length,
      agreedItems: fixture.items.length,
      disagreedItems: 0,
      agreementRate: 1,
      thresholdPass: true,
    });
    expect(report.summary.byGame.frosthaven.totalItems).toBe(25);
    expect(report.summary.byGame['gloomhaven-2e'].totalItems).toBe(25);
    expect(formatJudgeCalibrationMarkdown(report)).toContain('Calibration gate | pass');
  });

  it('marks calibration below the threshold when the judge disagrees too often', () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index}`,
      caseId: `case-${index}`,
      game: index % 2 === 0 ? ('frosthaven' as const) : ('gloomhaven-2e' as const),
      expectedPass: true,
      actualPass: index < 8,
      score: index < 8 ? 4 : 2,
      agreement: index < 8,
      reasoning: 'unit test',
      rationale: 'unit test',
    }));

    const report = buildJudgeCalibrationReport({
      fixturePath: DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH,
      results,
      now: new Date('2026-07-04T20:00:00.000Z'),
    });

    expect(report.summary).toMatchObject({
      agreedItems: 8,
      disagreedItems: 2,
      agreementRate: 0.8,
      thresholdPass: false,
    });
    expect(formatJudgeCalibrationMarkdown(report)).toContain('Calibration gate | fail');
  });

  it('rejects duplicate item ids in custom fixtures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squire-judge-calibration-'));
    tempDirs.push(dir);
    const path = join(dir, 'fixture.json');
    const fixture = loadJudgeCalibrationFixture();
    writeFileSync(
      path,
      `${JSON.stringify({ ...fixture, items: [fixture.items[0], fixture.items[0]] }, null, 2)}\n`,
    );

    expect(() => resolveJudgeCalibrationItems(loadJudgeCalibrationFixture(path))).toThrow(
      /Duplicate judge calibration item id/,
    );
  });
});
