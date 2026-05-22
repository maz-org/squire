import { basename } from 'node:path';

export const FROSTHAVEN_GAME_ID = 'frosthaven';
export const GLOOMHAVEN_2E_GAME_ID = 'gloomhaven-2e';
export const DEFAULT_GAME_ID = FROSTHAVEN_GAME_ID;

export const SUPPORTED_GAME_IDS = [FROSTHAVEN_GAME_ID, GLOOMHAVEN_2E_GAME_ID] as const;

export type GameId = (typeof SUPPORTED_GAME_IDS)[number];

export interface GameDefinition {
  id: GameId;
  label: string;
  default: boolean;
  sourcePrefix: string;
  aliases: string[];
}

export const SUPPORTED_GAMES: readonly GameDefinition[] = [
  {
    id: FROSTHAVEN_GAME_ID,
    label: 'Frosthaven',
    default: true,
    sourcePrefix: 'fh',
    aliases: ['fh', 'frost haven'],
  },
  {
    id: GLOOMHAVEN_2E_GAME_ID,
    label: 'Gloomhaven 2.0',
    default: false,
    sourcePrefix: 'gh2',
    aliases: [
      'gloomhaven-2',
      'gloomhaven2',
      'gloomhaven 2',
      'gloomhaven 2.0',
      'gloomhaven second edition',
      'gloomhaven 2nd edition',
      'gh2',
      'gh2e',
    ],
  },
];

const GAME_IDS = new Set<string>(SUPPORTED_GAME_IDS);
const GAME_BY_ID = new Map(SUPPORTED_GAMES.map((game) => [game.id, game]));
const GAME_BY_ALIAS = new Map<string, GameId>();
const GAME_BY_SOURCE_PREFIX = new Map(SUPPORTED_GAMES.map((game) => [game.sourcePrefix, game.id]));

for (const game of SUPPORTED_GAMES) {
  GAME_BY_ALIAS.set(normalizeAlias(game.id), game.id);
  for (const alias of game.aliases) {
    GAME_BY_ALIAS.set(normalizeAlias(alias), game.id);
  }
}

function normalizeAlias(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function supportedGameList(): string {
  return SUPPORTED_GAME_IDS.map((id) => `"${id}"`).join(', ');
}

export function isGameId(value: string): value is GameId {
  return GAME_IDS.has(value);
}

export function normalizeGameId(value: string): GameId | null {
  return GAME_BY_ALIAS.get(normalizeAlias(value)) ?? null;
}

export function requireGameId(value: string): GameId {
  const game = normalizeGameId(value);
  if (game) return game;
  throw new Error(
    `Unsupported game id ${JSON.stringify(value)}. Expected one of ${supportedGameList()}.`,
  );
}

export interface GameLoadOpts {
  /** Active game. Defaults to Frosthaven when omitted. */
  game?: string;
}

/** Resolve the active game for DB-backed loaders. Validates explicit ids. */
export function resolveGameId(opts: GameLoadOpts = {}): GameId {
  return opts.game !== undefined ? requireGameId(opts.game) : DEFAULT_GAME_ID;
}

export function gameDefinitionFor(game: GameId): GameDefinition {
  const definition = GAME_BY_ID.get(game);
  if (!definition) {
    throw new Error(
      `Unsupported game id ${JSON.stringify(game)}. Expected one of ${supportedGameList()}.`,
    );
  }
  return definition;
}

export function gameIdFromSourceFilename(source: string): GameId {
  const name = basename(source);
  const prefix = name.toLowerCase().match(/^([a-z0-9]+)-/)?.[1];
  const game = prefix ? GAME_BY_SOURCE_PREFIX.get(prefix) : undefined;
  if (game) return game;
  throw new Error(
    `Cannot derive game id from source filename ${JSON.stringify(name)}. ` +
      `Expected one of these prefixes: ${[...GAME_BY_SOURCE_PREFIX.keys()].join(', ')}.`,
  );
}
