import { basename } from 'node:path';
import { readFileSync } from 'node:fs';

interface TimedFile {
  file: string;
  durationMs: number;
  tests: number;
}

interface TimedTest {
  file: string;
  name: string;
  durationMs: number;
  status: string;
}

interface TimingSummary {
  label: string;
  wallMs: number | null;
  files: TimedFile[];
  tests: TimedTest[];
  failedTests: TimedTest[];
}

interface ParsedArgs {
  failOverThreshold: boolean;
  thresholdMs: number;
  top: number;
  reports: Array<{ label: string; path: string }>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    failOverThreshold: false,
    thresholdMs: 1_000,
    top: 10,
    reports: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fail-over-threshold') {
      parsed.failOverThreshold = true;
      continue;
    }
    if (arg === '--threshold-ms') {
      parsed.thresholdMs = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith('--threshold-ms=')) {
      parsed.thresholdMs = Number(arg.slice('--threshold-ms='.length));
      continue;
    }
    if (arg === '--top') {
      parsed.top = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith('--top=')) {
      parsed.top = Number(arg.slice('--top='.length));
      continue;
    }
    const [label, path] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [basename(arg), arg];
    parsed.reports.push({ label, path });
  }

  if (!Number.isFinite(parsed.thresholdMs) || parsed.thresholdMs < 0) {
    throw new Error('--threshold-ms must be a non-negative number');
  }
  if (!Number.isInteger(parsed.top) || parsed.top < 1) {
    throw new Error('--top must be a positive integer');
  }
  if (parsed.reports.length === 0) {
    throw new Error(
      'Usage: node scripts/summarize-test-timings.ts [--fail-over-threshold] [--threshold-ms 1000] [--top 10] label=report.json ...',
    );
  }

  return parsed;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function summarizeVitest(label: string, report: Record<string, unknown>): TimingSummary {
  const cwd = `${process.cwd()}/`;
  const testResults = Array.isArray(report.testResults) ? report.testResults : [];
  const reportStartTime = Number(report.startTime);
  const maxEndTime = testResults
    .filter(isRecord)
    .reduce((max, result) => Math.max(max, Number(result.endTime ?? 0)), 0);
  const files = testResults
    .filter(isRecord)
    .map((result) => {
      const name = String(result.name ?? 'unknown');
      const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
      return {
        file: name.startsWith(cwd) ? name.slice(cwd.length) : name,
        durationMs: Number(result.endTime) - Number(result.startTime),
        tests: assertions.length,
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs);

  const tests = testResults
    .filter(isRecord)
    .flatMap((result) => {
      const name = String(result.name ?? 'unknown');
      const file = name.startsWith(cwd) ? name.slice(cwd.length) : name;
      const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
      return assertions.filter(isRecord).map((assertion) => {
        const ancestorTitles = Array.isArray(assertion.ancestorTitles)
          ? assertion.ancestorTitles.map(String)
          : [];
        return {
          file,
          name: String(assertion.fullName ?? [...ancestorTitles, assertion.title].join(' ')),
          durationMs: Number(assertion.duration ?? 0),
          status: String(assertion.status ?? 'unknown'),
        };
      });
    })
    .sort((a, b) => b.durationMs - a.durationMs);

  return {
    label,
    wallMs:
      Number.isFinite(reportStartTime) && maxEndTime >= reportStartTime
        ? maxEndTime - reportStartTime
        : null,
    files,
    tests,
    failedTests: tests.filter((test) => test.status !== 'passed'),
  };
}

function summarizePlaywright(label: string, report: Record<string, unknown>): TimingSummary {
  const tests: TimedTest[] = [];
  const fileDurations = new Map<string, TimedFile>();
  const suites = Array.isArray(report.suites) ? report.suites : [];

  function visitSuite(suite: unknown, titles: string[] = []) {
    if (!isRecord(suite)) return;
    const suiteTitle = typeof suite.title === 'string' ? suite.title : '';
    const nextTitles = suiteTitle ? [...titles, suiteTitle] : titles;
    const specs = Array.isArray(suite.specs) ? suite.specs : [];
    for (const spec of specs.filter(isRecord)) {
      const specTitle = String(spec.title ?? 'unknown');
      const specFile = String(spec.file ?? suite.file ?? 'unknown');
      const specTests = Array.isArray(spec.tests) ? spec.tests : [];
      for (const test of specTests.filter(isRecord)) {
        const results = Array.isArray(test.results) ? test.results.filter(isRecord) : [];
        const durationMs = results.reduce((sum, result) => sum + Number(result.duration ?? 0), 0);
        const projectName = String(test.projectName ?? 'default');
        const timedTest = {
          file: specFile,
          name: `[${projectName}] ${[...nextTitles, specTitle].join(' > ')}`,
          durationMs,
          status: String(test.status ?? 'unknown'),
        };
        tests.push(timedTest);
        const file = fileDurations.get(specFile) ?? { file: specFile, durationMs: 0, tests: 0 };
        file.durationMs += durationMs;
        file.tests += 1;
        fileDurations.set(specFile, file);
      }
    }
    const childSuites = Array.isArray(suite.suites) ? suite.suites : [];
    for (const child of childSuites) visitSuite(child, nextTitles);
  }

  for (const suite of suites) visitSuite(suite);
  tests.sort((a, b) => b.durationMs - a.durationMs);
  const stats = isRecord(report.stats) ? report.stats : {};

  return {
    label,
    wallMs: Number.isFinite(Number(stats.duration)) ? Number(stats.duration) : null,
    files: [...fileDurations.values()].sort((a, b) => b.durationMs - a.durationMs),
    tests,
    failedTests: tests.filter((test) => test.status !== 'expected' && test.status !== 'skipped'),
  };
}

function summarizeReport(label: string, report: unknown): TimingSummary {
  if (!isRecord(report)) throw new Error(`${label}: report is not a JSON object`);
  if (Array.isArray(report.testResults)) return summarizeVitest(label, report);
  if (Array.isArray(report.suites) && isRecord(report.stats)) {
    return summarizePlaywright(label, report);
  }
  throw new Error(`${label}: unsupported timing report format`);
}

function formatMs(durationMs: number): string {
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(2)}s`;
  return `${durationMs.toFixed(1)}ms`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_None._\n';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function renderSummary(summary: TimingSummary, top: number, thresholdMs: number): string {
  const overThreshold = summary.tests.filter((test) => test.durationMs > thresholdMs);
  const totalDurationMs = summary.files.reduce((sum, file) => sum + file.durationMs, 0);
  const lines = [
    `## ${summary.label}`,
    '',
    `Files: ${summary.files.length}`,
    `Tests: ${summary.tests.length}`,
    `File-duration sum: ${formatMs(totalDurationMs)}`,
    `Wall time: ${summary.wallMs === null ? 'not reported' : formatMs(summary.wallMs)}`,
    `Failures: ${summary.failedTests.length}`,
    `Tests over ${formatMs(thresholdMs)}: ${overThreshold.length}`,
    '',
    '### Slowest Files',
    '',
    table(
      ['file', 'duration', 'tests'],
      summary.files
        .slice(0, top)
        .map((file) => [file.file, formatMs(file.durationMs), String(file.tests)]),
    ),
    '### Slowest Tests',
    '',
    table(
      ['file', 'duration', 'status', 'test'],
      summary.tests
        .slice(0, top)
        .map((test) => [
          test.file,
          formatMs(test.durationMs),
          test.status,
          test.name.replaceAll('|', '\\|'),
        ]),
    ),
  ];

  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const summaries = args.reports.map(({ label, path }) => summarizeReport(label, readJson(path)));

console.log(
  summaries.map((summary) => renderSummary(summary, args.top, args.thresholdMs)).join('\n'),
);

if (
  args.failOverThreshold &&
  summaries.some((summary) => summary.tests.some((test) => test.durationMs > args.thresholdMs))
) {
  process.exitCode = 1;
}

if (summaries.some((summary) => summary.failedTests.length > 0)) {
  process.exitCode = 1;
}
