import { defineConfig, configDefaults } from 'vitest/config';

import { DB_BACKED_TEST_FILES, SLOW_PDF_TEST_FILES } from './test/helpers/test-slices.ts';

const shared = {
  env: { SQUIRE_DEV_LOGIN: '1' },
  setupFiles: ['./test/helpers/vitest-eslint-setup.js'],
  sequence: { shuffle: true },
};

const BROWSER_E2E_TEST_FILES = ['test/e2e/**'];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          ...shared,
          exclude: [
            ...configDefaults.exclude,
            'data/**',
            '.claude/worktrees/**',
            ...DB_BACKED_TEST_FILES,
            // Kept on the dedicated slow path: `npm run test:slow:pdf`.
            ...SLOW_PDF_TEST_FILES,
            // Playwright specs run through `npm run e2e:browser`, not Vitest.
            ...BROWSER_E2E_TEST_FILES,
          ],
          fileParallelism: true,
        },
      },
      {
        test: {
          name: 'db',
          ...shared,
          include: DB_BACKED_TEST_FILES,
          globalSetup: ['./test/helpers/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
