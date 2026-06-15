import { captureTelemetryError, flushTelemetry, initTelemetry } from './telemetry.ts';

export type ScriptTelemetryKind = 'cron' | 'release_command' | 'manual_migration' | 'script';

interface ScriptTelemetryOptions {
  scriptName: string;
  scriptKind: ScriptTelemetryKind;
  route?: string;
  flushTimeoutMs?: number;
}

/**
 * Initialize Sentry for non-Hono entrypoints, capture failures, flush before
 * exit, and leave success paths silent.
 */
export async function runScriptWithTelemetry<T>(
  operation: () => Promise<T>,
  options: ScriptTelemetryOptions,
): Promise<T> {
  initTelemetry();

  try {
    return await operation();
  } catch (error) {
    captureTelemetryError(error, {
      route: options.route ?? `/scripts/${options.scriptName}`,
      context: {
        scriptName: options.scriptName,
        scriptKind: options.scriptKind,
      },
    });
    await flushTelemetry(options.flushTimeoutMs ?? 2_000);
    throw error;
  }
}
