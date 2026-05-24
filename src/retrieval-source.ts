/**
 * Human-readable label for an indexed rule source.
 *
 * The raw `source` value stays the source basename for provenance and
 * reindexing.
 * This helper exists for tool/API/UI display so retrieval results clearly
 * distinguish rulebooks, FAQ snapshots, errata, and scenario/section books.
 */
export { formatRetrievalSourceLabel } from './rule-source-provenance.ts';
