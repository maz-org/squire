import { getDb } from './db.ts';

export type ComponentReadiness = { status: 'ok' } | { status: 'error'; error: string };

export interface ReadinessStatus {
  status: 'ok' | 'error';
  db: ComponentReadiness;
  vector: ComponentReadiness;
  embedder: ComponentReadiness;
}

const DEFAULT_QUERY_TIMEOUT_MS = 2000;

interface QueryableDb {
  $client: {
    query: (sql: string) => Promise<unknown>;
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
    options?: { max?: number };
  };
}

interface ReadinessDependencies {
  db?: QueryableDb;
  isEmbedderLoaded?: () => boolean;
  queryTimeoutMs?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('readiness check timed out'));
    }, timeoutMs);
  });
  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function checkPoolAvailability(db: QueryableDb): ComponentReadiness | undefined {
  const { idleCount, options, totalCount, waitingCount } = db.$client;
  const max = options?.max;

  if (
    typeof max === 'number' &&
    typeof totalCount === 'number' &&
    typeof idleCount === 'number' &&
    totalCount >= max &&
    idleCount === 0
  ) {
    return { status: 'error', error: 'postgres pool is exhausted' };
  }

  if (typeof waitingCount === 'number' && waitingCount > 0) {
    return { status: 'error', error: 'postgres pool has waiting clients' };
  }

  return undefined;
}

async function checkQuery(
  db: QueryableDb,
  sql: string,
  timeoutMs: number,
): Promise<ComponentReadiness> {
  try {
    await withTimeout(db.$client.query(sql), timeoutMs);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: errorMessage(err) };
  }
}

export async function runReadinessChecks(
  dependencies: ReadinessDependencies = {},
): Promise<ReadinessStatus> {
  const db = dependencies.db ?? getDb('server').db;
  const queryTimeoutMs = dependencies.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const dbStatus = checkPoolAvailability(db) ?? (await checkQuery(db, 'SELECT 1', queryTimeoutMs));
  const vectorStatus =
    dbStatus.status === 'ok'
      ? await checkQuery(db, "SELECT '[1]'::vector", queryTimeoutMs)
      : { status: 'error' as const, error: 'skipped because database is unavailable' };
  const embedderLoaded =
    dependencies.isEmbedderLoaded ?? (await import('./embedder.ts')).isEmbedderLoaded;
  const embedderStatus: ComponentReadiness = embedderLoaded()
    ? { status: 'ok' }
    : { status: 'error', error: 'embedder is not loaded' };

  const status =
    dbStatus.status === 'ok' && vectorStatus.status === 'ok' && embedderStatus.status === 'ok'
      ? 'ok'
      : 'error';

  return {
    status,
    db: dbStatus,
    vector: vectorStatus,
    embedder: embedderStatus,
  };
}
