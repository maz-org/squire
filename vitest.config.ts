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
    setupFiles: ['./test/helpers/vitest-eslint-setup.js'],
    sequence: { shuffle: true },
    // Every DB-backed test file truncates and repopulates the same
    // `squire_test` database in `beforeEach`. Under vitest's default
    // parallel file runner, two workers can end up in a TRUNCATE vs
    // INSERT lock-ordering cycle on the `oauth_*` tables (surfaced first
    // by SQR-68's auth-provider tests — the failure mode was a flaky
    // deadlock that depended on the random test shuffle order). The
    // whole suite shares one Postgres, so inter-file parallelism here is
    // negative value: it doesn't make the run meaningfully faster and it
    // introduces non-deterministic deadlocks. Disable it.
    fileParallelism: false,
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
