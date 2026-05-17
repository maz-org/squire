import { readFile } from 'node:fs/promises';

import { describe, it } from 'vitest';

import { ScenarioSectionBooksExtractSchema } from '../src/scenario-section-schemas.ts';
import { assertScenarioSectionBookRegressions } from './helpers/scenario-section-book-assertions.ts';

async function readCheckedInExtract() {
  const raw = await readFile(
    new URL('../data/extracted/scenario-section-books.json', import.meta.url),
    'utf8',
  );
  return ScenarioSectionBooksExtractSchema.parse(JSON.parse(raw));
}

describe('checked-in scenario/section book extract', () => {
  it('preserves parser regression coverage in the fast test path', async () => {
    const extract = await readCheckedInExtract();

    assertScenarioSectionBookRegressions(extract);
  });
});
