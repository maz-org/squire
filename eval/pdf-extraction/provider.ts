import type {
  ExtractionArtifact,
  ExtractionFailureClass,
  PdfExtractionProviderId,
} from './schema.ts';

export interface PdfExtractionRunInput {
  sourcePath: string;
  pages: number[];
  outputDir: string;
  runLabel: string;
  retryCount: number;
}

export interface PdfExtractionProvider {
  id: PdfExtractionProviderId;
  displayName: string;
  version: string;
  extract: (input: PdfExtractionRunInput) => Promise<ExtractionArtifact>;
}

export interface ProviderRegistry {
  register(provider: PdfExtractionProvider): void;
  get(id: PdfExtractionProviderId): PdfExtractionProvider;
  list(): PdfExtractionProvider[];
}

class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<PdfExtractionProviderId, PdfExtractionProvider>();

  register(provider: PdfExtractionProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`PDF extraction provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: PdfExtractionProviderId): PdfExtractionProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown PDF extraction provider: ${id}`);
    return provider;
  }

  list(): PdfExtractionProvider[] {
    return [...this.providers.values()];
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new InMemoryProviderRegistry();
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isInteger(status) ? status : undefined;
  }
  return undefined;
}

export function classifyProviderError(error: unknown): ExtractionFailureClass {
  const status = statusFromError(error);
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'credential_failure';

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'timeout';
  if (/invalid artifact|artifact validation/i.test(message)) return 'invalid_artifact';
  if (/cost|ceiling|guardrail/i.test(message)) return 'cost_guardrail';
  if (/unsupported/i.test(message)) return 'unsupported_configuration';
  if (/partial page/i.test(message)) return 'partial_page_failure';
  return 'provider_error';
}
