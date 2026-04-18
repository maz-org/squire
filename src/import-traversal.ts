/**
 * Build the deterministic traversal extract that powers scenario/section
 * research. This joins:
 * - checked-in GHS-derived scenario identity from `data/extracted/scenarios.json`
 * - printed scenario-book links and prose
 * - printed section-book links and section bodies
 *
 * Run with: npx tsx src/import-traversal.ts
 *
 * Output: data/extracted/traversal.json
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pdfParse from 'pdf-parse/lib/pdf-parse.js';

import type {
  TraversalExtract,
  TraversalLinkRecord,
  TraversalLinkType,
  TraversalScenarioRecord,
  TraversalSectionRecord,
} from './traversal-schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_SCENARIOS_PATH = join(__dirname, '..', 'data', 'extracted', 'scenarios.json');
const PDFS_DIR = join(__dirname, '..', 'data', 'pdfs');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'traversal.json');
const PAGE_SENTINEL = '__SQUIRE_PAGE__';

const FOOTER_RE = /2023\s+CEPHALOFAIR|ALL\s+RIGHTS\s+RESERVED|USED\s+WITH\s+PERMISSION/i;
const HEADING_RE =
  /^(Section Links|Special Rules|Rewards|Conclusion|Scenario Goals|Scenario Key|Map Layout|Loot|Introduction|Goal)$/i;
const SECTION_LINK_RE = /^(\d+\.\d+)\s*•\s*(.+?)(?:\((\d+)\))?$/;
const BOOK_RANGE_RE = /^fh-(scenario|section)-book-(\d+)-(\d+)\.pdf$/;

interface SourceScenarioRecord {
  scenarioGroup: 'main' | 'solo' | 'random';
  index: string;
  name: string;
  complexity?: number | null;
  monsters: string[];
  allies: string[];
  unlocks: string[];
  requirements: Array<Record<string, unknown>>;
  objectives: Array<{ name: string; escort?: boolean }>;
  rewards: string | null;
  lootDeckConfig: Record<string, number>;
  flowChartGroup: string | null;
  initial: boolean;
  sourceId: string;
}

interface PdfItem {
  text: string;
  x: number;
  y: number;
}

interface PdfParseTextItem {
  str: string;
  transform: number[];
}

interface PdfParseTextContent {
  items: PdfParseTextItem[];
}

interface PdfParsePageData {
  pageIndex: number;
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<PdfParseTextContent>;
}

interface PdfPage {
  pageIndex: number;
  items: PdfItem[];
}

interface PdfLine {
  text: string;
  x: number;
  y: number;
}

interface SectionEntry {
  ref: string;
  label: string;
  targetScenarioIndex: string | null;
  x: number;
  y: number;
  rawText: string;
}

interface BookRange {
  kind: 'scenario' | 'section';
  start: number;
  end: number;
}

function parseBookRange(pdfName: string): BookRange {
  const match = pdfName.match(BOOK_RANGE_RE);
  if (!match) throw new Error(`Unsupported traversal PDF name: ${pdfName}`);
  return {
    kind: match[1] as 'scenario' | 'section',
    start: Number(match[2]),
    end: Number(match[3]),
  };
}

function loadScenarioSourceRecords(): SourceScenarioRecord[] {
  if (!existsSync(EXTRACTED_SCENARIOS_PATH)) {
    throw new Error(`Missing scenario extract at ${EXTRACTED_SCENARIOS_PATH}`);
  }
  return JSON.parse(readFileSync(EXTRACTED_SCENARIOS_PATH, 'utf-8')) as SourceScenarioRecord[];
}

async function extractPdfPages(pdfName: string): Promise<PdfPage[]> {
  const pdfPath = join(PDFS_DIR, pdfName);
  const buffer = readFileSync(pdfPath);
  const parsePdf = pdfParse as unknown as (
    data: Buffer,
    options: {
      pagerender: (pageData: PdfParsePageData) => Promise<string>;
    },
  ) => Promise<{ text: string }>;
  const rendered = await parsePdf(buffer, {
    pagerender: async (pageData: PdfParsePageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const items = textContent.items
        .map((item) => ({
          text: item.str as string,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        }))
        .filter((item) => item.text.trim().length > 0);
      return `${PAGE_SENTINEL}${JSON.stringify({ pageIndex: pageData.pageIndex, items })}`;
    },
  });

  return rendered.text
    .split(PAGE_SENTINEL)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk) as PdfPage);
}

function normalizeInlineText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function buildLines(items: PdfItem[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PdfItem[] }> = [];

  for (const item of sorted) {
    const current = lines.at(-1);
    if (current && Math.abs(current.y - item.y) <= 3) {
      current.items.push(item);
      current.y = Math.max(current.y, item.y);
      continue;
    }
    lines.push({ y: item.y, items: [item] });
  }

  return lines
    .flatMap((line) => {
      const itemsInLine = [...line.items].sort((a, b) => a.x - b.x);
      const segments: PdfItem[][] = [];
      for (const item of itemsInLine) {
        const current = segments.at(-1);
        if (!current) {
          segments.push([item]);
          continue;
        }
        const previous = current.at(-1)!;
        if (item.x - previous.x > 120) {
          segments.push([item]);
          continue;
        }
        current.push(item);
      }

      return segments.map((segment) => ({
        x: segment[0].x,
        y: line.y,
        text: normalizeInlineText(segment.map((item) => item.text).join('')),
      }));
    })
    .filter((line) => line.text.length > 0);
}

function normalizeBlockText(lines: PdfLine[]): string {
  return lines
    .map((line) => line.text)
    .join('\n')
    .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
    .replace(/([A-Za-z])\n([a-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scenarioPageText(items: PdfItem[]): string {
  const lines = buildLines(items).filter((line) => line.y > 40 && !FOOTER_RE.test(line.text));
  return normalizeBlockText(lines);
}

function parseInstructionLinks(
  fromKind: 'scenario' | 'section',
  fromRef: string,
  text: string,
): Array<Omit<TraversalLinkRecord, 'sequence'>> {
  const flat = text.replace(/\s+/g, ' ').trim();
  const links: Array<Omit<TraversalLinkRecord, 'sequence'>> = [];

  const addLink = (matchIndex: number, targetRef: string, linkType: TraversalLinkType) => {
    const rawContext = flat.slice(
      Math.max(0, matchIndex - 80),
      Math.min(flat.length, matchIndex + 120),
    );
    links.push({
      fromKind,
      fromRef,
      toKind: 'section',
      toRef: targetRef,
      linkType,
      rawLabel: null,
      rawContext: rawContext.trim(),
    });
  };

  for (const match of flat.matchAll(/return to\s+(\d+\.\d+)/gi)) {
    addLink(match.index ?? 0, match[1], 'cross_reference');
  }

  for (const match of flat.matchAll(/read\s+(\d+\.\d+)/gi)) {
    const contextStart = Math.max(0, (match.index ?? 0) - 80);
    const context = flat.slice(contextStart, (match.index ?? 0) + 120);
    const linkType = /scenario is complete|the scenario is complete|at the end of that round/i.test(
      context,
    )
      ? 'conclusion'
      : 'read_now';
    addLink(match.index ?? 0, match[1], linkType);
  }

  return links;
}

function parseScenarioUnlockLinks(
  fromRef: string,
  text: string,
  mainScenariosByIndex: Map<string, SourceScenarioRecord>,
): Array<Omit<TraversalLinkRecord, 'sequence'>> {
  const flat = text.replace(/\s+/g, ' ').trim();
  const links: Array<Omit<TraversalLinkRecord, 'sequence'>> = [];

  for (const match of flat.matchAll(/New Scenario:\s*(.+?)\s+(\d{1,3})\b/g)) {
    const target = mainScenariosByIndex.get(match[2]);
    if (!target) {
      throw new Error(`Traversal import could not resolve scenario ${match[2]} from scenario text`);
    }
    links.push({
      fromKind: 'section',
      fromRef,
      toKind: 'scenario',
      toRef: target.sourceId,
      linkType: 'unlock',
      rawLabel: match[1].trim(),
      rawContext: match[0].trim(),
    });
  }

  return links;
}

function parseSectionEntries(lines: PdfLine[]): SectionEntry[] {
  const entries: SectionEntry[] = [];
  for (const line of lines) {
    const match = line.text.match(SECTION_LINK_RE);
    if (!match) continue;
    entries.push({
      ref: match[1],
      label: normalizeInlineText(match[2]),
      targetScenarioIndex: match[3] ?? null,
      x: line.x,
      y: line.y,
      rawText: line.text,
    });
  }
  return entries;
}

function quadrantFor(
  entry: { x: number; y: number },
  xThreshold: number,
  yThreshold: number,
): string {
  const row = entry.y > yThreshold ? 'top' : 'bottom';
  const col = entry.x < xThreshold ? 'left' : 'right';
  return `${row}-${col}`;
}

function buildSectionsFromPage(
  pdfName: string,
  pageNumber: number,
  items: PdfItem[],
): {
  sections: TraversalSectionRecord[];
  entryLinks: Array<{ entry: SectionEntry; link: Omit<TraversalLinkRecord, 'sequence'> }>;
} {
  const lines = buildLines(items).filter((line) => line.y > 40 && !FOOTER_RE.test(line.text));
  const entries = parseSectionEntries(lines);
  if (entries.length === 0) return { sections: [], entryLinks: [] };

  const entryXs = entries.map((entry) => entry.x).sort((a, b) => a - b);
  const entryYs = entries.map((entry) => entry.y).sort((a, b) => a - b);
  const xThreshold = (entryXs[0] + entryXs.at(-1)!) / 2;
  const yThreshold = (entryYs[0] + entryYs.at(-1)!) / 2;
  const entriesByQuadrant = new Map(
    entries.map((entry) => [quadrantFor(entry, xThreshold, yThreshold), entry]),
  );

  const sections: TraversalSectionRecord[] = [];
  const entryLinks: Array<{ entry: SectionEntry; link: Omit<TraversalLinkRecord, 'sequence'> }> =
    [];

  for (const [quadrant, entry] of entriesByQuadrant.entries()) {
    const quadrantLines = lines.filter((line) => {
      if (line.text === entry.rawText) return false;
      if (HEADING_RE.test(line.text)) return false;
      const lineQuadrant = quadrantFor(line, xThreshold, yThreshold);
      if (lineQuadrant !== quadrant) return false;
      return line.y < entry.y - 8;
    });

    const bodyText = normalizeBlockText(quadrantLines);
    if (!bodyText) continue;

    const [sectionNumber, sectionVariant] = entry.ref.split('.').map(Number);
    sections.push({
      ref: entry.ref,
      sectionNumber,
      sectionVariant,
      sourcePdf: pdfName,
      sourcePage: pageNumber,
      text: bodyText,
      metadata: {
        quadrant,
      },
    });

    if (entry.targetScenarioIndex) {
      entryLinks.push({
        entry,
        link: {
          fromKind: 'section',
          fromRef: entry.ref,
          toKind: 'scenario',
          toRef: entry.targetScenarioIndex,
          linkType: 'section_link',
          rawLabel: entry.label,
          rawContext: entry.rawText,
        },
      });
    }
  }

  return { sections, entryLinks };
}

function addSequencedLinks(
  target: TraversalLinkRecord[],
  links: Array<Omit<TraversalLinkRecord, 'sequence'>>,
): void {
  for (const [sequence, link] of links.entries()) {
    target.push({ ...link, sequence });
  }
}

function buildTraversalExtract(): Promise<TraversalExtract> {
  return (async () => {
    if (!existsSync(PDFS_DIR)) {
      throw new Error(`Missing PDF directory at ${PDFS_DIR}`);
    }

    const sourceScenarios = loadScenarioSourceRecords();
    const mainScenarios = sourceScenarios.filter((scenario) => scenario.scenarioGroup === 'main');
    const mainScenariosByIndex = new Map(
      mainScenarios.map((scenario) => [scenario.index, scenario]),
    );
    const scenariosByRef = new Map<string, TraversalScenarioRecord>();
    const sectionsByRef = new Map<string, TraversalSectionRecord>();
    const links: TraversalLinkRecord[] = [];
    const warnings: string[] = [];

    function ensureScenarioRecord(
      scenarioIndex: string,
      fallbackName: string | null,
    ): TraversalScenarioRecord {
      const structured = mainScenariosByIndex.get(scenarioIndex);
      if (structured) {
        return (
          scenariosByRef.get(structured.sourceId) ?? {
            ref: structured.sourceId,
            scenarioGroup: structured.scenarioGroup,
            scenarioIndex: structured.index,
            name: structured.name,
            complexity: structured.complexity ?? null,
            flowChartGroup: structured.flowChartGroup,
            initial: structured.initial,
            sourcePdf: null,
            sourcePage: null,
            rawText: null,
            metadata: {
              sourceId: structured.sourceId,
              monsters: structured.monsters,
              allies: structured.allies,
              unlocks: structured.unlocks,
              requirements: structured.requirements,
              objectives: structured.objectives,
              rewards: structured.rewards,
              lootDeckConfig: structured.lootDeckConfig,
            },
          }
        );
      }

      const syntheticRef = `printed-book:scenario/${scenarioIndex.padStart(3, '0')}`;
      const existing = scenariosByRef.get(syntheticRef);
      if (existing) return existing;

      warnings.push(
        `Printed traversal data referenced scenario ${scenarioIndex} (${fallbackName ?? 'unknown title'}) without a matching GHS scenario record; synthesized ${syntheticRef}.`,
      );

      const synthetic: TraversalScenarioRecord = {
        ref: syntheticRef,
        scenarioGroup: 'main',
        scenarioIndex,
        name: fallbackName ?? `Scenario ${scenarioIndex}`,
        complexity: null,
        flowChartGroup: null,
        initial: false,
        sourcePdf: null,
        sourcePage: null,
        rawText: null,
        metadata: {
          sourceId: syntheticRef,
          monsters: [],
          allies: [],
          unlocks: [],
          requirements: [],
          objectives: [],
          rewards: null,
          lootDeckConfig: {},
        },
      };
      scenariosByRef.set(syntheticRef, synthetic);
      return synthetic;
    }

    const scenarioBookPdfs = readdirSync(PDFS_DIR)
      .filter((name) => /^fh-scenario-book-\d+-\d+\.pdf$/.test(name))
      .sort();
    for (const pdfName of scenarioBookPdfs) {
      const range = parseBookRange(pdfName);
      const pages = await extractPdfPages(pdfName);

      for (const page of pages) {
        const scenarioNumber = String(range.start + page.pageIndex);
        const source = mainScenariosByIndex.get(scenarioNumber);
        if (!source) {
          warnings.push(
            `No main scenario record found for scenario-book page ${scenarioNumber} (${pdfName})`,
          );
          continue;
        }

        const rawText = scenarioPageText(page.items);
        scenariosByRef.set(source.sourceId, {
          ref: source.sourceId,
          scenarioGroup: source.scenarioGroup,
          scenarioIndex: source.index,
          name: source.name,
          complexity: source.complexity ?? null,
          flowChartGroup: source.flowChartGroup,
          initial: source.initial,
          sourcePdf: pdfName,
          sourcePage: range.start + page.pageIndex,
          rawText,
          metadata: {
            sourceId: source.sourceId,
            monsters: source.monsters,
            allies: source.allies,
            unlocks: source.unlocks,
            requirements: source.requirements,
            objectives: source.objectives,
            rewards: source.rewards,
            lootDeckConfig: source.lootDeckConfig,
          },
        });

        addSequencedLinks(links, parseInstructionLinks('scenario', source.sourceId, rawText));
      }
    }

    for (const scenario of sourceScenarios) {
      if (scenariosByRef.has(scenario.sourceId)) continue;
      scenariosByRef.set(scenario.sourceId, {
        ref: scenario.sourceId,
        scenarioGroup: scenario.scenarioGroup,
        scenarioIndex: scenario.index,
        name: scenario.name,
        complexity: scenario.complexity ?? null,
        flowChartGroup: scenario.flowChartGroup,
        initial: scenario.initial,
        sourcePdf: null,
        sourcePage: null,
        rawText: null,
        metadata: {
          sourceId: scenario.sourceId,
          monsters: scenario.monsters,
          allies: scenario.allies,
          unlocks: scenario.unlocks,
          requirements: scenario.requirements,
          objectives: scenario.objectives,
          rewards: scenario.rewards,
          lootDeckConfig: scenario.lootDeckConfig,
        },
      });
    }

    const sectionBookPdfs = readdirSync(PDFS_DIR)
      .filter((name) => /^fh-section-book-\d+-\d+\.pdf$/.test(name))
      .sort();
    for (const pdfName of sectionBookPdfs) {
      const range = parseBookRange(pdfName);
      const pages = await extractPdfPages(pdfName);

      for (const page of pages) {
        const pageNumber = range.start + page.pageIndex;
        const { sections, entryLinks } = buildSectionsFromPage(pdfName, pageNumber, page.items);
        for (const section of sections) {
          sectionsByRef.set(section.ref, section);
          addSequencedLinks(links, parseInstructionLinks('section', section.ref, section.text));
          addSequencedLinks(
            links,
            parseScenarioUnlockLinks(section.ref, section.text, mainScenariosByIndex),
          );
        }

        addSequencedLinks(
          links,
          entryLinks.map(({ entry, link }) => ({
            ...link,
            toRef: ensureScenarioRecord(link.toRef, entry.label).ref,
          })),
        );
      }
    }

    const validatedLinks = links.filter((link) => {
      if (link.fromKind === 'scenario' && !scenariosByRef.has(link.fromRef)) {
        throw new Error(`Traversal import produced a link from missing scenario ${link.fromRef}`);
      }
      if (link.fromKind === 'section' && !sectionsByRef.has(link.fromRef)) {
        warnings.push(
          `Dropped traversal link from missing section ${link.fromRef} -> ${link.toRef}`,
        );
        return false;
      }
      if (link.toKind === 'scenario' && !scenariosByRef.has(link.toRef)) {
        throw new Error(`Traversal import produced a link to missing scenario ${link.toRef}`);
      }
      if (link.toKind === 'section' && !sectionsByRef.has(link.toRef)) {
        warnings.push(`Dropped traversal link to missing section ${link.fromRef} -> ${link.toRef}`);
        return false;
      }
      return true;
    });

    return {
      scenarios: [...scenariosByRef.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
      sections: [...sectionsByRef.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
      links: validatedLinks,
      warnings,
    };
  })();
}

export async function importTraversal(): Promise<TraversalExtract> {
  return buildTraversalExtract();
}

if (process.argv[1]?.endsWith('import-traversal.ts')) {
  importTraversal()
    .then((extract) => {
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, JSON.stringify(extract, null, 2), 'utf-8');
      console.log(
        `Wrote ${extract.scenarios.length} scenarios, ${extract.sections.length} sections, and ${extract.links.length} links to ${OUTPUT_PATH}`,
      );
      for (const warning of extract.warnings) {
        console.warn(`[import-traversal] ${warning}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
