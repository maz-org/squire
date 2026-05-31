import { getRetrievalBootstrapStatus, type RetrievalBootstrapStatus } from '../src/vector-store.ts';
import { sourceAuthorityForCase } from './dataset.ts';
import type { EvalCase } from './schema.ts';

type RetrievalStatusReader = () => Promise<RetrievalBootstrapStatus>;

const RULE_SOURCE_AUTHORITIES = new Set(['rulebook', 'faq', 'errata']);

export function evalCaseRequiresRuleSourceRetrieval(evalCase: EvalCase): boolean {
  return RULE_SOURCE_AUTHORITIES.has(sourceAuthorityForCase(evalCase));
}

export async function assertRuleSourceRetrievalReady(
  evalCase: EvalCase,
  readStatus: RetrievalStatusReader = getRetrievalBootstrapStatus,
): Promise<void> {
  if (!evalCaseRequiresRuleSourceRetrieval(evalCase)) return;

  const status = await readStatus();
  if (status.ready) return;

  const details = status.error ? ` ${status.error}` : '';
  throw new Error(
    `Tool preflight failed: Rule-source retrieval is not ready for eval case ${evalCase.id}.${details}`,
  );
}
