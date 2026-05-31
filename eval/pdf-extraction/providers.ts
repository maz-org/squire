import { createAppleVisionProvider } from './apple-vision.ts';
import { createAwsTextractProvider } from './aws-textract.ts';
import { createLlamaParseProvider } from './llamaparse.ts';
import { createProviderRegistry, type ProviderRegistry } from './provider.ts';

export function createPdfExtractionProviderRegistry(): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(createAppleVisionProvider());
  registry.register(createAwsTextractProvider());
  registry.register(createLlamaParseProvider());
  return registry;
}
