import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // `.claude/worktrees/**` keeps gstack worktrees from being picked up by
    // the parent repo's vitest run. Without this, a stale worktree at a
    // pre-migration commit would silently double the suite and run its older
    // tests against the same `squire_test` DB, producing confusing false
    // failures (seen during /document-release on SQR-56).
    exclude: [...configDefaults.exclude, 'data/**', '.claude/worktrees/**'],
    // Seed card_* tables ONCE per run. Per-file seeding raced under vitest's
    // parallel runner — see test/helpers/global-setup.ts for the gory details.
    globalSetup: ['./test/helpers/global-setup.ts'],
    sequence: { shuffle: true },
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
