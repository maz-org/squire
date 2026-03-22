import { describe, it, expect } from 'vitest';
import { SCHEMAS } from '../src/schemas.js';

describe('MonsterStatSchema', () => {
  const schema = SCHEMAS['monster-stats'];

  it('accepts a valid monster stat card', () => {
    const data = {
      name: 'Ooze',
      levelRange: '0-3',
      normal: { '0': { move: 1, attack: 2, range: null, hp: 5 } },
      elite: { '0': { move: 2, attack: 3, range: null, hp: 8 } },
      immunities: ['poison'],
      notes: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid levelRange', () => {
    const data = {
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
      levelRange: '0-3',
      normal: {},
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
    const data = { name: 'Assassin', condition: 'Kill an enemy before its first turn.', checkmarks: 2 };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects non-integer checkmarks', () => {
    const data = { name: 'Test', condition: 'Do something', checkmarks: 1.5 };
    expect(schema.safeParse(data).success).toBe(false);
  });
});

describe('EventSchema', () => {
  const schema = SCHEMAS['events'];

  it('accepts an event with two options', () => {
    const data = {
      eventType: 'road',
      season: 'winter',
      number: '05',
      flavorText: 'A storm.',
      optionA: { text: 'Shelter', outcome: 'Safe' },
      optionB: { text: 'Go', outcome: 'Hurt' },
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('accepts an event with null optionB', () => {
    const data = {
      eventType: 'boat',
      season: null,
      number: '01',
      flavorText: 'Calm seas.',
      optionA: { text: 'Continue', outcome: 'Nothing happens' },
      optionB: null,
    };
    expect(schema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid event type', () => {
    const data = {
      eventType: 'dungeon',
      season: null,
      number: '01',
      flavorText: 'X',
      optionA: { text: 'Y', outcome: 'Z' },
      optionB: null,
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
