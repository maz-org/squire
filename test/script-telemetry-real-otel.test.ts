import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('script telemetry direct-process OpenTelemetry setup', () => {
  it('starts recording script spans in a direct node script process', async () => {
    // package.json requires Node 26 and production scripts run `.ts` files
    // directly with `node`, so this intentionally mirrors the Fly entrypoints.
    const script = `
      import { trace } from '@opentelemetry/api';
      import { runScriptWithTelemetry } from './src/script-telemetry.ts';

      let spanInfo;
      await runScriptWithTelemetry(async () => {
        const span = trace.getActiveSpan();
        spanInfo = {
          recording: span?.isRecording?.() === true,
          traceId: span?.spanContext?.().traceId ?? null,
          spanId: span?.spanContext?.().spanId ?? null
        };
        return 'ok';
      }, {
        scriptName: 'script-otel-smoke',
        scriptKind: 'script',
        flushTimeoutMs: 1
      });

      const { sdk } = await import('./src/instrumentation.ts');
      await sdk.shutdown();
      console.log(JSON.stringify(spanInfo));
    `;

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LANGSMITH_API_KEY: '',
          SENTRY_DSN: '',
          SENTRY_TRACES_SAMPLE_RATE: '0',
        },
        timeout: 20_000,
      },
    );

    const resultLine = stdout
      .trim()
      .split('\n')
      .find((line) => line.startsWith('{'));
    expect(resultLine).toBeTruthy();
    const result = JSON.parse(resultLine!) as {
      recording: boolean;
      traceId: string | null;
      spanId: string | null;
    };

    expect(result).toEqual({
      recording: true,
      traceId: expect.not.stringMatching(/^0+$/),
      spanId: expect.not.stringMatching(/^0+$/),
    });
  });
});
