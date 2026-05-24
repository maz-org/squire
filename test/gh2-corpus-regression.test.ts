import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { chunkText, htmlToIndexText } from '../src/index-docs.ts';
import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import { ruleSourceProvenance } from '../src/rule-source-provenance.ts';
import type { RuleSourceType } from '../src/rule-source-provenance.ts';

interface Gh2CorpusQuery {
  id: string;
  query: string;
  expectedSource: string;
  expectedSourceType: RuleSourceType;
  requiredPhrases: string[];
  forbiddenSourcePrefixes: string[];
  evalSeed: {
    expected: string;
    grading: string;
  };
}

const SAMPLE_QUERY_PATH = join(import.meta.dirname, 'fixtures', 'search-queries', 'gh2-rules.json');

function loadSampleQueries(): Gh2CorpusQuery[] {
  return JSON.parse(readFileSync(SAMPLE_QUERY_PATH, 'utf8')) as Gh2CorpusQuery[];
}

function sourceText(source: string): string {
  const sourcePath = join(import.meta.dirname, '..', 'data', 'rule-sources', source);
  const raw = readFileSync(sourcePath, 'utf8');
  return source.endsWith('.html') ? htmlToIndexText(raw) : raw;
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('GH2 corpus regression sample queries', () => {
  it('covers rulebook, FAQ, and errata/current-rule source types', () => {
    const sampleQueries = loadSampleQueries();

    expect(sampleQueries.map((sample) => sample.expectedSourceType).sort()).toEqual([
      'errata',
      'faq',
      'rulebook',
    ]);
    expect(sampleQueries.map((sample) => sample.id).sort()).toEqual([
      'gh2-errata-campaign-sheet-section-29',
      'gh2-faq-red-hex-aoe-targets',
      'gh2-rule-scenario-level',
    ]);
  });

  it('keeps each answerable source passage in an indexed chunk with GH2-only citations', () => {
    for (const sample of loadSampleQueries()) {
      const text = sourceText(sample.expectedSource);
      const chunks = chunkText(text, sample.expectedSource);
      const requiredPhrases = sample.requiredPhrases.map(normalizedText);
      const matchingChunk = chunks.find((chunk) => {
        const chunkText = normalizedText(chunk.text);
        return requiredPhrases.every((phrase) => chunkText.includes(phrase));
      });

      expect(matchingChunk, `missing indexed chunk for ${sample.id}`).toBeDefined();
      expect(sample.forbiddenSourcePrefixes).toContain('fh-');
      expect(sample.expectedSource).not.toMatch(/^fh-/);

      const provenance = ruleSourceProvenance(sample.expectedSource, GLOOMHAVEN_2E_GAME_ID);
      expect(provenance.game).toBe(GLOOMHAVEN_2E_GAME_ID);
      expect(provenance.sourceType).toBe(sample.expectedSourceType);
      expect(provenance.sourceRef).toMatch(/^source:gloomhaven-2e\//);
      expect(provenance.sourceRef).not.toContain('source:frosthaven/');
    }
  });

  it('stores eval-seed expectations with source-citation grading requirements', () => {
    for (const sample of loadSampleQueries()) {
      expect(normalizedText(sample.evalSeed.expected)).toContain(
        normalizedText(sample.requiredPhrases.at(-1) ?? ''),
      );
      expect(sample.evalSeed.grading).toMatch(/Gloomhaven 2\.0|GH2/);
      expect(sample.evalSeed.grading).toMatch(/cite|citation|source/i);
      expect(sample.evalSeed.grading).toMatch(new RegExp(sample.expectedSourceType, 'i'));
      expect(sample.evalSeed.grading).toMatch(/avoid.*Frosthaven citation/i);
    }
  });
});
