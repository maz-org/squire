import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type Learning = {
  skill?: string;
  type?: string;
  key?: string;
  insight?: string;
  confidence?: number;
  source?: string;
  files?: string[];
  ts?: string;
};

export function parseLearningsJsonl(text: string): Learning[] {
  const records: Learning[] = [];

  for (const line of text.split('\n').map((entry) => entry.trim())) {
    if (line.length === 0) continue;

    try {
      records.push(JSON.parse(line) as Learning);
    } catch {
      // Ignore malformed local learnings rather than aborting the whole export.
    }
  }

  return records;
}

export function selectCuratedLearnings(records: Learning[]): Learning[] {
  const latestByKey = new Map<string, Learning>();

  for (const record of records) {
    if (!record.key || !record.insight) continue;
    if ((record.confidence ?? 0) < 9) continue;
    latestByKey.set(record.key, record);
  }

  return [...latestByKey.values()]
    .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
    .slice(0, 8);
}

function renderLearning(record: Learning): string {
  const files = (record.files ?? []).slice(0, 3);
  const fileText = files.length > 0 ? ` Files: \`${files.join('`, `')}\`.` : '';
  const sourceText = record.source ? ` Source: \`${record.source}\`.` : '';
  const sanitizedInsight = (record.insight ?? '').replaceAll('`', "'");
  return `- **${record.key}** (${record.type ?? 'note'}): ${sanitizedInsight}${fileText}${sourceText}`;
}

export function renderLearningsMarkdown(records: Learning[]): string {
  const pitfalls = records.filter((record) => record.type === 'pitfall');
  const patterns = records.filter((record) => record.type !== 'pitfall');

  const sections: string[] = [
    '# Curated Learnings',
    '',
    'This file is the checked-in synthesis layer for durable learnings promoted',
    'out of `~/.gstack/projects/maz-org-squire/learnings.jsonl`.',
    '',
    'It is intentionally curated, not a raw dump. Put non-obvious, repeated,',
    'high-signal lessons here when they should survive tool-local runtime state.',
    '',
    'If a learning turns into a real architecture decision, write an ADR instead',
    'of treating this file as the permanent decision record.',
  ];

  if (pitfalls.length > 0) {
    sections.push('', '## Pitfalls', '', ...pitfalls.map(renderLearning));
  }

  if (patterns.length > 0) {
    sections.push('', '## Patterns', '', ...patterns.map(renderLearning));
  }

  if (records.length === 0) {
    sections.push('', 'No curated learnings yet.');
  }

  return `${sections.join('\n')}\n`;
}

export function getDefaultLearningsPaths() {
  const learningsPath = path.join(
    homedir(),
    '.gstack',
    'projects',
    'maz-org-squire',
    'learnings.jsonl',
  );
  const outputPath = new URL('../docs/agent/learnings.md', import.meta.url);
  return { learningsPath, outputPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { learningsPath, outputPath } = getDefaultLearningsPaths();
  if (!existsSync(learningsPath)) {
    throw new Error(`No gstack learnings file found at ${learningsPath}`);
  }

  const raw = readFileSync(learningsPath, 'utf8');
  const markdown = renderLearningsMarkdown(selectCuratedLearnings(parseLearningsJsonl(raw)));
  writeFileSync(outputPath, markdown, 'utf8');
  console.log(`Wrote ${outputPath.pathname}`);
}
