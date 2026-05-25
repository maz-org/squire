import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_GAME_ID,
  SUPPORTED_GAMES,
  gameDefinitionFor,
  requireGameId,
  type GameId,
} from './game.ts';
import type { CardType } from './schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXTRACTED_DIR = join(__dirname, '..', 'data', 'extracted');

interface ExtractedPathOptions {
  extractedDir?: string;
}

function baseDir(options: ExtractedPathOptions = {}): string {
  return options.extractedDir ?? EXTRACTED_DIR;
}

export function extractedDataPath(
  type: CardType | 'scenario-section-books',
  gameInput: string = DEFAULT_GAME_ID,
  options: ExtractedPathOptions = {},
): string {
  const game = requireGameId(gameInput);
  if (game === DEFAULT_GAME_ID) return join(baseDir(options), `${type}.json`);
  return join(baseDir(options), gameDefinitionFor(game).sourcePrefix, `${type}.json`);
}

export function readExtractedRecords(
  type: CardType,
  gameInput: string = DEFAULT_GAME_ID,
  options: ExtractedPathOptions = {},
): Array<Record<string, unknown>> {
  const path = extractedDataPath(type, gameInput, options);
  return JSON.parse(readFileSync(path, 'utf-8')) as Array<Record<string, unknown>>;
}

export function writeExtractedRecords(
  type: CardType | 'scenario-section-books',
  gameInput: string,
  records: unknown,
  options: ExtractedPathOptions = {},
): string {
  const path = extractedDataPath(type, gameInput, options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8');
  return path;
}

export function availableExtractedGames(options: ExtractedPathOptions = {}): GameId[] {
  const root = baseDir(options);
  const games: GameId[] = [];

  if (SUPPORTED_GAMES.some((game) => game.id === DEFAULT_GAME_ID)) {
    games.push(DEFAULT_GAME_ID);
  }

  const entries = existsSync(root)
    ? new Set(readdirSync(root, { withFileTypes: true }).map((e) => e.name))
    : new Set<string>();

  for (const game of SUPPORTED_GAMES) {
    if (game.id === DEFAULT_GAME_ID) continue;
    if (entries.has(game.sourcePrefix) && existsSync(join(root, game.sourcePrefix))) {
      games.push(game.id);
    }
  }

  return games;
}
