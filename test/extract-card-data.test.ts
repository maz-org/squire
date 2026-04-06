import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist shared mocks ──────────────────────────────────────────────────────

const {
  mockMessagesCreate,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockReaddirSync,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
}));

// ─── Mock all external dependencies ──────────────────────────────────────────

vi.mock('dotenv/config', () => ({}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// ─── Import the module under test ────────────────────────────────────────────

import {
  extractJson,
  collectImages,
  extractImage,
  extractCardType,
  extractNumberFromFilename,
} from '../src/extract-card-data.ts';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractNumberFromFilename', () => {
  it('extracts number from summer road event filename', () => {
    expect(extractNumberFromFilename('fh-sre-01-f.png', 'events')).toBe('01');
    expect(extractNumberFromFilename('fh-sre-35-b.png', 'events')).toBe('35');
  });

  it('extracts number from winter road event filename', () => {
    expect(extractNumberFromFilename('fh-wre-02-f.png', 'events')).toBe('02');
  });

  it('extracts number from summer outpost event filename', () => {
    expect(extractNumberFromFilename('fh-soe-10-f.png', 'events')).toBe('10');
  });

  it('extracts number from winter outpost event filename', () => {
    expect(extractNumberFromFilename('fh-woe-05-b.png', 'events')).toBe('05');
  });

  it('extracts number from boat event filename', () => {
    expect(extractNumberFromFilename('fh-be-01-f.png', 'events')).toBe('01');
  });

  it('extracts number from item filename', () => {
    expect(extractNumberFromFilename('fh-001-spyglass.png', 'items')).toBe('001');
    expect(extractNumberFromFilename('fh-142-boots-of-quickness.png', 'items')).toBe('142');
  });

  it('extracts number from building filename', () => {
    expect(extractNumberFromFilename('fh-39-jeweler-level-2.png', 'buildings')).toBe('39');
    expect(extractNumberFromFilename('fh-05-mining-camp-level-1.png', 'buildings')).toBe('05');
  });

  it('returns null for card types without number patterns', () => {
    expect(extractNumberFromFilename('algox-archer.png', 'monster-stats')).toBeNull();
    expect(extractNumberFromFilename('ability-01.png', 'character-abilities')).toBeNull();
    expect(extractNumberFromFilename('card.png', 'character-abilities')).toBeNull();
  });

  it('returns null when filename does not match expected pattern', () => {
    expect(extractNumberFromFilename('random-file.png', 'events')).toBeNull();
    expect(extractNumberFromFilename('not-an-item.png', 'items')).toBeNull();
  });
});

describe('extractJson', () => {
  it('parses a plain JSON object string', () => {
    expect(extractJson('{"name": "test", "value": 42}')).toEqual({ name: 'test', value: 42 });
  });

  it('parses nested JSON objects', () => {
    expect(extractJson('{"outer": {"inner": true}}')).toEqual({ outer: { inner: true } });
  });

  it('strips ```json code fences', () => {
    expect(extractJson('```json\n{"name": "test"}\n```')).toEqual({ name: 'test' });
  });

  it('strips plain ``` code fences', () => {
    expect(extractJson('```\n{"name": "test"}\n```')).toEqual({ name: 'test' });
  });

  it('extracts JSON when preceded by prose', () => {
    expect(extractJson('Here is the data: {"name": "test"} end')).toEqual({ name: 'test' });
  });

  it('extracts JSON from multiline LLM response', () => {
    const input =
      'Sure!\n\n{"name": "Algox Archer", "initiative": 35}\n\nLet me know if you need more.';
    expect(extractJson(input)).toEqual({ name: 'Algox Archer', initiative: 35 });
  });

  it('throws on invalid JSON', () => {
    expect(() => extractJson('not json at all')).toThrow(SyntaxError);
  });

  it('throws on empty string', () => {
    expect(() => extractJson('')).toThrow();
  });
});

describe('collectImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when image directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(collectImages('monster-stats')).toEqual([]);
  });

  it('returns matching .png files from a flat directory', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'algox-archer.png', isDirectory: () => false, isFile: () => true },
      { name: 'notes.txt', isDirectory: () => false, isFile: () => true },
    ]);

    const result = collectImages('monster-stats');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/algox-archer\.png$/);
  });

  it('excludes -back.png files for buildings', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'card-back.png', isDirectory: () => false, isFile: () => true },
      { name: 'card-front.png', isDirectory: () => false, isFile: () => true },
    ]);

    const result = collectImages('buildings');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/card-front\.png$/);
  });

  it('recurses into subdirectories when subdirs is true', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('algox-archer')) {
        return [{ name: 'ability-01.png', isDirectory: () => false, isFile: () => true }];
      }
      return [{ name: 'algox-archer', isDirectory: () => true, isFile: () => false }];
    });

    const result = collectImages('character-abilities');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/ability-01\.png$/);
  });

  it('does not recurse when subdirs is false', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'subdir', isDirectory: () => true, isFile: () => false },
      { name: 'card.png', isDirectory: () => false, isFile: () => true },
    ]);

    const result = collectImages('monster-stats');
    expect(result).toHaveLength(1);
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });
});

describe('extractImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns validated data for a valid monster stats response', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'Algox Archer',
            levelRange: '0-3',
            normal: { '0': { hp: 3, move: 2, attack: 2, range: 4, attributes: [] } },
            elite: { '0': { hp: 5, move: 2, attack: 3, range: 5, attributes: [] } },
            immunities: [],
            notes: null,
          }),
        },
      ],
    });

    const result = await extractImage('/fake/card.png', 'monster-stats');
    expect(result.name).toBe('Algox Archer');
    expect(result._validationErrors).toBeUndefined();
  });

  it('returns data with validation errors when schema fails', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"monsterName": "Bad"}',
        },
      ],
    });

    const result = await extractImage('/fake/card.png', 'monster-stats');
    expect(result._validationErrors).toBeDefined();
    expect(result._validationErrors!.length).toBeGreaterThan(0);
  });

  it('uses Haiku model for extraction', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"monsterName": "Test", "levels": [{"level": 0, "normal": {"hp": 1, "move": 1, "attack": 1, "range": 0, "attributes": []}, "elite": {"hp": 2, "move": 1, "attack": 2, "range": 0, "attributes": []}}]}',
        },
      ],
    });

    await extractImage('/fake/card.png', 'monster-stats');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });

  it('throws non-rate-limit errors immediately', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockRejectedValue(new Error('connection failed'));

    await expect(extractImage('/fake/card.png', 'monster-stats')).rejects.toThrow(
      'connection failed',
    );
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });
});

describe('extractCardType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing succeeded records when no pending images', () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.json')) return true;
      return false; // image dir doesn't exist
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        {
          _file: 'card.png',
          name: 'Test',
          levelRange: '0-3',
          normal: {},
          elite: {},
          immunities: [],
          notes: null,
        },
      ]),
    );
    mockReaddirSync.mockReturnValue([]);

    return extractCardType('monster-stats').then((result) => {
      expect(result).toHaveLength(1);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  it('processes pending images and saves results', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.json')) return false;
      if (typeof path === 'string' && path.includes('monster-stat-cards')) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'algox-archer.png', isDirectory: () => false, isFile: () => true },
    ]);
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'Algox Archer',
            levelRange: '0-3',
            normal: { '0': { hp: 3, move: 2, attack: 2, range: 4, attributes: [] } },
            elite: { '0': { hp: 5, move: 2, attack: 3, range: 5, attributes: [] } },
            immunities: [],
            notes: null,
          }),
        },
      ],
    });

    const result = await extractCardType('monster-stats');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Algox Archer');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('overrides OCR event number with filename-derived number', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.json')) return false;
      if (typeof path === 'string' && path.includes('events')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('road') || dir.endsWith('outpost') || dir.endsWith('boat')) {
        if (dir.endsWith('road'))
          return [{ name: 'fh-sre-35-f.png', isDirectory: () => false, isFile: () => true }];
        return [];
      }
      // Return subdirectories for the events dir
      return [
        { name: 'road', isDirectory: () => true, isFile: () => false },
        { name: 'outpost', isDirectory: () => true, isFile: () => false },
        { name: 'boat', isDirectory: () => true, isFile: () => false },
      ];
    });
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"eventType": "road", "season": "summer", "number": "999", "flavorText": "Test", "optionA": {"text": "A", "outcome": "A result"}, "optionB": null}',
        },
      ],
    });

    const result = await extractCardType('events');
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe('35'); // filename number, not OCR "999"
  });

  it('overrides OCR item number with filename-derived number', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.json')) return false;
      if (typeof path === 'string' && path.includes('items')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((dir: string) => {
      if (dir.endsWith('001-010'))
        return [{ name: 'fh-001-spyglass.png', isDirectory: () => false, isFile: () => true }];
      // Return subdirectory
      return [{ name: '001-010', isDirectory: () => true, isFile: () => false }];
    });
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"number": "082", "name": "Spyglass", "slot": "small item", "cost": 2, "effect": "Test effect", "uses": 1, "spent": false, "lost": false}',
        },
      ],
    });

    const result = await extractCardType('items');
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe('001'); // filename number, not OCR "082"
  });
});
