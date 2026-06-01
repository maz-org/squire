import { createAppleVisionProvider } from './apple-vision.ts';
import { createAwsTextractProvider } from './aws-textract.ts';
import { createLlamaParseProvider } from './llamaparse.ts';
import { createMarkerDatalabProvider } from './marker-datalab.ts';
import { createProviderRegistry, type ProviderRegistry } from './provider.ts';
import { createUnstructuredProvider } from './unstructured.ts';

export function createPdfExtractionProviderRegistry(): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(createAppleVisionProvider());
  registry.register(createAwsTextractProvider());
  registry.register(createLlamaParseProvider());
  registry.register(createUnstructuredProvider());
  registry.register(createMarkerDatalabProvider());
  return registry;
}
