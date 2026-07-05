import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('loads the frozen human-labeled dev-only reference fixture across both games', () => {
    const fixture = loadJudgeCalibrationFixture();
    const items = resolveJudgeCalibrationItems(fixture);

    expect(fixture.version).toBe(2);
    expect(fixture.items).toHaveLength(32);
    expect(new Set(items.map((item) => item.game))).toEqual(
      new Set(['frosthaven', 'gloomhaven-2e']),
    );
    expect(items.every((item) => item.evalCase.suite === 'table-qa')).toBe(true);
    expect(items.every((item) => item.evalCase.split === 'dev')).toBe(true);
    expect(items.every((item) => item.evalCase.finalAnswer)).toBe(true);
    expect(items.filter((item) => item.expectedPass)).toHaveLength(14);
    expect(items.filter((item) => !item.expectedPass)).toHaveLength(18);
    // Epoch-2 frozen references: every verdict carries human-labeling provenance.
    expect(items.every((item) => /^brian-\d{4}-\d{2}-\d{2}-batch/.test(item.provenance))).toBe(
      true,
    );
  });

  it('allows distinct answers per case but rejects a duplicated answer', () => {
    const fixture = loadJudgeCalibrationFixture();
    const blurryJab = fixture.items.filter(
      (item) => item.caseId === 'fh-character-ability-blinkblade-blurry-jab',
    );
    // Distinct failure modes for one case (honest data-gap vs hallucinated
    // tiebreaker) are legitimate separate references.
    expect(blurryJab.length).toBeGreaterThanOrEqual(2);

    const duplicated: JudgeCalibrationFixture = {
      ...fixture,
      items: [fixture.items[0]!, { ...fixture.items[0]!, id: 'duplicate-answer-different-id' }],
    };
    expect(() => resolveJudgeCalibrationItems(duplicated)).toThrow(
      /Duplicate judge calibration answer/,
    );
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
          provenance: 'unit-test',
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
          provenance: 'unit-test',
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
    expect(report.summary.byGame.frosthaven.totalItems).toBe(23);
    expect(report.summary.byGame['gloomhaven-2e'].totalItems).toBe(9);
    expect(formatJudgeCalibrationMarkdown(report)).toContain('Calibration gate | pass');
    expect(JSON.parse(readFileSync(reportJsonPath, 'utf-8'))).toEqual(report);
    expect(readFileSync(reportMarkdownPath, 'utf-8')).toBe(formatJudgeCalibrationMarkdown(report));
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
      reasoning: index === 8 ? 'line one\nline two | pipe' : 'unit test',
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
    const markdown = formatJudgeCalibrationMarkdown(report);
    expect(markdown).toContain('Calibration gate | fail');
    expect(markdown).toContain('line one line two \\| pipe');
    expect(markdown).not.toContain('line one\nline two');
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
