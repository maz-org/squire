/**
 * Game module registry + validation (SQR-321) — pure unit, no DB.
 */
import { describe, expect, it } from 'vitest';

import {
  availableModulesFor,
  defaultModulesFor,
  gameDefinitionFor,
  moduleLabel,
  validateModules,
} from '../src/game.ts';

describe('game modules (SQR-321)', () => {
  it('exposes the base + optional modules per game', () => {
    expect(gameDefinitionFor('frosthaven').baseModule).toBe('fh');
    expect(gameDefinitionFor('frosthaven').optionalModules).toEqual([]);
    expect(gameDefinitionFor('gloomhaven-2e').baseModule).toBe('gh2e');
    expect(gameDefinitionFor('gloomhaven-2e').optionalModules).toEqual(['solo2e']);
    expect(availableModulesFor('gloomhaven-2e')).toEqual(['gh2e', 'solo2e']);
    expect(defaultModulesFor('frosthaven')).toEqual(['fh']);
  });

  it('validateModules canonicalizes a valid set', () => {
    // Order-independent, deduped, base-first.
    expect(validateModules('gloomhaven-2e', ['solo2e', 'gh2e', 'solo2e'])).toEqual({
      ok: true,
      modules: ['gh2e', 'solo2e'],
    });
    expect(validateModules('gloomhaven-2e', ['gh2e'])).toEqual({ ok: true, modules: ['gh2e'] });
  });

  it('rejects an unknown module', () => {
    const result = validateModules('gloomhaven-2e', ['gh2e', 'fh']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not a module');
  });

  it('rejects a set missing the base module', () => {
    const result = validateModules('gloomhaven-2e', ['solo2e']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('base module is required');
  });

  it('labels modules for display', () => {
    expect(moduleLabel('solo2e')).toBe('Solo scenarios');
    expect(moduleLabel('gh2e')).toBe('Main campaign');
    expect(moduleLabel('unknown')).toBe('unknown');
  });
});
