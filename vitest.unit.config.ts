import { defineConfig, configDefaults } from 'vitest/config';

import { DB_BACKED_TEST_FILES, SLOW_PDF_TEST_FILES } from './test/helpers/test-slices.ts';

const BROWSER_E2E_TEST_FILES = ['test/e2e/**'];

export default defineConfig({
  test: {
    env: { SQUIRE_DEV_LOGIN: '1' },
    exclude: [
      ...configDefaults.exclude,
      'data/**',
      '.claude/worktrees/**',
      ...DB_BACKED_TEST_FILES,
      ...SLOW_PDF_TEST_FILES,
      ...BROWSER_E2E_TEST_FILES,
    ],
    setupFiles: ['./test/helpers/vitest-eslint-setup.js'],
    sequence: { shuffle: true },
    fileParallelism: true,
  },
});
