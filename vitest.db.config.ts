import { defineConfig } from 'vitest/config';

import { DB_BACKED_TEST_FILES } from './test/helpers/test-slices.ts';

export default defineConfig({
  test: {
    env: { SQUIRE_DEV_LOGIN: '1' },
    include: DB_BACKED_TEST_FILES,
    globalSetup: ['./test/helpers/global-setup.ts'],
    setupFiles: ['./test/helpers/vitest-eslint-setup.js'],
    sequence: { shuffle: true },
    fileParallelism: false,
  },
});
