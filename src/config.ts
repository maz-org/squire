type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface ServerConfig {
  nodeEnv: string;
  port: number | undefined;
  host: string | undefined;
}

export interface ServerConfigError {
  missing: string[];
  invalid: Array<{ name: string; message: string }>;
}

export type ServerConfigResult =
  | { success: true; data: ServerConfig }
  | { success: false; error: ServerConfigError };

const REQUIRED_SERVER_ENV = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'SESSION_SECRET',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_BASEURL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'ORIGIN_SHARED_SECRET',
] as const;

function requiredServerEnv(nodeEnv: string): readonly (typeof REQUIRED_SERVER_ENV)[number][] {
  if (nodeEnv === 'production') return REQUIRED_SERVER_ENV;
  return REQUIRED_SERVER_ENV.filter((name) => name !== 'DATABASE_URL');
}

function isTestProcess(env: Env): boolean {
  return env.VITEST === 'true' || env.NODE_ENV === 'test';
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : Number.NaN;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function validateUrl(
  name: string,
  value: string | undefined,
  invalid: ServerConfigError['invalid'],
) {
  if (!hasText(value)) return;
  try {
    new URL(value!);
  } catch {
    invalid.push({ name, message: 'must be a valid URL' });
  }
}

export function validateServerEnv(env: Env = process.env): ServerConfigResult {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const missing = isTestProcess(env)
    ? []
    : requiredServerEnv(nodeEnv).filter((name) => !hasText(env[name]));
  const invalid: ServerConfigError['invalid'] = [];

  const port = parsePort(env.PORT);
  if (Number.isNaN(port)) {
    invalid.push({ name: 'PORT', message: 'must be an integer between 1 and 65535' });
  }

  if (hasText(env.SESSION_SECRET) && env.SESSION_SECRET!.length < 32) {
    invalid.push({ name: 'SESSION_SECRET', message: 'must be at least 32 characters' });
  }
  validateUrl('DATABASE_URL', env.DATABASE_URL, invalid);
  validateUrl('LANGFUSE_BASEURL', env.LANGFUSE_BASEURL, invalid);

  if (hasText(env.HOST) && env.HOST!.trim() !== env.HOST) {
    invalid.push({ name: 'HOST', message: 'must not contain leading or trailing whitespace' });
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { success: false, error: { missing, invalid } };
  }

  return {
    success: true,
    data: {
      nodeEnv,
      port: port ?? (nodeEnv === 'production' ? 8080 : undefined),
      host: env.HOST ?? (nodeEnv === 'production' ? '0.0.0.0' : undefined),
    },
  };
}

export function formatServerConfigError(error: ServerConfigError): string {
  const lines = ['Invalid Squire server environment configuration.'];
  if (error.missing.length > 0) {
    lines.push(`Missing required environment variables: ${error.missing.join(', ')}`);
  }
  for (const item of error.invalid) {
    lines.push(`${item.name}: ${item.message}`);
  }
  return lines.join('\n');
}

export function loadServerConfig(env: Env = process.env): ServerConfig {
  const result = validateServerEnv(env);
  if (result.success) return result.data;
  throw new Error(formatServerConfigError(result.error));
}

export function resolveGoogleOAuthEnv(env: Env = process.env): {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
} {
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}
