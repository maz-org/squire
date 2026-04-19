/**
 * Build the deterministic scenario/section book extract that powers
 * research. This joins:
 * - checked-in GHS-derived scenario identity from `data/extracted/scenarios.json`
 * - printed scenario-book links and prose
 * - printed section-book links and section bodies
 *
 * Run with: npx tsx src/import-scenario-section-books.ts
 *
 * Output: data/extracted/scenario-section-books.json
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pdfParse from 'pdf-parse/lib/pdf-parse.js';

import type {
  BookReferenceRecord,
  BookReferenceType,
  ScenarioBookScenarioRecord,
  ScenarioSectionBooksExtract,
  SectionBookSectionRecord,
} from './scenario-section-schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED_SCENARIOS_PATH = join(__dirname, '..', 'data', 'extracted', 'scenarios.json');
const PDFS_DIR = join(__dirname, '..', 'data', 'pdfs');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'extracted', 'scenario-section-books.json');
const PAGE_SENTINEL = '__SQUIRE_PAGE__';

const FOOTER_RE = /2023\s+CEPHALOFAIR|ALL\s+RIGHTS\s+RESERVED|USED\s+WITH\s+PERMISSION/i;
const HEADING_RE =
  /^(Section Links|Special Rules|Rewards|Conclusion|Scenario Goals|Scenario Key|Map Layout|Loot|Introduction|Goal)$/i;
const SECTION_LINK_RE = /^([\d\s]+\.\s*\d+)\s*•\s*(.+?)(?:\((\d+)\))?$/;
const BOOK_RANGE_RE = /^fh-(scenario|section)-book-(\d+)-(\d+)\.pdf$/;
const SINGLE_MARKER_RE = /^[A-Z#]$/;
const SCENARIO_GOALS_HEADING_RE = /^Scenario Goals$/i;
const SCENARIO_SECTION_LINKS_HEADING_RE = /^Section Links$/i;
const MAIN_SECTION_BODY_HEADING_RE = /^(Conclusion|Introduction|Goal)$/i;
const DANGLING_SECTION_END_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'within',
]);

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
  xEnd: number;
  y: number;
}

interface SectionEntry {
  ref: string;
  label: string;
  targetScenarioIndex: string | null;
  x: number;
  xEnd: number;
  y: number;
  rawText: string;
}

interface BookRange {
  kind: 'scenario' | 'section';
  start: number;
  end: number;
}

interface SectionMatchPosition {
  ref: string;
  index: number;
}

interface SectionEntryRow {
  anchorY: number;
  entries: SectionEntry[];
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
        xEnd: segment.at(-1)!.x,
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
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([A-Za-z])\n([a-z])/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeRawBlockText(text: string): string {
  return text
    .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([A-Za-z])\n([a-z])/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scenarioPageText(lines: PdfLine[]): string {
  return normalizeBlockText(lines);
}

function normalizeSectionRef(ref: string): string {
  return ref.replace(/\s+/g, '');
}

function parseScenarioPageIndex(items: PdfItem[]): string | null {
  const candidates = items
    .filter((item) => item.y > 740)
    .map((item) => normalizeInlineText(item.text))
    .filter((text) => /^\d{1,3}$/.test(text));

  if (candidates.length === 0) return null;
  return String(Number(candidates[0]));
}

function extractScenarioBoxText(lines: PdfLine[], headingPattern: RegExp): string | null {
  const heading = lines.find((line) => headingPattern.test(line.text));
  if (!heading) return null;

  const columnMin = heading.x - 20;
  const columnMax = heading.x + 190;
  const nextHeading =
    lines
      .filter(
        (line) =>
          line.y < heading.y - 4 &&
          line.x >= columnMin &&
          line.x <= columnMax &&
          HEADING_RE.test(line.text),
      )
      .sort((a, b) => b.y - a.y)[0] ?? null;

  const boxLines = lines.filter((line) => {
    if (HEADING_RE.test(line.text)) return false;
    if (line.y >= heading.y - 8) return false;
    if (nextHeading && line.y <= nextHeading.y + 8) return false;
    return line.x >= columnMin && line.x <= columnMax;
  });

  const text = normalizeBlockText(boxLines);
  return text.length > 0 ? text : null;
}

function parseInstructionLinks(
  fromKind: 'scenario' | 'section',
  fromRef: string,
  text: string,
): Array<Omit<BookReferenceRecord, 'sequence'>> {
  const flat = text.replace(/\s+/g, ' ').trim();
  const links: Array<Omit<BookReferenceRecord, 'sequence'>> = [];

  const addLink = (matchIndex: number, targetRef: string, linkType: BookReferenceType) => {
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

  for (const match of flat.matchAll(/return to\s+(\d+\s*\.\s*\d+)/gi)) {
    addLink(match.index ?? 0, normalizeSectionRef(match[1]), 'cross_reference');
  }

  for (const match of flat.matchAll(/read\s+(\d+\s*\.\s*\d+)/gi)) {
    const contextStart = Math.max(0, (match.index ?? 0) - 80);
    const context = flat.slice(contextStart, (match.index ?? 0) + 120);
    const linkType = /scenario is complete|the scenario is complete|at the end of that round/i.test(
      context,
    )
      ? 'conclusion'
      : 'read_now';
    addLink(match.index ?? 0, normalizeSectionRef(match[1]), linkType);
  }

  return links;
}

function parseScenarioGoalLinks(
  fromRef: string,
  text: string,
): Array<Omit<BookReferenceRecord, 'sequence'>> {
  const flat = text.replace(/\s+/g, ' ').trim();
  const links: Array<Omit<BookReferenceRecord, 'sequence'>> = [];

  for (const match of flat.matchAll(/read\s+(\d+\s*\.\s*\d+)/gi)) {
    const start = Math.max(0, (match.index ?? 0) - 80);
    const rawContext = flat.slice(start, Math.min(flat.length, (match.index ?? 0) + 120)).trim();
    links.push({
      fromKind: 'scenario',
      fromRef,
      toKind: 'section',
      toRef: normalizeSectionRef(match[1]),
      linkType: 'conclusion',
      rawLabel: null,
      rawContext,
    });
  }

  return links;
}

function parseScenarioSectionLinks(
  fromRef: string,
  text: string,
): Array<Omit<BookReferenceRecord, 'sequence'>> {
  const links: Array<Omit<BookReferenceRecord, 'sequence'>> = [];

  for (const line of text
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const match = line.match(/read\s+(\d+\s*\.\s*\d+)/i);
    if (!match) continue;
    links.push({
      fromKind: 'scenario',
      fromRef,
      toKind: 'section',
      toRef: normalizeSectionRef(match[1]),
      linkType: 'read_now',
      rawLabel: null,
      rawContext: line,
    });
  }

  return links;
}

function parseScenarioUnlockLinks(
  fromRef: string,
  text: string,
  mainScenariosByIndex: Map<string, SourceScenarioRecord>,
): Array<Omit<BookReferenceRecord, 'sequence'>> {
  const flat = text.replace(/\s+/g, ' ').trim();
  const links: Array<Omit<BookReferenceRecord, 'sequence'>> = [];

  for (const match of flat.matchAll(/New Scenario:\s*(.+?)\s+(\d{1,3})\b/g)) {
    const target = mainScenariosByIndex.get(match[2]);
    if (!target) {
      throw new Error(
        `Scenario/section book import could not resolve scenario ${match[2]} from scenario text`,
      );
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
    const nearestHeadingAbove = lines
      .filter(
        (candidate) =>
          candidate.y > line.y &&
          candidate.x >= line.x - 40 &&
          candidate.x <= line.x + 80 &&
          HEADING_RE.test(candidate.text),
      )
      .sort((a, b) => a.y - b.y)[0];
    if (nearestHeadingAbove && nearestHeadingAbove.text === 'Section Links') {
      continue;
    }
    entries.push({
      ref: match[1].replace(/\s+/g, ''),
      label: normalizeInlineText(match[2]),
      targetScenarioIndex: match[3] ?? null,
      x: line.x,
      xEnd: line.xEnd,
      y: line.y,
      rawText: line.text,
    });
  }
  return entries;
}

function horizontalCenter(entry: { x: number; xEnd: number }): number {
  return (entry.x + entry.xEnd) / 2;
}

function groupSectionEntriesIntoRows(entries: SectionEntry[]): SectionEntryRow[] {
  const sorted = [...entries].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: SectionEntryRow[] = [];

  for (const entry of sorted) {
    const current = rows.at(-1);
    if (!current || Math.abs(current.anchorY - entry.y) > 80) {
      rows.push({ anchorY: entry.y, entries: [entry] });
      continue;
    }

    current.entries.push(entry);
    current.anchorY = Math.round(
      current.entries.reduce((sum, candidate) => sum + candidate.y, 0) / current.entries.length,
    );
  }

  return rows;
}

function groupLinesIntoColumns(lines: PdfLine[]): PdfLine[][] {
  const sorted = [...lines].sort((a, b) => a.x - b.x || b.y - a.y);
  const columns: Array<{ anchorX: number; lines: PdfLine[] }> = [];

  for (const line of sorted) {
    const current = columns.at(-1);
    if (!current || line.x - current.anchorX > 110) {
      columns.push({ anchorX: line.x, lines: [line] });
      continue;
    }

    current.lines.push(line);
    current.anchorX = Math.round(
      current.lines.reduce((sum, candidate) => sum + candidate.x, 0) / current.lines.length,
    );
  }

  return columns.map((column) => column.lines.sort((a, b) => b.y - a.y || a.x - b.x));
}

function extractSectionBody(lines: PdfLine[]): { text: string; columnCount: number } {
  const columnTexts = groupLinesIntoColumns(lines)
    .map((columnLines) => {
      const bodyLines: PdfLine[] = [];
      let allowedLeadHeadingSeen = false;

      for (const line of columnLines) {
        if (HEADING_RE.test(line.text)) {
          if (!allowedLeadHeadingSeen && MAIN_SECTION_BODY_HEADING_RE.test(line.text)) {
            allowedLeadHeadingSeen = true;
            continue;
          }
          break;
        }
        bodyLines.push(line);
      }

      if (bodyLines.length === 0) return null;
      return normalizeBlockText(bodyLines);
    })
    .filter((text): text is string => Boolean(text));

  return {
    text: normalizeRawBlockText(columnTexts.join('\n\n')),
    columnCount: columnTexts.length,
  };
}

function extractSectionBoxText(lines: PdfLine[], headingPattern: RegExp): string | null {
  for (const columnLines of groupLinesIntoColumns(lines)) {
    const headingIndex = columnLines.findIndex((line) => headingPattern.test(line.text));
    if (headingIndex === -1) continue;

    const boxLines: PdfLine[] = [];
    for (const line of columnLines.slice(headingIndex + 1)) {
      if (HEADING_RE.test(line.text)) break;
      boxLines.push(line);
    }

    const text = normalizeBlockText(boxLines);
    if (text.length > 0) return text;
  }

  return null;
}

function buildSectionsFromPage(
  pdfName: string,
  pageNumber: number,
  items: PdfItem[],
): {
  sections: SectionBookSectionRecord[];
  entryLinks: Array<{ entry: SectionEntry; link: Omit<BookReferenceRecord, 'sequence'> }>;
  instructionLinks: Array<Omit<BookReferenceRecord, 'sequence'>>;
} {
  const lines = buildLines(items).filter((line) => line.y > 40 && !FOOTER_RE.test(line.text));
  const entries = parseSectionEntries(lines);
  if (entries.length === 0) return { sections: [], entryLinks: [], instructionLinks: [] };

  const sections: SectionBookSectionRecord[] = [];
  const entryLinks: Array<{ entry: SectionEntry; link: Omit<BookReferenceRecord, 'sequence'> }> =
    [];
  const instructionLinks: Array<Omit<BookReferenceRecord, 'sequence'>> = [];

  // Frosthaven mixes two layouts in the same PDFs:
  // some pages have left/right sibling sections, while others have one section
  // spanning multiple prose columns. Split vertically by entry row first, then
  // split horizontally within that row by entry position.
  const rows = groupSectionEntriesIntoRows(entries);
  for (const [rowIndex, row] of rows.entries()) {
    const nextRow = rows[rowIndex + 1] ?? null;
    const rowEntries = [...row.entries].sort((a, b) => a.x - b.x);
    const rowLines = lines.filter((line) => {
      if (line.y >= row.anchorY - 8) return false;
      if (nextRow && line.y <= nextRow.anchorY + 8) return false;
      return true;
    });

    for (const [entryIndex, entry] of rowEntries.entries()) {
      const previousEntry = rowEntries[entryIndex - 1] ?? null;
      const nextEntry = rowEntries[entryIndex + 1] ?? null;
      const leftBoundary = previousEntry
        ? (horizontalCenter(previousEntry) + horizontalCenter(entry)) / 2
        : Number.NEGATIVE_INFINITY;
      const rightBoundary = nextEntry
        ? (horizontalCenter(entry) + horizontalCenter(nextEntry)) / 2
        : Number.POSITIVE_INFINITY;

      const sectionBandLines = rowLines.filter((line) => {
        if (line.text === entry.rawText) return false;
        const lineCenter = horizontalCenter(line);
        return lineCenter > leftBoundary && lineCenter <= rightBoundary;
      });

      const { text: bodyText, columnCount } = extractSectionBody(sectionBandLines);
      if (!bodyText) continue;
      const sectionLinksText = extractSectionBoxText(sectionBandLines, /^Section Links$/i);

      const [sectionNumber, sectionVariant] = entry.ref.split('.').map(Number);
      sections.push({
        ref: entry.ref,
        sectionNumber,
        sectionVariant,
        sourcePdf: pdfName,
        sourcePage: pageNumber,
        text: bodyText,
        metadata: {
          columns: columnCount,
        },
      });
      if (sectionLinksText) {
        instructionLinks.push(...parseInstructionLinks('section', entry.ref, sectionLinksText));
      }

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
  }

  return { sections, entryLinks, instructionLinks };
}

function addSequencedLinks(
  target: BookReferenceRecord[],
  links: Array<Omit<BookReferenceRecord, 'sequence'>>,
): void {
  for (const [sequence, link] of links.entries()) {
    target.push({ ...link, sequence });
  }
}

function isSuspiciousSectionText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 20) return true;
  if (!/[A-Za-z]{4}/.test(normalized)) return true;
  if (/^[a-z]/.test(normalized)) return true;
  const lastWord = normalized.match(/([A-Za-z]+)[^A-Za-z]*$/)?.[1]?.toLowerCase() ?? null;
  if (lastWord && DANGLING_SECTION_END_WORDS.has(lastWord)) return true;
  return false;
}

function containsStandaloneHeading(text: string): boolean {
  return text
    .split('\n')
    .map((line) => line.trim())
    .some((line) => HEADING_RE.test(line));
}

function buildSectionRefRegex(ref: string): RegExp {
  const [sectionNumber, sectionVariant] = ref.split('.');
  const spacedSectionNumber = sectionNumber.split('').join('\\s*');
  const spacedSectionVariant = sectionVariant.split('').join('\\s*');
  return new RegExp(`(?<!\\d)${spacedSectionNumber}\\s*\\.\\s*${spacedSectionVariant}(?!\\d)`, 'm');
}

const linearPdfTextCache = new Map<string, Promise<string>>();

async function loadLinearPdfText(pdfName: string): Promise<string> {
  const cached = linearPdfTextCache.get(pdfName);
  if (cached) return cached;

  const promise = (async () => {
    const pdfPath = join(PDFS_DIR, pdfName);
    const buffer = readFileSync(pdfPath);
    const parsePdf = pdfParse as unknown as (data: Buffer) => Promise<{ text: string }>;
    const parsed = await parsePdf(buffer);
    return parsed.text;
  })();

  linearPdfTextCache.set(pdfName, promise);
  return promise;
}

function findSectionMatchPosition(text: string, ref: string): SectionMatchPosition | null {
  const match = buildSectionRefRegex(ref).exec(text);
  if (!match || match.index === undefined) return null;
  return { ref, index: match.index };
}

function extractLinearSectionText(
  pdfText: string,
  ref: string,
  nextRefIndex: number,
): string | null {
  const match = buildSectionRefRegex(ref).exec(pdfText);
  if (!match || match.index === undefined) return null;

  let slice = pdfText.slice(match.index, nextRefIndex);
  slice = slice.replace(buildSectionRefRegex(ref), '').trimStart();

  const lines = slice
    .split('\n')
    .map((line) => normalizeInlineText(line))
    .filter(Boolean)
    .filter((line) => !FOOTER_RE.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !SINGLE_MARKER_RE.test(line));

  while (lines[0]?.startsWith('•')) {
    lines.shift();
  }

  const cleaned = normalizeRawBlockText(lines.join('\n'));
  return cleaned.length > 0 ? cleaned : null;
}

async function repairSuspiciousSectionBodies(
  sectionsByRef: Map<string, SectionBookSectionRecord>,
): Promise<void> {
  const sectionsByPdf = new Map<string, SectionBookSectionRecord[]>();
  for (const section of sectionsByRef.values()) {
    const sections = sectionsByPdf.get(section.sourcePdf) ?? [];
    sections.push(section);
    sectionsByPdf.set(section.sourcePdf, sections);
  }

  for (const [pdfName, pdfSections] of sectionsByPdf.entries()) {
    const suspicious = pdfSections.filter((section) => isSuspiciousSectionText(section.text));
    if (suspicious.length === 0) continue;

    const pdfText = await loadLinearPdfText(pdfName);
    const positions = pdfSections
      .map((section) => findSectionMatchPosition(pdfText, section.ref))
      .filter((position): position is SectionMatchPosition => position !== null)
      .sort((a, b) => a.index - b.index);
    const positionIndexByRef = new Map(positions.map((position, index) => [position.ref, index]));

    for (const section of suspicious) {
      const positionIndex = positionIndexByRef.get(section.ref);
      if (positionIndex === undefined) continue;
      const nextRefIndex = positions[positionIndex + 1]?.index ?? pdfText.length;
      const repairedText = extractLinearSectionText(pdfText, section.ref, nextRefIndex);
      if (!repairedText || isSuspiciousSectionText(repairedText)) continue;
      if (containsStandaloneHeading(repairedText)) continue;
      section.text = repairedText;
    }
  }
}

function buildScenarioSectionBooksExtract(): Promise<ScenarioSectionBooksExtract> {
  return (async () => {
    if (!existsSync(PDFS_DIR)) {
      throw new Error(`Missing PDF directory at ${PDFS_DIR}`);
    }

    const sourceScenarios = loadScenarioSourceRecords();
    const mainScenarios = sourceScenarios.filter((scenario) => scenario.scenarioGroup === 'main');
    const mainScenariosByIndex = new Map(
      mainScenarios.map((scenario) => [scenario.index, scenario]),
    );
    const scenariosByRef = new Map<string, ScenarioBookScenarioRecord>();
    const sectionsByRef = new Map<string, SectionBookSectionRecord>();
    const links: BookReferenceRecord[] = [];
    const warnings: string[] = [];

    function ensureScenarioRecord(
      scenarioIndex: string,
      fallbackName: string | null,
    ): ScenarioBookScenarioRecord {
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

      const synthetic: ScenarioBookScenarioRecord = {
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
      const pages = await extractPdfPages(pdfName);

      for (const page of pages) {
        const lines = buildLines(page.items).filter(
          (line) => line.y > 40 && !FOOTER_RE.test(line.text),
        );
        const scenarioNumber = parseScenarioPageIndex(page.items);
        if (!scenarioNumber) {
          warnings.push(
            `Could not resolve printed scenario header for ${pdfName} page ${page.pageIndex}`,
          );
          continue;
        }
        const source = mainScenariosByIndex.get(scenarioNumber);
        if (!source) {
          warnings.push(
            `No main scenario record found for printed scenario ${scenarioNumber} in ${pdfName} page ${page.pageIndex}`,
          );
          continue;
        }

        const rawText = scenarioPageText(lines);
        const scenarioGoalsText = extractScenarioBoxText(lines, SCENARIO_GOALS_HEADING_RE);
        const sectionLinksText = extractScenarioBoxText(lines, SCENARIO_SECTION_LINKS_HEADING_RE);
        const existing = scenariosByRef.get(source.sourceId);
        scenariosByRef.set(source.sourceId, {
          ref: source.sourceId,
          scenarioGroup: source.scenarioGroup,
          scenarioIndex: source.index,
          name: source.name,
          complexity: source.complexity ?? null,
          flowChartGroup: source.flowChartGroup,
          initial: source.initial,
          sourcePdf: existing?.sourcePdf ?? pdfName,
          sourcePage: existing?.sourcePage ?? page.pageIndex + 1,
          rawText: existing?.rawText ? `${existing.rawText}\n\n${rawText}` : rawText,
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

        if (scenarioGoalsText) {
          addSequencedLinks(links, parseScenarioGoalLinks(source.sourceId, scenarioGoalsText));
        }
        if (sectionLinksText) {
          addSequencedLinks(links, parseScenarioSectionLinks(source.sourceId, sectionLinksText));
        }
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
        const { sections, entryLinks, instructionLinks } = buildSectionsFromPage(
          pdfName,
          pageNumber,
          page.items,
        );
        for (const section of sections) {
          sectionsByRef.set(section.ref, section);
          addSequencedLinks(links, parseInstructionLinks('section', section.ref, section.text));
          addSequencedLinks(
            links,
            parseScenarioUnlockLinks(section.ref, section.text, mainScenariosByIndex),
          );
        }
        addSequencedLinks(links, instructionLinks);

        addSequencedLinks(
          links,
          entryLinks.map(({ entry, link }) => ({
            ...link,
            toRef: ensureScenarioRecord(link.toRef, entry.label).ref,
          })),
        );
      }
    }

    await repairSuspiciousSectionBodies(sectionsByRef);

    const validatedLinks = links.filter((link) => {
      if (link.fromKind === 'scenario' && !scenariosByRef.has(link.fromRef)) {
        throw new Error(
          `Scenario/section book import produced a reference from missing scenario ${link.fromRef}`,
        );
      }
      if (link.fromKind === 'section' && !sectionsByRef.has(link.fromRef)) {
        warnings.push(
          `Dropped book reference from missing section ${link.fromRef} -> ${link.toRef}`,
        );
        return false;
      }
      if (link.toKind === 'scenario' && !scenariosByRef.has(link.toRef)) {
        throw new Error(
          `Scenario/section book import produced a reference to missing scenario ${link.toRef}`,
        );
      }
      if (link.toKind === 'section' && !sectionsByRef.has(link.toRef)) {
        warnings.push(`Dropped book reference to missing section ${link.fromRef} -> ${link.toRef}`);
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

export async function importScenarioSectionBooks(): Promise<ScenarioSectionBooksExtract> {
  return buildScenarioSectionBooksExtract();
}

if (process.argv[1]?.endsWith('import-scenario-section-books.ts')) {
  importScenarioSectionBooks()
    .then((extract) => {
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, JSON.stringify(extract, null, 2), 'utf-8');
      console.log(
        `Wrote ${extract.scenarios.length} scenarios, ${extract.sections.length} sections, and ${extract.links.length} links to ${OUTPUT_PATH}`,
      );
      for (const warning of extract.warnings) {
        console.warn(`[import-scenario-section-books] ${warning}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
