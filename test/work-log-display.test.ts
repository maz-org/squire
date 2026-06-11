import { describe, expect, it } from 'vitest';

import {
  humanizeWorkLogProgressMessage,
  workLogSourceActionFromProgressMessage,
} from '../src/work-log-display.ts';

describe('work log display wording', () => {
  it('turns card implementation refs into physical card checks', () => {
    const message =
      'Opening card:gloomhaven-2e/monster-stats/gloomhavensecretariat:monster-stat/bandit-archer/0-3';

    expect(humanizeWorkLogProgressMessage(message)).toBe('Checked Bandit Archer stat card');
    expect(workLogSourceActionFromProgressMessage(message)).toEqual({
      label: 'CARD INDEX',
      detail: 'Checked Bandit Archer stat card',
    });
  });

  it('turns scenario and section refs into book-opening actions', () => {
    expect(humanizeWorkLogProgressMessage('Opening scenario:gloomhaven-2e/061')).toBe(
      'Looked up scenario 61 in the scenario book',
    );
    expect(humanizeWorkLogProgressMessage('Opening gloomhavensecretariat:scenario/061')).toBe(
      'Looked up scenario 61 in the scenario book',
    );
    expect(humanizeWorkLogProgressMessage('Opening section:gloomhaven-2e/67.1')).toBe(
      'Looked up section 67.1 in the section book',
    );
    expect(humanizeWorkLogProgressMessage('Opening 67.1')).toBe(
      'Looked up section 67.1 in the section book',
    );
    expect(humanizeWorkLogProgressMessage('Opening scenario 061')).toBe(
      'Looked up scenario 61 in the scenario book',
    );
  });

  it('uses lookup language for rulebook searches and entity resolution', () => {
    expect(humanizeWorkLogProgressMessage('Searching Rulebook')).toBe('Searched the rulebook');
    expect(humanizeWorkLogProgressMessage('Searching the rulebook')).toBe('Searched the rulebook');
    expect(humanizeWorkLogProgressMessage('Looking up loot in the rulebook')).toBe(
      'Searched the rulebook',
    );
    expect(humanizeWorkLogProgressMessage('Searching Rulebook, Section Book, Card Index')).toBe(
      'Searched available sources',
    );
    expect(humanizeWorkLogProgressMessage('Resolving bandit archer monster stat card')).toBe(
      'Checked Bandit Archer stat card',
    );
    expect(humanizeWorkLogProgressMessage('Resolving loot')).toBe('Looked up loot');
    expect(workLogSourceActionFromProgressMessage('Resolving section 67.1')).toEqual({
      label: 'SECTION BOOK',
      detail: 'Looked up section 67.1 in the section book',
    });
    expect(workLogSourceActionFromProgressMessage('Resolving scenario 61')).toEqual({
      label: 'SCENARIO BOOK',
      detail: 'Looked up scenario 61 in the scenario book',
    });
  });
});
