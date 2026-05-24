import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readContract(): Promise<string> {
  return readFile(new URL('../docs/KNOWLEDGE_TOOL_CONTRACT.md', import.meta.url), 'utf8');
}

describe('knowledge tool contract documentation', () => {
  it('documents both supported games and the Frosthaven default', async () => {
    const contract = await readContract();

    expect(contract).toContain('| `frosthaven`');
    expect(contract).toContain('| `gloomhaven-2e`');
    expect(contract).toContain('`Gloomhaven 2.0`');
    expect(contract).toContain('"defaultGame": "frosthaven"');
    expect(contract).toContain('"id": "gloomhaven-2e"');
    expect(contract).toContain('"label": "Gloomhaven 2.0"');
    expect(contract).toContain('"default": false');
  });

  it('includes GH2 source refs and canonical entity refs in examples', async () => {
    const contract = await readContract();

    for (const ref of [
      'source:gloomhaven-2e/rulebook',
      'source:gloomhaven-2e/scenario-section-books',
      'source:gloomhaven-2e/cards',
      'rules:gloomhaven-2e/gh2-rule-book.pdf#chunk=42',
      'scenario:gloomhaven-2e/061',
      'section:gloomhaven-2e/67.1',
      'card:gloomhaven-2e/items/gloomhavensecretariat:item/1',
    ]) {
      expect(contract).toContain(ref);
    }
  });

  it('explains legacy refs and active-game filtering', async () => {
    const contract = await readContract();

    expect(contract).toContain('Bare legacy refs are Frosthaven-only unless');
    expect(contract).toContain('active game. Callers that know the game should send');
    expect(contract).toContain(
      'All search, resolve, open, and traversal operations run under one active game',
    );
    expect(contract).toMatch(/filters vector rows,\s+card rows,\s+scenario\/section rows/);
    expect(contract).toMatch(/Do not mix\s+Frosthaven and GH2 sources/);
    expect(contract).toContain('GH2 answers use `gloomhaven-2e` canonical refs');
  });
});
