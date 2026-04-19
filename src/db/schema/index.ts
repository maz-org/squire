/**
 * Drizzle schema barrel — re-exports every table.
 *
 * Split into three files so the Storage & Data Migration project's parallel
 * lanes (Lane B = card data, Lane C = auth.ts rewrite) can edit different
 * files without merge conflicts. See `docs/plans/storage-migration-tech-spec.md`
 * §"Execution order & parallelization".
 */

export * from './core.ts';
export * from './auth.ts';
export * from './cards.ts';
export * from './conversations.ts';
export * from './scenario-section-books.ts';
export * from './relations.ts';
