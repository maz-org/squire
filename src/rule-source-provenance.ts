import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import type { GameId } from './game.ts';

export type RuleSourceType =
  | 'rulebook'
  | 'faq'
  | 'errata'
  | 'puzzle_book'
  | 'scenario_book'
  | 'section_book'
  | 'unknown';

export interface RuleSourceFreshness {
  capturedAt: string;
  sourceLastUpdated?: string;
}

interface RuleSourceMetadata {
  id: string;
  file: string;
  normalizedFile?: string;
  game: GameId;
  sourceType: RuleSourceType;
  sourceUrl: string;
  capturedAt: string;
  sourceLastUpdated?: string;
  refreshNotes: string;
}

export interface RuleSourceProvenance {
  game: GameId;
  sourceType: RuleSourceType;
  sourceLabel: string;
  sourceRef: string;
  sourceUrl?: string;
  freshness?: RuleSourceFreshness;
}

const SOURCE_SUFFIX = /\.(pdf|html?|md|txt)$/i;

function sourceStem(source: string): string {
  const extension = extname(source);
  return extension ? source.slice(0, -extension.length) : source;
}

function formatSourceLabel(source: string): string {
  const stem = sourceStem(source);

  if (/-rule-book$/i.test(stem)) return 'Rulebook';
  if (/-puzzle-book$/i.test(stem)) return 'Puzzle Book';
  if (/-faq$/i.test(stem)) return 'FAQ';
  if (/-errata$/i.test(stem)) return 'Errata';

  const scenarioMatch = stem.match(/-scenario-book-(.+)$/i);
  if (scenarioMatch) return `Scenario Book ${scenarioMatch[1]}`;

  const sectionMatch = stem.match(/-section-book-(.+)$/i);
  if (sectionMatch) return `Section Book ${sectionMatch[1]}`;

  return stem;
}

function inferSourceType(source: string): RuleSourceType {
  const stem = sourceStem(source);
  if (/-rule-book$/i.test(stem)) return 'rulebook';
  if (/-puzzle-book$/i.test(stem)) return 'puzzle_book';
  if (/-faq$/i.test(stem)) return 'faq';
  if (/-errata$/i.test(stem)) return 'errata';
  if (/-scenario-book-/i.test(stem)) return 'scenario_book';
  if (/-section-book-/i.test(stem)) return 'section_book';
  return 'unknown';
}

function readMetadata(): RuleSourceMetadata[] {
  const raw = readFileSync(new URL('../data/rule-sources/metadata.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as RuleSourceMetadata[];
}

const METADATA_BY_INDEXED_BASENAME = new Map<string, RuleSourceMetadata>();
for (const source of readMetadata()) {
  for (const file of [source.file, source.normalizedFile].filter(
    (value): value is string => typeof value === 'string',
  )) {
    METADATA_BY_INDEXED_BASENAME.set(basename(file), source);
  }
}

export function formatRetrievalSourceLabel(source: string): string {
  return formatSourceLabel(source.replace(SOURCE_SUFFIX, ''));
}

export function ruleSourceLocator(chunkIndex: number): string {
  return `passage ${chunkIndex + 1}`;
}

export function ruleSourceProvenance(source: string, game: GameId): RuleSourceProvenance {
  const metadata = METADATA_BY_INDEXED_BASENAME.get(basename(source));
  const sourceType = metadata?.sourceType ?? inferSourceType(source);
  const sourceRefId = metadata?.id ?? sourceStem(source);

  return {
    game: metadata?.game ?? game,
    sourceType,
    sourceLabel: formatSourceLabel(source),
    sourceRef: `source:${metadata?.game ?? game}/${sourceRefId}`,
    sourceUrl: metadata?.sourceUrl,
    freshness: metadata
      ? {
          capturedAt: metadata.capturedAt,
          ...(metadata.sourceLastUpdated ? { sourceLastUpdated: metadata.sourceLastUpdated } : {}),
        }
      : undefined,
  };
}
