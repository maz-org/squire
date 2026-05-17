import { expect } from 'vitest';

import type { ScenarioSectionBooksExtract } from '../../src/scenario-section-schemas.ts';

export function assertScenarioSectionBookRegressions(extract: ScenarioSectionBooksExtract): void {
  const scenario = extract.scenarios.find(
    (record) => record.ref === 'gloomhavensecretariat:scenario/061',
  );
  const conclusionLink = extract.links.find(
    (record) =>
      record.fromRef === 'gloomhavensecretariat:scenario/061' &&
      record.linkType === 'conclusion' &&
      record.toRef === '67.1',
  );
  const conclusionSection = extract.sections.find((record) => record.ref === '67.1');

  expect(scenario).toBeDefined();
  expect(conclusionLink).toBeDefined();
  expect(conclusionSection).toBeDefined();
  expect(conclusionSection!.text).toContain('Your ears fill with the sound of your own breathing');
  expect(conclusionSection!.text).toContain('Moonshard answers.');
  expect(conclusionSection!.text).toContain('the seals grow weak.');
  expect(conclusionSection!.text).not.toContain('ownbreathing');
  expect(conclusionSection!.text).not.toContain('Moonshardanswers');

  const synthetic = extract.scenarios.find((record) => record.ref === 'printed-book:scenario/074');
  expect(synthetic).toBeDefined();
  expect(synthetic!.name).toBe('Gaps in the Road');
  expect(synthetic!.sourcePdf).toMatch(/^fh-scenario-book-\d+-\d+\.pdf$/);
  expect(synthetic!.sourcePage).not.toBeNull();
  expect(synthetic!.rawText).toContain('Gaps in the Road');

  const spacedRefSection = extract.sections.find((record) => record.ref === '37.1');
  expect(spacedRefSection).toBeDefined();
  expect(spacedRefSection!.text).toContain('harsh trek through deep');

  const wrappedSection = extract.sections.find((record) => record.ref === '80.4');
  expect(wrappedSection).toBeDefined();
  expect(wrappedSection!.text).toContain('You settle into a booth at the Boiled Crab tavern');
  expect(wrappedSection!.text).not.toContain('Boiled Crabtavern');

  const scenarioDoorLink = extract.links.find(
    (record) =>
      record.fromRef === 'gloomhavensecretariat:scenario/087' &&
      record.linkType === 'read_now' &&
      record.toRef === '77.2',
  );
  expect(scenarioDoorLink).toBeDefined();

  expect(extract.sections.find((record) => record.ref === '33.3')).toBeDefined();
  expect(extract.sections.find((record) => record.ref === '33.4')).toBeDefined();
  expect(extract.sections.find((record) => record.ref === '94.3')).toBeDefined();
  expect(extract.sections.find((record) => record.ref === '136.4')).toBeDefined();

  const rewardSection = extract.sections.find((record) => record.ref === '21.3');
  const rewardUnlock = extract.links.find(
    (record) => record.fromRef === '21.3' && record.linkType === 'unlock',
  );
  expect(rewardSection).toBeDefined();
  expect(rewardSection!.text).toContain('New Scenario:');
  expect(rewardSection!.text).toContain('Uniting the Crown');
  expect(rewardSection!.text).toContain('60');
  expect(rewardUnlock).toBeDefined();
  expect(rewardUnlock!.toRef).toBe('gloomhavensecretariat:scenario/060');

  const repairedSection = extract.sections.find((record) => record.ref === '66.2');
  const repairedUnlock = extract.links.find(
    (record) => record.fromRef === '66.2' && record.linkType === 'unlock',
  );
  expect(repairedSection).toBeDefined();
  expect(repairedSection!.text).toContain('Caravan Guards');
  expect(repairedUnlock).toBeDefined();
  expect(repairedUnlock!.toRef).toBe('gloomhavensecretariat:scenario/116');

  const protectedSection = extract.sections.find((record) => record.ref === '66.3');
  expect(protectedSection).toBeDefined();
  expect(protectedSection!.text).not.toContain(
    'Your ears fill with the sound of your own breathing',
  );
  expect(protectedSection!.text).not.toContain('Add section 140.3');
  expect(protectedSection!.text).toContain('Section Links');
  expect(protectedSection!.text).toContain('The Harbinger of Shadow 1 is now active.');
}
