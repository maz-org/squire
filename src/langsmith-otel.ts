type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export function langsmithOtelHeaders(env: Env = process.env): Record<string, string> | undefined {
  if (hasText(env.OTEL_EXPORTER_OTLP_HEADERS)) return undefined;

  const headers: Record<string, string> = {};
  const apiKey = env.LANGSMITH_API_KEY ?? env.LANGCHAIN_API_KEY;
  const workspaceId = env.LANGSMITH_WORKSPACE_ID;

  if (hasText(apiKey)) headers['x-api-key'] = apiKey;
  if (hasText(workspaceId)) headers['x-tenant-id'] = workspaceId.trim();

  return Object.keys(headers).length > 0 ? headers : undefined;
}
