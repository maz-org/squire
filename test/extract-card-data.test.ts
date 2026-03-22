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
} from '../src/extract-card-data.ts';

// ─── Tests ───────────────────────────────────────────────────────────────────

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

  it('excludes -back.png files for battle-goals', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'card-back.png', isDirectory: () => false, isFile: () => true },
      { name: 'card-front.png', isDirectory: () => false, isFile: () => true },
    ]);

    const result = collectImages('battle-goals');
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

    const result = collectImages('monster-abilities');
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

  it('returns validated data for a valid battle goal response', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"name": "Assassin", "condition": "Kill an enemy", "checkmarks": 2}',
        },
      ],
    });

    const result = await extractImage('/fake/card.png', 'battle-goals');
    expect(result.name).toBe('Assassin');
    expect(result.condition).toBe('Kill an enemy');
    expect(result.checkmarks).toBe(2);
    expect(result._validationErrors).toBeUndefined();
  });

  it('returns data with validation errors when schema fails', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"name": "Bad", "condition": "Test"}',
        },
      ],
    });

    const result = await extractImage('/fake/card.png', 'battle-goals');
    expect(result._validationErrors).toBeDefined();
    expect(result._validationErrors!.length).toBeGreaterThan(0);
  });

  it('calls Claude with the correct model', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"name": "Test", "condition": "Test", "checkmarks": 1}',
        },
      ],
    });

    await extractImage('/fake/card.png', 'battle-goals');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });

  it('throws non-rate-limit errors immediately', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockRejectedValue(new Error('connection failed'));

    await expect(extractImage('/fake/card.png', 'battle-goals')).rejects.toThrow(
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
      JSON.stringify([{ _file: 'card.png', name: 'Test', condition: 'X', checkmarks: 1 }]),
    );
    mockReaddirSync.mockReturnValue([]);

    return extractCardType('battle-goals').then((result) => {
      expect(result).toHaveLength(1);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  it('processes pending images and saves results', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.json')) return false;
      if (typeof path === 'string' && path.includes('battle-goals')) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'goal1.png', isDirectory: () => false, isFile: () => true },
    ]);
    mockReadFileSync.mockReturnValue(Buffer.from('fake image'));
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"name": "Test Goal", "condition": "Do something", "checkmarks": 1}',
        },
      ],
    });

    const result = await extractCardType('battle-goals');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test Goal');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
