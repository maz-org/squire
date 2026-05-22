import { describe, expect, it } from 'vitest';

import {
  FROSTHAVEN_GAME_ID,
  GLOOMHAVEN_2E_GAME_ID,
  gameIdFromSourceFilename,
  normalizeGameId,
  requireGameId,
  resolveGameId,
} from '../src/game.ts';

describe('game id helpers', () => {
  it('normalizes supported canonical ids', () => {
    expect(normalizeGameId('frosthaven')).toBe(FROSTHAVEN_GAME_ID);
    expect(normalizeGameId('gloomhaven-2e')).toBe(GLOOMHAVEN_2E_GAME_ID);
  });

  it('centralizes accepted aliases for Gloomhaven 2.0', () => {
    const aliases = [
      'gloomhaven-2',
      'gloomhaven2',
      'gloomhaven 2',
      'gloomhaven 2.0',
      'gloomhaven second edition',
      'gloomhaven 2nd edition',
      'gh2',
      'gh2e',
    ];

    for (const alias of aliases) {
      expect(normalizeGameId(alias), alias).toBe(GLOOMHAVEN_2E_GAME_ID);
    }
  });

  it('returns null for unsupported aliases and throws clearly when required', () => {
    expect(normalizeGameId('jaws of the lion')).toBeNull();
    expect(() => requireGameId('jaws of the lion')).toThrow(
      'Unsupported game id "jaws of the lion"',
    );
  });

  it('derives the game id from deterministic source filename prefixes', () => {
    expect(gameIdFromSourceFilename('fh-rule-book.pdf')).toBe(FROSTHAVEN_GAME_ID);
    expect(gameIdFromSourceFilename('/tmp/data/pdfs/gh2-rule-book.pdf')).toBe(
      GLOOMHAVEN_2E_GAME_ID,
    );
  });

  it('rejects source filenames without a supported game prefix', () => {
    expect(() => gameIdFromSourceFilename('rule-book.pdf')).toThrow(
      'Cannot derive game id from source filename "rule-book.pdf"',
    );
  });

  it('resolveGameId defaults to Frosthaven and validates explicit ids', () => {
    expect(resolveGameId()).toBe(FROSTHAVEN_GAME_ID);
    expect(resolveGameId({})).toBe(FROSTHAVEN_GAME_ID);
    expect(resolveGameId({ game: 'gh2' })).toBe(GLOOMHAVEN_2E_GAME_ID);
    expect(() => resolveGameId({ game: 'no-such-game' })).toThrow(
      'Unsupported game id "no-such-game"',
    );
    expect(() => resolveGameId({ game: '' })).toThrow('Unsupported game id ""');
  });
});
