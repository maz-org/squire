export type EvalToolSurface = 'redesigned' | 'legacy';

export interface EvalCliOptions {
  shouldSeed: boolean;
  categoryFilter: string | undefined;
  idFilter: string | undefined;
  runName: string;
  toolSurface: EvalToolSurface;
  localReportPath: string | undefined;
}

function valueFor(args: string[], prefix: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return undefined;

  const value = arg.slice(prefix.length);
  if (value.length === 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: value cannot be empty.`);
  }
  return value;
}

export function parseEvalArgs(args: string[], now = new Date()): EvalCliOptions {
  const surface = valueFor(args, '--tool-surface=') ?? 'redesigned';
  if (surface !== 'redesigned' && surface !== 'legacy') {
    throw new Error(`Invalid --tool-surface: ${surface}. Expected "redesigned" or "legacy".`);
  }

  const runName = valueFor(args, '--name=') ?? `eval-${now.toISOString().slice(0, 16)}-${surface}`;

  return {
    shouldSeed: args.includes('--seed'),
    categoryFilter: valueFor(args, '--category='),
    idFilter: valueFor(args, '--id='),
    runName,
    toolSurface: surface,
    localReportPath: valueFor(args, '--local-report='),
  };
}
