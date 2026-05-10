type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const DEFAULT_SQUIRE_ENV = 'development';
const SQUIRE_ENV_PATTERN = /^(?!langfuse)[a-z0-9_-]{1,40}$/;

export function resolveSquireEnv(env: Env = process.env): string {
  const raw = env.SQUIRE_ENV?.trim() || env.NODE_ENV?.trim() || DEFAULT_SQUIRE_ENV;
  const value = raw.toLowerCase();

  if (!SQUIRE_ENV_PATTERN.test(value)) {
    throw new Error(
      'SQUIRE_ENV must be 1-40 lowercase letters, numbers, hyphens, or underscores, and must not start with "langfuse".',
    );
  }

  return value;
}

export function applySquireEnv(env: Env = process.env): string {
  const squireEnv = resolveSquireEnv(env);
  env.SQUIRE_ENV = squireEnv;
  return squireEnv;
}
