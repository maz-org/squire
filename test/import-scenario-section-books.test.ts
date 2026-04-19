import { beforeAll, describe, expect, it } from 'vitest';

import { importScenarioSectionBooks } from '../src/import-scenario-section-books.ts';

describe('importScenarioSectionBooks', () => {
  let extract: Awaited<ReturnType<typeof importScenarioSectionBooks>>;

  beforeAll(async () => {
    extract = await importScenarioSectionBooks();
  }, 30000);

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
    expect(section!.text).toContain('Your ears fill with the sound of your own breathing');
    expect(section!.text).toContain('Moonshard answers.');
    expect(section!.text).toContain('the seals grow weak.');
    expect(section!.text).not.toContain('ownbreathing');
    expect(section!.text).not.toContain('Moonshardanswers');
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

  it('preserves spaces when flattening wrapped section prose like 80.4', () => {
    const section = extract.sections.find((record) => record.ref === '80.4');
    expect(section).toBeDefined();
    expect(section!.text).toContain('You settle into a booth at the Boiled Crab tavern');
    expect(section!.text).not.toContain('Boiled Crabtavern');
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

  it('restores real section entries that sit below section-link boxes', () => {
    expect(extract.sections.find((record) => record.ref === '33.3')).toBeDefined();
    expect(extract.sections.find((record) => record.ref === '33.4')).toBeDefined();
    expect(extract.sections.find((record) => record.ref === '94.3')).toBeDefined();
    expect(extract.sections.find((record) => record.ref === '136.4')).toBeDefined();
  });

  it('keeps reward unlock numbers with the owning section text and links', () => {
    const section = extract.sections.find((record) => record.ref === '21.3');
    const unlock = extract.links.find(
      (record) => record.fromRef === '21.3' && record.linkType === 'unlock',
    );

    expect(section).toBeDefined();
    expect(section!.text).toContain('New Scenario:');
    expect(section!.text).toContain('Uniting the Crown');
    expect(section!.text).toContain('60');
    expect(unlock).toBeDefined();
    expect(unlock!.toRef).toBe('gloomhavensecretariat:scenario/060');
  });

  it('does not let later section prose overwrite 66.3 while keeping its own links', () => {
    const section = extract.sections.find((record) => record.ref === '66.3');
    expect(section).toBeDefined();
    expect(section!.text).not.toContain('Your ears fill with the sound of your own breathing');
    expect(section!.text).not.toContain('Add section 140.3');
    expect(section!.text).toContain('Section Links');
    expect(section!.text).toContain('The Harbinger of Shadow 1 is now active.');
  });
});
