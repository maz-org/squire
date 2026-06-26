/**
 * Game module registry + validation (SQR-321) — pure unit, no DB.
 */
import { describe, expect, it } from 'vitest';

import {
  availableModulesFor,
  campaignAvailableModulesFor,
  campaignDefaultModulesFor,
  campaignGameForModule,
  campaignGameDefinitionFor,
  defaultModulesFor,
  gameDefinitionFor,
  moduleLabel,
  validateCampaignModules,
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

  it('exposes campaign-tracker content combinations separately from rules games', () => {
    expect(campaignGameDefinitionFor('gloomhaven-1e').baseModule).toBe('gh1e');
    expect(campaignGameDefinitionFor('gloomhaven-1e').optionalModules).toEqual(['solo1e', 'jotl']);
    expect(campaignAvailableModulesFor('gloomhaven-1e')).toEqual(['gh1e', 'solo1e', 'jotl']);

    expect(campaignGameDefinitionFor('jaws-of-the-lion').baseModule).toBe('jotl');
    expect(campaignGameDefinitionFor('jaws-of-the-lion').optionalModules).toEqual([]);
    expect(campaignDefaultModulesFor('jaws-of-the-lion')).toEqual(['jotl']);

    expect(campaignGameDefinitionFor('gloomhaven-2e').optionalModules).toEqual(['solo2e']);
    expect(campaignGameDefinitionFor('frosthaven').optionalModules).toEqual(['fhsolo']);
  });

  it('maps campaign modules to the game that owns their seeded graph', () => {
    expect(campaignGameForModule('gh1e')).toBe('gloomhaven-1e');
    expect(campaignGameForModule('solo1e')).toBe('gloomhaven-1e');
    expect(campaignGameForModule('jotl')).toBe('jaws-of-the-lion');
    expect(campaignGameForModule('solo2e')).toBe('gloomhaven-2e');
    expect(campaignGameForModule('fhsolo')).toBe('frosthaven');
    expect(campaignGameForModule('not-seeded')).toBeNull();
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

  it('validates campaign modules across tracker-only campaign games', () => {
    expect(validateCampaignModules('gloomhaven-1e', ['jotl', 'gh1e', 'solo1e'])).toEqual({
      ok: true,
      modules: ['gh1e', 'solo1e', 'jotl'],
    });
    expect(validateCampaignModules('jaws-of-the-lion', ['jotl'])).toEqual({
      ok: true,
      modules: ['jotl'],
    });

    const crossGame = validateCampaignModules('jaws-of-the-lion', ['jotl', 'solo1e']);
    expect(crossGame.ok).toBe(false);
    if (!crossGame.ok) expect(crossGame.reason).toContain('not a module');

    const missingBase = validateCampaignModules('frosthaven', ['fhsolo']);
    expect(missingBase.ok).toBe(false);
    if (!missingBase.ok) expect(missingBase.reason).toContain('base module is required');
  });

  it('labels modules for display', () => {
    expect(moduleLabel('gh1e')).toBe('Main campaign');
    expect(moduleLabel('fhsolo')).toBe('Solo scenarios');
    expect(moduleLabel('jotl')).toBe('Jaws of the Lion');
    expect(moduleLabel('solo1e')).toBe('Solo scenarios');
    expect(moduleLabel('solo2e')).toBe('Solo scenarios');
    expect(moduleLabel('gh2e')).toBe('Main campaign');
    expect(moduleLabel('unknown')).toBe('unknown');
  });
});
