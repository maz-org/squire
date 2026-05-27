import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as LangSmithClient } from 'langsmith';
import { normalizeGameId, requireGameId, type GameId } from '../src/game.ts';
import { EvalDatasetSchema, EvalSuiteSchema, type EvalCase } from './schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATASET_NAME = 'squire/frosthaven/table-qa';
export const EVAL_SUITES_DIR = join(__dirname, 'suites');

const CROSS_GAME_BOUNDARY_DATASET_NAME = 'squire/cross-game/boundary';

export interface EvalCaseFilters {
  gameFilter: string | undefined;
  suiteFilter: string | undefined;
  categoryFilter: string | undefined;
  idFilter: string | undefined;
}

export interface EvalBaselineCounts {
  game: GameId;
  finalAnswerCases: number;
  trajectoryCases: number;
  boundaryCases: number;
}

export function sourceAuthorityForCase(evalCase: EvalCase): string {
  if (/faq/i.test(evalCase.source)) return 'faq';
  if (/errata/i.test(evalCase.source)) return 'errata';
  if (/rule-?book|rules/i.test(evalCase.source)) return 'rulebook';
  if (/scenario-section-books|section-book|scenario-book/i.test(evalCase.source)) {
    return 'scenario-section-books';
  }
  if (evalCase.source.startsWith('data/extracted/')) return 'structured-data';
  if (evalCase.source.startsWith('docs/')) return 'contract';
  if (evalCase.source.startsWith('src/')) return 'application';
  return 'unknown';
}

export function gamePairForCase(evalCase: EvalCase): string | undefined {
  if (evalCase.suite !== 'cross-game-boundary') return undefined;

  const games = new Set<GameId>([evalCase.game]);
  for (const ref of evalCase.trajectory?.requiredRefs ?? []) {
    const match = ref.match(/^[^:]+:([^/]+)\//);
    const game = match ? normalizeGameId(match[1]) : undefined;
    if (game) games.add(game);
  }

  const orderedGames = (['frosthaven', 'gloomhaven-2e'] as const).filter((game) => games.has(game));
  return orderedGames.length > 1 ? orderedGames.join(':') : undefined;
}

export function loadEvalCases(): EvalCase[] {
  const files = readdirSync(EVAL_SUITES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => {
      if (a === 'frosthaven.json') return -1;
      if (b === 'frosthaven.json') return 1;
      return a.localeCompare(b);
    });
  const rawCases = files.flatMap((file) =>
    JSON.parse(readFileSync(join(EVAL_SUITES_DIR, file), 'utf-8')),
  );
  return EvalDatasetSchema.parse(rawCases);
}

export function filterEvalCases(cases: EvalCase[], filters: EvalCaseFilters): EvalCase[] {
  let selected = cases;
  if (filters.gameFilter) {
    const game = requireGameId(filters.gameFilter);
    selected = selected.filter((c) => c.game === game);
  }
  if (filters.suiteFilter) {
    const suite = EvalSuiteSchema.parse(filters.suiteFilter);
    selected = selected.filter((c) => c.suite === suite);
  }
  if (filters.categoryFilter)
    selected = selected.filter((c) => c.caseCategory === filters.categoryFilter);
  if (filters.idFilter) selected = selected.filter((c) => c.id === filters.idFilter);
  return selected;
}

export function langSmithDatasetNameForCase(evalCase: EvalCase): string {
  if (evalCase.suite === 'cross-game-boundary') return CROSS_GAME_BOUNDARY_DATASET_NAME;
  return `squire/${evalCase.game}/${evalCase.suite}`;
}

export function baselineCountsFor(cases: EvalCase[], gameInput: string): EvalBaselineCounts {
  const game = requireGameId(gameInput);
  const gameCases = cases.filter((evalCase) => evalCase.game === game);
  const nonBoundaryCases = gameCases.filter((evalCase) => evalCase.suite !== 'cross-game-boundary');
  return {
    game,
    finalAnswerCases: nonBoundaryCases.filter((evalCase) => evalCase.finalAnswer).length,
    trajectoryCases: nonBoundaryCases.filter((evalCase) => evalCase.trajectory).length,
    boundaryCases: gameCases.filter((evalCase) => evalCase.suite === 'cross-game-boundary').length,
  };
}

export async function seedDataset(client: LangSmithClient, cases: EvalCase[]): Promise<void> {
  const casesByDataset = new Map<string, EvalCase[]>();
  for (const evalCase of cases) {
    const datasetName = langSmithDatasetNameForCase(evalCase);
    casesByDataset.set(datasetName, [...(casesByDataset.get(datasetName) ?? []), evalCase]);
  }

  for (const [datasetName, datasetCases] of casesByDataset) {
    console.log(`Seeding LangSmith dataset "${datasetName}" with ${datasetCases.length} items...`);

    const hasDataset = await client.hasDataset({ datasetName });
    if (!hasDataset) {
      await client.createDataset(datasetName, {
        description: `Squire ${datasetName} evaluation set`,
        metadata: { version: '1.0', source: 'squire/eval/suites' },
      });
    }

    const existingExampleIds: string[] = [];
    for await (const example of client.listExamples({ datasetName })) {
      existingExampleIds.push(example.id);
    }
    if (existingExampleIds.length > 0) {
      await client.deleteExamples(existingExampleIds, { hardDelete: true });
    }

    await client.createExamples(
      datasetCases.map((c) => ({
        dataset_name: datasetName,
        inputs: { question: c.question },
        outputs: {
          finalAnswer: c.finalAnswer,
          trajectory: c.trajectory,
        },
        metadata: {
          slug: c.id,
          game: c.game,
          suite: c.suite,
          runtime: c.runtime,
          category: c.category,
          caseCategory: c.caseCategory,
          source: c.source,
          sourceAuthority: sourceAuthorityForCase(c),
          gamePair: gamePairForCase(c),
          hasFinalAnswer: !!c.finalAnswer,
          hasTrajectory: !!c.trajectory,
        },
      })),
    );
  }

  console.log('\nDataset seeded.');
}

export async function createLangSmithDatasetClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LangSmithClient> {
  return new LangSmithClient({
    apiKey: env.LANGSMITH_API_KEY,
    apiUrl: env.LANGSMITH_ENDPOINT,
    workspaceId: env.LANGSMITH_WORKSPACE_ID,
  });
}
