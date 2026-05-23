/**
 * Test files that share mutable Postgres state through test/helpers/db.ts.
 *
 * These stay in the serial DB slice. The unit slice excludes them so Vitest can
 * parallelize isolated tests without reintroducing shared-DB truncation races.
 */
export const DB_BACKED_TEST_FILES = [
  'test/auth-google.test.ts',
  'test/auth-provider.test.ts',
  'test/auth-restart.test.ts',
  'test/conversation.test.ts',
  'test/cross-game-isolation.test.ts',
  'test/dev-login.test.ts',
  'test/extracted-data.test.ts',
  'test/llm-budget.test.ts',
  'test/scenario-section-data.test.ts',
  'test/seed/seed-cards.test.ts',
  'test/seed/seed-dev-user.test.ts',
  'test/seed/seed-scenario-section-books.test.ts',
  'test/server-oauth.test.ts',
  'test/session-repository.test.ts',
  'test/tools.test.ts',
  'test/vector-store.test.ts',
];

/**
 * Tests that perform the real scenario/section PDF extraction path.
 *
 * SLOW_PDF_TEST_FILES stays out of the normal PR suite because it does heavier
 * file/PDF processing than the regression fixtures. Run these explicitly with
 * `npm run test:slow:pdf`; CI runs them from the scheduled/manual slow-test
 * path when source PDFs or parser behavior need verification.
 */
export const SLOW_PDF_TEST_FILES = ['test/import-scenario-section-books.test.ts'];
