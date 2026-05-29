import { describe, expect, it, vi } from 'vitest';

import {
  classifyProviderError,
  createProviderRegistry,
  type PdfExtractionProvider,
} from '../eval/pdf-extraction/provider.ts';
import { createPdfExtractionProviderRegistry } from '../eval/pdf-extraction/providers.ts';

function provider(id: PdfExtractionProvider['id']): PdfExtractionProvider {
  return {
    id,
    displayName: `Provider ${id}`,
    version: 'test-version',
    extract: vi.fn(),
  };
}

describe('PDF extraction provider registry', () => {
  it('wires Apple Vision into the default extraction provider registry', () => {
    const registry = createPdfExtractionProviderRegistry();

    expect(registry.get('apple-vision')).toMatchObject({
      id: 'apple-vision',
      displayName: 'Apple Vision',
    });
  });

  it('registers providers by stable id and lists them in insertion order', () => {
    const registry = createProviderRegistry();
    registry.register(provider('apple-vision'));
    registry.register(provider('aws-textract'));

    expect(registry.list().map((entry) => entry.id)).toEqual(['apple-vision', 'aws-textract']);
    expect(registry.get('aws-textract').displayName).toBe('Provider aws-textract');
  });

  it('rejects duplicate provider ids', () => {
    const registry = createProviderRegistry();
    registry.register(provider('llamaparse'));

    expect(() => registry.register(provider('llamaparse'))).toThrow(
      'PDF extraction provider already registered: llamaparse',
    );
  });

  it('classifies provider failures into the shared taxonomy', () => {
    expect(classifyProviderError(Object.assign(new Error('rate limited'), { status: 429 }))).toBe(
      'rate_limit',
    );
    expect(classifyProviderError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(
      'credential_failure',
    );
    expect(classifyProviderError(new Error('operation timed out after 30s'))).toBe('timeout');
    expect(classifyProviderError(new Error('artifact validation failed'))).toBe('invalid_artifact');
    expect(classifyProviderError(new Error('estimated cost exceeds configured ceiling'))).toBe(
      'cost_guardrail',
    );
    expect(classifyProviderError(new Error('unsupported configuration'))).toBe(
      'unsupported_configuration',
    );
    expect(classifyProviderError(new Error('partial page failure on page 30'))).toBe(
      'partial_page_failure',
    );
    expect(classifyProviderError(new Error('provider returned nonsense'))).toBe('provider_error');
  });
});
