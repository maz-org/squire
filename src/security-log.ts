import { resolveSquireEnv } from './squire-env.ts';

interface SecurityLogBase {
  event: string;
  level?: 'info' | 'warn' | 'error';
  fields?: Record<string, string | number | boolean | null>;
}

function safeSquireEnv(): string {
  try {
    return resolveSquireEnv();
  } catch {
    return 'unknown';
  }
}

export function writeSecurityLog({ event, level = 'warn', fields = {} }: SecurityLogBase): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      squire_env: safeSquireEnv(),
      ...fields,
    }),
  );
}

export function errorLogFields(error: unknown): Record<string, string | null> {
  const withCode = error as { code?: unknown };
  return {
    error_type: error instanceof Error && error.name ? error.name : 'unknown',
    error_code: typeof withCode.code === 'string' ? withCode.code : null,
  };
}
