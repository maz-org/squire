import { beforeAll, describe, expect, it } from 'vitest';

import { importTraversal } from '../src/import-traversal.ts';

describe('importTraversal', () => {
  let extract: Awaited<ReturnType<typeof importTraversal>>;

  beforeAll(async () => {
    extract = await importTraversal();
  });

  it('builds the scenario 61 conclusion path to section 90.2', () => {
    const scenario = extract.scenarios.find(
      (record) => record.ref === 'gloomhavensecretariat:scenario/061',
    );
    const link = extract.links.find(
      (record) =>
        record.fromRef === 'gloomhavensecretariat:scenario/061' &&
        record.linkType === 'conclusion' &&
        record.toRef === '90.2',
    );
    const section = extract.sections.find((record) => record.ref === '90.2');

    expect(scenario).toBeDefined();
    expect(link).toBeDefined();
    expect(section).toBeDefined();
    expect(section!.text).toContain('The ritual and the battle');
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
});
