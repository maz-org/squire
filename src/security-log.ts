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
