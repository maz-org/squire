import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        // Core business logic: 100% target
        // Integration layers: 80-90% target
        // Overall minimum to enforce
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
