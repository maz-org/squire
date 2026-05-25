/**
 * Build a GH2 scenario/section extract from GHS structured metadata.
 *
 * Unlike the Frosthaven PDF extractor, this does not have printed section
 * prose. It imports scenario metadata and section stubs so scenario/section
 * lookup and traversal work for GH2 without inventing unavailable text.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DEFAULT_GAME_ID } from './game.ts';
import { writeExtractedRecords } from './extracted-paths.ts';
import { importScenarios } from './import-scenarios.ts';
import { resolveGhsImporterConfig, type GhsImporterConfigInput } from './ghs-utils.ts';
import {
  ScenarioSectionBooksExtractSchema,
  type BookReferenceRecord,
  type ScenarioBookScenarioRecord,
  type ScenarioSectionBooksExtract,
  type SectionBookSectionRecord,
} from './scenario-section-schemas.ts';

interface GhsSection {
  index: string;
  name?: string;
  edition: string;
  parent?: string;
  monsters?: string[];
  rooms?: unknown[];
  [key: string]: unknown;
}

function scenarioToBookRecord(scenario: Record<string, unknown>): ScenarioBookScenarioRecord {
  return {
    ref: scenario.sourceId as string,
    scenarioGroup: scenario.scenarioGroup as 'main' | 'solo' | 'random',
    scenarioIndex: scenario.index as string,
    name: scenario.name as string,
    complexity: (scenario.complexity as number | null | undefined) ?? null,
    flowChartGroup: (scenario.flowChartGroup as string | null | undefined) ?? null,
    initial: (scenario.initial as boolean | undefined) ?? false,
    sourcePdf: null,
    sourcePage: null,
    rawText: null,
    metadata: {
      sourceId: scenario.sourceId as string,
      monsters: (scenario.monsters as string[] | undefined) ?? [],
      allies: (scenario.allies as string[] | undefined) ?? [],
      unlocks: (scenario.unlocks as string[] | undefined) ?? [],
      requirements: (scenario.requirements as Array<Record<string, unknown>> | undefined) ?? [],
      objectives:
        (scenario.objectives as Array<{ name: string; escort?: boolean }> | undefined) ?? [],
      rewards: (scenario.rewards as string | null | undefined) ?? null,
      lootDeckConfig: (scenario.lootDeckConfig as Record<string, number> | undefined) ?? {},
    },
  };
}

function sectionText(section: GhsSection): string {
  const parts = [`Section ${section.index}: ${section.name ?? 'Untitled section'}.`];
  if (section.parent) parts.push(`Parent scenario: ${section.parent}.`);
  if (section.monsters?.length) parts.push(`Monsters: ${section.monsters.join(', ')}.`);
  else parts.push('No listed monsters.');
  if (section.rooms?.length) parts.push(`Structured rooms: ${section.rooms.length}.`);
  return parts.join(' ');
}

function sectionToBookRecord(file: string, section: GhsSection): SectionBookSectionRecord {
  const [sectionNumber, sectionVariant] = section.index.split('.').map(Number);
  return {
    ref: section.index,
    sectionNumber,
    sectionVariant,
    sourcePdf: `gloomhavensecretariat:sections/${file}`,
    sourcePage: 0,
    text: sectionText(section),
    metadata: {
      source: 'gloomhavensecretariat',
      name: section.name ?? null,
      parent: section.parent ?? null,
      monsters: section.monsters ?? [],
      rooms: section.rooms ?? [],
    },
  };
}

export function importGhsScenarioSectionBooks(
  configInput: GhsImporterConfigInput = {},
): ScenarioSectionBooksExtract {
  const config = resolveGhsImporterConfig(configInput);
  if (config.game === DEFAULT_GAME_ID) {
    throw new Error('importGhsScenarioSectionBooks is for non-Frosthaven GHS section metadata.');
  }

  const scenarios = importScenarios(config).map((scenario) =>
    scenarioToBookRecord(scenario as unknown as Record<string, unknown>),
  );
  const scenarioRefByIndex = new Map(
    scenarios.map((scenario) => [scenario.scenarioIndex, scenario.ref]),
  );
  const sectionsDir = join(config.dataDir, 'sections');
  const sections: SectionBookSectionRecord[] = [];
  const links: BookReferenceRecord[] = [];

  if (existsSync(sectionsDir)) {
    for (const file of readdirSync(sectionsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const section = JSON.parse(readFileSync(join(sectionsDir, file), 'utf-8')) as GhsSection;
      if (!/^\d+\.\d+$/.test(section.index)) continue;
      const record = sectionToBookRecord(file, section);
      sections.push(record);

      const parentRef = section.parent
        ? scenarioRefByIndex.get(String(Number(section.parent)))
        : null;
      if (parentRef) {
        links.push({
          fromKind: 'section',
          fromRef: record.ref,
          toKind: 'scenario',
          toRef: parentRef,
          linkType: 'cross_reference',
          rawLabel: section.name ?? null,
          rawContext: `GHS section parent ${section.parent}`,
          sequence: links.length,
        });
      }
    }
  }

  return ScenarioSectionBooksExtractSchema.parse({
    scenarios,
    sections,
    links,
    warnings: [
      `${config.game}: section records are GHS metadata summaries, not printed section prose.`,
    ],
  });
}

if (process.argv[1]?.endsWith(basename(import.meta.url))) {
  const config = resolveGhsImporterConfig();
  const extract = importGhsScenarioSectionBooks(config);
  const outputPath = writeExtractedRecords('scenario-section-books', config.game, extract);
  console.log(
    `Wrote ${extract.scenarios.length} scenarios, ${extract.sections.length} sections, and ${extract.links.length} links to ${outputPath}`,
  );
}
