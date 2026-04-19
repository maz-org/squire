import { beforeAll, describe, expect, it } from 'vitest';

import { importScenarioSectionBooks } from '../src/import-scenario-section-books.ts';

describe('importScenarioSectionBooks', () => {
  let extract: Awaited<ReturnType<typeof importScenarioSectionBooks>>;

  beforeAll(async () => {
    extract = await importScenarioSectionBooks();
  });

  it('builds the scenario 61 conclusion path to section 67.1', () => {
    const scenario = extract.scenarios.find(
      (record) => record.ref === 'gloomhavensecretariat:scenario/061',
    );
    const link = extract.links.find(
      (record) =>
        record.fromRef === 'gloomhavensecretariat:scenario/061' &&
        record.linkType === 'conclusion' &&
        record.toRef === '67.1',
    );
    const section = extract.sections.find((record) => record.ref === '67.1');

    expect(scenario).toBeDefined();
    expect(link).toBeDefined();
    expect(section).toBeDefined();
    expect(section!.text).toContain('Your ears fill with the sound of your own');
    expect(section!.text).toContain('seals grow weak.');
  });

  it('synthesizes printed-only scenarios when the checked-in scenario extract lacks them', () => {
    const synthetic = extract.scenarios.find(
      (record) => record.ref === 'printed-book:scenario/074',
    );
    expect(synthetic).toBeDefined();
    expect(synthetic!.name).toBe('Gaps in the Road');
  });

  it('recovers spaced OCR section refs like 37.1 from the section book', () => {
    const section = extract.sections.find((record) => record.ref === '37.1');
    expect(section).toBeDefined();
    expect(section!.text).toContain('harsh trek through deep');
  });

  it('repairs obviously broken section bodies like 80.1 from linear PDF text', () => {
    const section = extract.sections.find((record) => record.ref === '80.1');
    expect(section).toBeDefined();
    expect(section!.text).toContain('You settle into a booth at the Boiled Crab');
  });

  it('captures spaced section refs from scenario link boxes like scenario 87 door 3', () => {
    const link = extract.links.find(
      (record) =>
        record.fromRef === 'gloomhavensecretariat:scenario/087' &&
        record.linkType === 'read_now' &&
        record.toRef === '77.2',
    );
    expect(link).toBeDefined();
  });
});
