import type { Span } from '@opentelemetry/api';

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface LangSmithRunReference {
  langsmithRunId?: string;
  langsmithRunUrl?: string;
  langsmithTraceUrl?: string;
}

const URL_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const OTEL_SPAN_ID_PATTERN = /^[a-f0-9]{16}$/;

function envValue(env: Env | undefined, key: string): string | undefined {
  const value = env?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function safeUrlToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !URL_TOKEN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function langSmithProjectUrlFromEnv(env: Env | undefined = process.env): string | undefined {
  const workspaceId = safeUrlToken(envValue(env, 'LANGSMITH_WORKSPACE_ID'));
  const projectId = safeUrlToken(
    envValue(env, 'LANGSMITH_PROJECT_ID') ?? envValue(env, 'LANGSMITH_PROJECT_UUID'),
  );
  if (!workspaceId || !projectId) return undefined;
  return `https://smith.langchain.com/o/${workspaceId}/projects/p/${projectId}`;
}

export function langSmithRunIdFromOtelSpanId(spanId: string | undefined): string | undefined {
  const normalized = spanId?.trim().toLowerCase();
  if (!normalized || !OTEL_SPAN_ID_PATTERN.test(normalized)) return undefined;
  return `00000000-0000-0000-${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function langSmithRunUrlFromRunId(
  runId: string | undefined,
  env: Env | undefined = process.env,
): string | undefined {
  const safeRunId = safeUrlToken(runId);
  const projectUrl = langSmithProjectUrlFromEnv(env);
  if (!safeRunId || !projectUrl) return undefined;
  return `${projectUrl}/r/${safeRunId}?poll=true`;
}

export function langSmithRunReferenceFromSpan(
  span: Span,
  env: Env | undefined = process.env,
): LangSmithRunReference | undefined {
  const langsmithRunId = langSmithRunIdFromOtelSpanId(span.spanContext().spanId);
  if (!langsmithRunId) return undefined;
  const langsmithRunUrl = langSmithRunUrlFromRunId(langsmithRunId, env);
  return {
    langsmithRunId,
    ...(langsmithRunUrl
      ? {
          langsmithRunUrl,
          langsmithTraceUrl: langsmithRunUrl,
        }
      : {}),
  };
}
