import { createAppleVisionProvider } from './apple-vision.ts';
import { createProviderRegistry, type ProviderRegistry } from './provider.ts';

export function createPdfExtractionProviderRegistry(): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(createAppleVisionProvider());
  return registry;
}
