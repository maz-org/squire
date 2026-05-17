import { beforeAll, describe, it } from 'vitest';

import { importScenarioSectionBooks } from '../src/import-scenario-section-books.ts';
import { assertScenarioSectionBookRegressions } from './helpers/scenario-section-book-assertions.ts';

describe('importScenarioSectionBooks real PDF extraction', () => {
  let extract: Awaited<ReturnType<typeof importScenarioSectionBooks>>;

  beforeAll(async () => {
    extract = await importScenarioSectionBooks();
  }, 120000);

  it('preserves scenario and section extraction regressions from the printed PDFs', () => {
    assertScenarioSectionBookRegressions(extract);
  });
});
