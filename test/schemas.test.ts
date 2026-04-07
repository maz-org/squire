import { describe, it, expect } from 'vitest';
import { SCHEMAS } from '../src/schemas.ts';

describe('MonsterStatSchema', () => {
  const schema = SCHEMAS['monster-stats'];

  it('accepts a valid monster stat card', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/ooze/0-3',
      name: 'Ooze',
      levelRange: '0-3',
      normal: { 0: { move: 1, attack: 2, hp: 5 } },
      elite: { 0: { move: 2, attack: 3, hp: 8 } },
      immunities: ['poison'],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid levelRange', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/ooze/0-3',
      name: 'Ooze',
      levelRange: '0-7',
      normal: {},
      elite: {},
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });

  it('rejects missing name', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/ooze/0-3',
      levelRange: '0-3',
      normal: {},
      elite: {},
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });

  it('accepts stats at upper bounds', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/boss/4-7',
      name: 'Boss',
      levelRange: '4-7',
      normal: { 4: { move: 12, attack: 20, hp: 150 } },
      elite: { 4: { move: 12, attack: 20, hp: 150 } },
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('accepts stats at lower bounds', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/weak/0-3',
      name: 'Weak',
      levelRange: '0-3',
      normal: { 0: { move: 0, attack: 0, hp: 1 } },
      elite: { 0: { move: 0, attack: 0, hp: 1 } },
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects stats above upper bounds', () => {
    const base = {
      sourceId: 'gloomhavensecretariat:monster-stat/bad/0-3',
      name: 'Bad',
      levelRange: '0-3' as const,
      immunities: [],
      notes: null,
    };
    const overMove = {
      ...base,
      normal: { 0: { move: 13, attack: 1, hp: 5 } },
      elite: {},
    };
    const overAttack = {
      ...base,
      normal: { 0: { move: 1, attack: 21, hp: 5 } },
      elite: {},
    };
    const overHp = {
      ...base,
      normal: { 0: { move: 1, attack: 1, hp: 151 } },
      elite: {},
    };
    expect(schema.safeParse(overMove).success).toBe(false);
    expect(schema.safeParse(overAttack).success).toBe(false);
    expect(schema.safeParse(overHp).success).toBe(false);
  });

  it('rejects negative stat values', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/bad/0-3',
      name: 'Bad',
      levelRange: '0-3',
      normal: { 0: { move: -1, attack: 1, hp: 5 } },
      elite: {},
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });

  it('rejects hp of 0', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:monster-stat/bad/0-3',
      name: 'Bad',
      levelRange: '0-3',
      normal: { 0: { move: 1, attack: 1, hp: 0 } },
      elite: {},
      immunities: [],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });
});

describe('ItemSchema', () => {
  const schema = SCHEMAS['items'];

  it('accepts a valid item card', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:item/099',
      number: '099',
      name: 'Major Healing Potion',
      slot: 'small item',
      cost: 20,
      effect: 'Heal 4, self',
      uses: 1,
      spent: false,
      lost: true,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid slot type', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:item/001',
      number: '001',
      name: 'Test',
      slot: 'backpack',
      cost: 10,
      effect: 'Nothing',
      uses: null,
      spent: false,
      lost: false,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });
});

describe('BattleGoalSchema', () => {
  const schema = SCHEMAS['battle-goals'];

  it('accepts a valid battle goal', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:battle-goal/1301',
      name: 'Assassin',
      condition: 'Kill an enemy before its first turn.',
      checkmarks: 2,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects non-integer checkmarks', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:battle-goal/9999',
      name: 'Test',
      condition: 'Do something',
      checkmarks: 1.5,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });
});

describe('EventSchema', () => {
  const schema = SCHEMAS['events'];

  it('accepts an event with two options', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:event/100',
      eventType: 'road',
      season: 'winter',
      number: '05',
      flavorText: 'A storm.',
      optionA: { text: 'Shelter', outcome: 'Safe' },
      optionB: { text: 'Go', outcome: 'Hurt' },
      optionC: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('accepts an event with null optionB', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:event/101',
      eventType: 'boat',
      season: null,
      number: '01',
      flavorText: 'Calm seas.',
      optionA: { text: 'Continue', outcome: 'Nothing happens' },
      optionB: null,
      optionC: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('accepts an event with optionC', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:event/102',
      eventType: 'boat',
      season: null,
      number: '01',
      flavorText: 'A fun event.',
      optionA: { text: 'A', outcome: 'A outcome' },
      optionB: { text: 'B', outcome: 'B outcome' },
      optionC: { text: 'C', outcome: 'C outcome' },
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid event type', () => {
    const data = {
      sourceId: 'gloomhavensecretariat:event/999',
      eventType: 'dungeon',
      season: null,
      number: '01',
      flavorText: 'X',
      optionA: { text: 'Y', outcome: 'Z' },
      optionB: null,
      optionC: null,
    };
    expect(schema.safeParse(data).success).toBe(false);
  });
});

describe('All schemas generate valid JSON Schema', () => {
  it('generates non-empty JSON Schema for every card type', async () => {
    const { z } = await import('zod');
    for (const [type, schema] of Object.entries(SCHEMAS)) {
      const jsonSchema = z.toJSONSchema(schema);
      expect(jsonSchema, `${type} should have properties`).toHaveProperty('properties');
    }
  });
});
